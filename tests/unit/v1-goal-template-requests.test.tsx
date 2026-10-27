import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { GoalEditorDialog } from "../../src/components/GoalEditorDialog";
import type { Goal, GoalDraft } from "../../src/domain/planning/Goal";
import { goalDraftDefaults } from "../../src/domain/planning/GoalTemplate";
import type { GoalProgressItemDraft } from "../../src/domain/progress/GoalProgressItem";
import { builtInTemplates, validateTemplate, type Template } from "../../src/domain/templates/Template";
import { GoalsPage } from "../../src/pages/GoalsPage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const smart = builtInTemplates.find(item => item.id === "default-smart")!;
const exploration = builtInTemplates.find(item => item.id === "default-exploration")!;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function context() {
  return {
    lifeDomainService: { list: vi.fn(async () => []) },
    goalService: {
      list: vi.fn(async (): Promise<Goal[]> => []),
      create: vi.fn<(draft: GoalDraft, items: readonly GoalProgressItemDraft[]) => Promise<Goal>>(),
      update: vi.fn(),
    },
    actionService: { list: vi.fn(async () => []), toggleCompletion: vi.fn() },
    goalProgressItemService: { list: vi.fn(async () => []) },
    habitService: { list: vi.fn(async () => []), listLogs: vi.fn(async () => []) },
    lifeNavigationService: { list: vi.fn(async () => []) },
    templateService: {
      find: vi.fn(async (id: string) => builtInTemplates.find(item => item.id === id) ?? null),
      getDefaultTemplate: vi.fn(async (): Promise<Template | null> => null),
    },
  };
}
function Host() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output aria-label="当前位置">{location.pathname + location.search + location.hash}</output>
    <button onClick={() => navigate("/goals?template=default-exploration&keep=1#new-source")}>后续模板请求</button>
    <button onClick={() => navigate("/goals?create=action&keep=1#action-source")}>后续行动请求</button>
    <button onClick={() => navigate("/goals?create=goal&keep=1")}>后续空白目标请求</button>
    <GoalsPage />
  </>;
}
function mount(value: ReturnType<typeof context>, path = "/goals") {
  return render(<LifeOSContext.Provider value={value as unknown as LifeOSContextValue}>
    <MemoryRouter initialEntries={[path]}><Host /></MemoryRouter>
  </LifeOSContext.Provider>);
}
function params() {
  return new URL(screen.getByLabelText("当前位置").textContent ?? "", "http://localhost").searchParams;
}
function text(label: string) {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}
async function ready() {
  await screen.findByRole("dialog");
  await waitFor(() => expect((screen.getByRole("button", { name: "创建目标" }) as HTMLButtonElement).disabled).toBe(false));
}

describe("goal template application contract", () => {
  it("preserves old stored text but rejects descriptions beyond the actual draft limit", () => {
    const defaults = { description: "字".repeat(2000) };
    expect(validateTemplate("goal", "旧模板", defaults).defaults).toEqual(defaults);
    expect(() => goalDraftDefaults(defaults)).toThrow("600");
    expect(goalDraftDefaults({ description: "字".repeat(600) }).description).toHaveLength(600);
  });
  it("copies only editable structure without generating instance facts or binding habits", () => {
    const original = JSON.stringify(smart.defaults);
    const copied = goalDraftDefaults(smart.defaults);
    copied.progressItems[0].weight = 8;
    expect(JSON.stringify(smart.defaults)).toBe(original);
    expect(goalDraftDefaults({ progressAlgorithm: "habit" })).toEqual({
      description: "", progressMode: "automatic", habitEnabled: true, progressItems: [],
    });
    for (const key of ["title", "status", "domainIds", "parentId", "directionId", "targetDate", "habitProgress", "constructor"]) {
      expect(() => goalDraftDefaults({ [key]: "unsafe" })).toThrow();
    }
    expect(() => goalDraftDefaults(JSON.parse('{"__proto__":"unsafe"}'))).toThrow();
    expect(() => goalDraftDefaults({ progressAlgorithm: "habit", progressMode: "exploration" })).toThrow();
  });
  it("rejects invalid progress values while keeping legal zero current values and overruns", () => {
    const item = { kind: "outcome", title: "结果", currentValue: 0, targetValue: 1, weight: 1 };
    expect(goalDraftDefaults({ progressItems: [item] }).progressItems[0].currentValue).toBe(0);
    expect(goalDraftDefaults({ progressItems: [{ ...item, currentValue: 2 }] }).progressItems[0].currentValue).toBe(2);
    for (const patch of [{ weight: 0 }, { targetValue: 0 }, { currentValue: NaN }, { weight: "2" }]) {
      expect(() => goalDraftDefaults({ progressItems: [{ ...item, ...patch }] })).toThrow();
    }
  });
});

describe("Chinese goal template requests", () => {
  it("opens only after a valid read and consumes the opening request without losing duplicate parameters", async () => {
    const value = context();
    const pending = deferred<Template | null>();
    value.templateService.find.mockReturnValueOnce(pending.promise);
    mount(value, "/goals?template=default-smart&create=goal&keep=1&keep=2#source");
    await screen.findByText("正在读取目标模板");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(params().get("create")).toBe("goal");
    expect(screen.getAllByRole("button", { name: "新建目标", exact: true })
      .every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    await act(async () => pending.resolve(smart));
    await ready();
    await waitFor(() => expect(params().has("template")).toBe(false));
    expect(params().has("create")).toBe(false);
    expect(params().getAll("keep")).toEqual(["1", "2"]);
    expect(screen.getByLabelText("当前位置").textContent).toContain("#source");
    expect(text("目标名称")).toBe("");
    expect(text("上级目标")).toBe("");
    expect(text("目标日期")).toBe("");
    expect(text("目标说明")).toBe(smart.defaults.description);
    expect(value.templateService.find).toHaveBeenCalledTimes(1);
    expect(value.templateService.getDefaultTemplate).not.toHaveBeenCalled();
  });
  it("retains a bare create request until the default template is ready and disables the complete fieldset", async () => {
    const value = context();
    const pending = deferred<Template | null>();
    value.templateService.getDefaultTemplate.mockReturnValueOnce(pending.promise);
    mount(value, "/goals?create=goal&keep=1");
    const dialog = await screen.findByRole("dialog");
    expect(params().get("create")).toBe("goal");
    expect(screen.getByLabelText("目标名称").matches(":disabled")).toBe(true);
    expect(screen.getByLabelText("目标日期").matches(":disabled")).toBe(true);
    fireEvent.submit(dialog.querySelector("form")!);
    expect(value.goalService.create).not.toHaveBeenCalled();
    await act(async () => pending.reject(new Error("C:\\private\\data.db")));
    expect((await screen.findByRole("alert")).textContent).not.toContain("private");
    expect(params().get("create")).toBe("goal");
    fireEvent.click(screen.getByRole("button", { name: "重试读取模板" }));
    await ready();
    await waitFor(() => expect(params().has("create")).toBe(false));
  });
  it.each([null, { ...smart, category: "review" as const }, { ...smart, defaults: { description: "字".repeat(601) } }])(
    "keeps unavailable or inapplicable requests until explicit cancellation", async template => {
      const value = context();
      value.templateService.find.mockResolvedValueOnce(template);
      mount(value, "/goals?template=bad&create=action&keep=1#source");
      await screen.findByRole("alert");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(params().get("template")).toBe("bad");
      fireEvent.click(screen.getByRole("button", { name: "取消模板请求" }));
      await waitFor(() => expect(params().has("template")).toBe(false));
      expect(params().has("create")).toBe(false);
      expect(params().get("keep")).toBe("1");
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  it("cancels a default-template loading request without reopening or applying its late result", async () => {
    const value = context();
    const pending = deferred<Template | null>();
    value.templateService.getDefaultTemplate.mockReturnValueOnce(pending.promise);
    mount(value, "/goals?create=goal&keep=1#source");
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "取消", exact: true }));
    await waitFor(() => expect(params().has("create")).toBe(false));
    await act(async () => pending.resolve(smart));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(params().get("keep")).toBe("1");
    expect(screen.getByLabelText("当前位置").textContent).toContain("#source");
  });
  it("keeps later template choices pending without overwriting the current draft", async () => {
    const value = context();
    mount(value, "/goals?template=default-smart");
    await ready();
    fireEvent.change(screen.getByLabelText("目标说明"), { target: { value: "正在编辑的草稿" } });
    fireEvent.click(screen.getByText("后续模板请求"));
    expect(text("目标说明")).toBe("正在编辑的草稿");
    expect(params().get("template")).toBe(exploration.id);
    expect(value.templateService.find).not.toHaveBeenCalledWith(exploration.id);
    fireEvent.click(screen.getByRole("button", { name: "取消", exact: true }));
    await waitFor(() => expect(text("目标说明")).toBe(exploration.defaults.description));
    await waitFor(() => expect(params().has("template")).toBe(false));
  });
  it("does not consume a later action request until the current goal closes", async () => {
    const value = context();
    mount(value, "/goals?template=default-smart");
    await ready();
    await waitFor(() => expect(params().has("template")).toBe(false));
    fireEvent.click(screen.getByText("后续行动请求"));
    await waitFor(() => expect(params().get("create")).toBe("action"));
    expect(screen.getByLabelText("目标名称")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消", exact: true }));
    await screen.findByLabelText("行动名称");
    await waitFor(() => expect(params().has("create")).toBe(false));
    expect(screen.getByLabelText("当前位置").textContent).toContain("#action-source");
  });
  it("ignores replaced and unmounted asynchronous template reads", async () => {
    const value = context();
    const pending = deferred<Template | null>();
    value.templateService.find.mockReturnValueOnce(pending.promise);
    const view = mount(value, "/goals?template=old");
    await screen.findByText("正在读取目标模板");
    fireEvent.click(screen.getByText("后续模板请求"));
    await ready();
    await act(async () => pending.resolve(smart));
    expect(text("目标说明")).toBe(exploration.defaults.description);
    view.unmount();
    const pendingAfter = deferred<Template | null>();
    value.templateService.find.mockReturnValueOnce(pendingAfter.promise);
    const next = mount(value, "/goals?template=old");
    await screen.findByText("正在读取目标模板");
    next.unmount();
    await act(async () => pendingAfter.resolve(smart));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("guards duplicate save, dismissal and editing while preserving the draft after failure", async () => {
    const value = context();
    const pending = deferred<Goal>();
    value.goalService.create.mockReturnValueOnce(pending.promise);
    mount(value, "/goals?template=default-smart");
    await ready();
    fireEvent.change(screen.getByLabelText("目标名称"), { target: { value: "我的方向" } });
    const dialog = screen.getByRole("dialog");
    fireEvent.submit(dialog.querySelector("form")!);
    fireEvent.submit(dialog.querySelector("form")!);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByLabelText("目标名称").matches(":disabled")).toBe(true);
    expect(value.goalService.create).toHaveBeenCalledTimes(1);
    await act(async () => pending.reject(new Error("保存失败，请重试。")));
    expect((await screen.findByRole("alert")).textContent).toBe("保存失败，请重试。");
    expect(text("目标名称")).toBe("我的方向");
    expect(screen.getByLabelText("目标名称").matches(":disabled")).toBe(false);
    expect(screen.getAllByRole("group", { name: /进度项 \d/ })).toHaveLength(2);
  });
  it("ignores template props while updating existing goals without replacing progress items", async () => {
    const value = context();
    const goal = { id: "existing", title: "旧目标", description: "历史说明", status: "active",
      domainId: null, domainIds: [], parentId: null, targetDate: null } as Goal;
    const onSaved = vi.fn();
    value.goalService.update.mockResolvedValue(goal);
    render(<LifeOSContext.Provider value={value as unknown as LifeOSContextValue}>
      <MemoryRouter initialEntries={["/goals?template=default-smart"]}>
        <GoalEditorDialog goal={goal} template={smart} goals={[goal]} domains={[]}
          onClose={vi.fn()} onSaved={onSaved} />
      </MemoryRouter>
    </LifeOSContext.Provider>);
    expect(text("目标说明")).toBe("历史说明");
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(goal));
    expect(value.goalService.update).toHaveBeenCalledWith(goal.id, expect.objectContaining({ description: "历史说明" }));
    expect(value.goalService.create).not.toHaveBeenCalled();
    expect(value.templateService.find).not.toHaveBeenCalled();
    expect(value.templateService.getDefaultTemplate).not.toHaveBeenCalled();
  });
});
