import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import {
  buildContextDocument, exportTypes, fieldPresets, scenarioPresets, type ExportRecord,
} from "../../src/domain/export/ContextExport";
import { exportDraftDefaults } from "../../src/domain/export/ExportTemplate";
import { builtInTemplates, validateTemplate, type Template } from "../../src/domain/templates/Template";
import { ContextExportPage } from "../../src/pages/ContextExportPage";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const preset = builtInTemplates.find(item => item.id === "default-export-goal-analysis")!;
const old: Template = { ...preset, id: "old", name: "旧导出模板", defaults: {
  scenario: "goal-analysis", sections: ["goal"], fields: { goal: ["说明"] }, question: "旧模板问题",
} };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function context() {
  const records: ExportRecord[] = [
    { type: "domain", id: "d", title: "健康", date: "2026-10-21", domainIds: [],
      goalId: null, privacy: "normal", fields: [], links: [] },
    { type: "goal", id: "g", title: "照看身体", date: "2026-10-21", domainIds: ["d"],
      goalId: null, privacy: "private", fields: [{ label: "说明", value: "保存的说明" }], links: [] },
  ];
  return {
    environment: "browser-preview",
    contextExportService: {
      loadRecords: vi.fn(async () => records),
      setPrivacy: vi.fn(async () => {}),
    },
    templateService: { find: vi.fn(async (id: string): Promise<Template | null> =>
      id === "old" ? old : builtInTemplates.find(item => item.id === id) ?? null) },
  };
}
function Host() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output aria-label="当前位置">{location.pathname + location.search + location.hash}</output>
    <button onClick={() => navigate("/export?template=old&keep=1&keep=2#source")}>后续模板请求</button>
    <button onClick={() => navigate(`/export?template=${preset.id}&keep=1#new`)}>替换模板请求</button>
    <ContextExportPage />
  </>;
}
function mount(value: ReturnType<typeof context>, path = "/export") {
  return render(<LifeOSContext.Provider value={value as unknown as LifeOSContextValue}>
    <MemoryRouter initialEntries={[path]}><Host /></MemoryRouter>
  </LifeOSContext.Provider>);
}
function params() {
  return new URL(screen.getByLabelText("当前位置").textContent ?? "", "http://localhost").searchParams;
}
function text(label: string) {
  return (screen.getByLabelText(label, { selector: "input:not([type=checkbox]), select, textarea" }) as HTMLInputElement).value;
}
async function ready() {
  await screen.findByRole("heading", { name: "导出预览" });
}
function allowPrivate() {
  fireEvent.change(screen.getByLabelText("允许纳入的最高隐私等级"), { target: { value: "private" } });
  fireEvent.click(screen.getByLabelText(/我已查看预览/));
}

describe("export template application boundaries", () => {
  it("retains stored legacy text but rejects an overlong actual question without truncating", () => {
    const defaults = { ...old.defaults, question: "字".repeat(2000) };
    expect(validateTemplate("export", "旧模板", defaults).defaults.question).toHaveLength(2000);
    expect(() => exportDraftDefaults(defaults)).toThrow("1000");
    expect(exportDraftDefaults({ ...old.defaults, question: "字".repeat(1000) }).question).toHaveLength(1000);
    expect(defaults.question).toHaveLength(2000);
  });
  it("keeps explicit field restrictions and clones all lists independently", () => {
    const original = JSON.stringify(old.defaults);
    const draft = exportDraftDefaults(old.defaults);
    expect(draft.sections).toEqual(["goal"]);
    expect(draft.fieldOrder.goal).toEqual(["说明"]);
    expect(draft.fieldOrder.action).toEqual(fieldPresets.action);
    draft.sections.push("action");
    draft.fieldOrder.goal.push("状态");
    draft.fieldOrder.action.pop();
    expect(JSON.stringify(old.defaults)).toBe(original);
    expect(exportDraftDefaults({ ...old.defaults, fields: { goal: [] }, sections: [] }))
      .toMatchObject({ sections: [], fieldOrder: { goal: [] } });
  });
  it("rejects invalid sections, fields, questions and instance/privacy settings", () => {
    for (const patch of [
      { scenario: "unknown" }, { sections: ["goal", "goal"] }, { sections: ["inbox"] },
      { fields: { goal: ["说明", "说明"] } }, { fields: { goal: ["internal-id"] } },
      { question: 1 }, { fields: null }, { maxPrivacy: "highly_sensitive" }, { domainId: "d" },
      { format: "json" }, { from: "2026-10-01" }, { goalId: "g" }, { constructor: "unsafe" },
    ]) expect(() => exportDraftDefaults({ ...old.defaults, ...patch })).toThrow();
    expect(() => exportDraftDefaults({ ...old.defaults, ...JSON.parse('{"__proto__":"unsafe"}') })).toThrow();
  });
  it("also validates the question on the actual export path", () => {
    expect(() => buildContextDocument([], "goal-analysis", {
      from: "", to: "", domainId: null, goalId: null, types: [...exportTypes], maxPrivacy: "normal",
    }, scenarioPresets["goal-analysis"].sections, "字".repeat(1001))).toThrow("1000");
  });
});

describe("Chinese export template requests", () => {
  it("waits for valid content and consumes only template parameters while preserving context", async () => {
    const value = context();
    const pending = deferred<Template | null>();
    value.templateService.find.mockReturnValueOnce(pending.promise);
    mount(value, "/export?template=old&domain=d&create=goal&keep=1&keep=2#source");
    await screen.findByText("正在读取导出模板");
    expect(screen.getByLabelText("希望讨论的问题").matches(":disabled")).toBe(true);
    expect(params().get("template")).toBe("old");
    expect((screen.getByRole("button", { name: "复制", exact: true }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => pending.resolve(old));
    await waitFor(() => expect(params().has("template")).toBe(false));
    expect(text("希望讨论的问题")).toBe("旧模板问题");
    expect(text("生活领域")).toBe("d");
    expect(text("允许纳入的最高隐私等级")).toBe("normal");
    expect(params().getAll("keep")).toEqual(["1", "2"]);
    expect(params().get("create")).toBe("goal");
    expect(screen.getByLabelText("当前位置").textContent).toContain("#source");
    expect(value.templateService.find).toHaveBeenCalledTimes(1);
  });
  it.each([null, { ...old, category: "goal" as const }, { ...old, defaults: { ...old.defaults, question: "字".repeat(1001) } }])(
    "retains unavailable or invalid requests until cancellation", async template => {
      const value = context();
      const pending = deferred<Template | null>();
      value.templateService.find.mockReturnValueOnce(pending.promise);
      mount(value, "/export?template=bad&keep=1#source");
      await waitFor(() => expect(value.templateService.find).toHaveBeenCalledWith("bad"));
      await act(async () => pending.resolve(template));
      await screen.findByRole("alert");
      expect(params().get("template")).toBe("bad");
      expect(text("希望讨论的问题")).toBe(scenarioPresets["goal-analysis"].question);
      expect(screen.getByLabelText("希望讨论的问题").matches(":disabled")).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "取消模板请求" }));
      await waitFor(() => expect(params().has("template")).toBe(false));
      expect(screen.getByLabelText("希望讨论的问题").matches(":disabled")).toBe(false);
      expect(params().get("keep")).toBe("1");
    });
  it("sanitizes template read failures and retries the same request", async () => {
    const value = context();
    value.templateService.find.mockRejectedValueOnce(new Error("C:\\private\\data.db SELECT"));
    mount(value, "/export?template=old");
    expect((await screen.findByRole("alert")).textContent).not.toContain("private");
    fireEvent.click(screen.getByRole("button", { name: "重试读取模板" }));
    await waitFor(() => expect(params().has("template")).toBe(false));
    expect(text("希望讨论的问题")).toBe("旧模板问题");
  });
  it("allows record-load retry before reading a pending template", async () => {
    const value = context();
    value.contextExportService.loadRecords.mockRejectedValueOnce(new Error("C:\\private\\data.db"));
    mount(value, "/export?template=old");
    await screen.findByRole("heading", { name: "暂时无法打开上下文导出" });
    expect(value.templateService.find).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重试", exact: true }));
    await waitFor(() => expect(text("希望讨论的问题")).toBe("旧模板问题"));
    await waitFor(() => expect(params().has("template")).toBe(false));
  });
  it("stages later templates without overwriting the question, order, scope or format", async () => {
    const value = context();
    mount(value);
    await ready();
    fireEvent.change(screen.getByLabelText("希望讨论的问题"), { target: { value: "我的草稿" } });
    fireEvent.change(screen.getByRole("combobox", { name: "生活领域", exact: true }), { target: { value: "d" } });
    fireEvent.change(screen.getByLabelText("关联目标"), { target: { value: "g" } });
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "JSON", exact: true }));
    allowPrivate();
    fireEvent.click(screen.getByRole("button", { name: "移除目标的说明" }));
    fireEvent.click(screen.getByLabelText(/我已查看预览/));
    fireEvent.click(screen.getByRole("button", { name: "后续模板请求" }));
    await screen.findByRole("button", { name: "应用模板" });
    expect(text("希望讨论的问题")).toBe("我的草稿");
    expect(screen.queryByRole("button", { name: "移除目标的说明" })).toBeNull();
    expect(params().get("template")).toBe("old");
    fireEvent.click(screen.getByRole("button", { name: "应用模板" }));
    await waitFor(() => expect(params().has("template")).toBe(false));
    expect(text("希望讨论的问题")).toBe("旧模板问题");
    expect(text("生活领域")).toBe("d");
    expect(text("关联目标")).toBe("g");
    expect(text("开始日期")).toBe("2026-10-01");
    expect(text("允许纳入的最高隐私等级")).toBe("private");
    expect(screen.getByRole("button", { name: "JSON", exact: true }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText(/我已查看预览/) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: "复制", exact: true }).hasAttribute("disabled")).toBe(true);
  }, 15000);
  it("cancels a staged template without changing the old draft", async () => {
    mount(context());
    await ready();
    fireEvent.change(screen.getByLabelText("希望讨论的问题"), { target: { value: "保留的草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "后续模板请求" }));
    await screen.findByRole("button", { name: "应用模板" });
    fireEvent.click(screen.getByRole("button", { name: "取消模板请求" }));
    await waitFor(() => expect(params().has("template")).toBe(false));
    expect(text("希望讨论的问题")).toBe("保留的草稿");
  });
  it("requires a fresh confirmation even when a template reproduces the identical preview", async () => {
    const value = context();
    mount(value, "/export?template=old");
    await waitFor(() => expect(text("希望讨论的问题")).toBe("旧模板问题"));
    await waitFor(() => expect(params().has("template")).toBe(false));
    allowPrivate();
    fireEvent.click(screen.getByRole("button", { name: "后续模板请求" }));
    await screen.findByRole("button", { name: "应用模板" });
    fireEvent.click(screen.getByRole("button", { name: "应用模板" }));
    await waitFor(() => expect(params().has("template")).toBe(false));
    expect((screen.getByLabelText(/我已查看预览/) as HTMLInputElement).checked).toBe(false);
  });
  it("ignores a replaced read and requires explicit application after the initial template", async () => {
    const value = context();
    const pending = deferred<Template | null>();
    value.templateService.find.mockReturnValueOnce(pending.promise);
    mount(value, "/export?template=old");
    await screen.findByText("正在读取导出模板");
    await waitFor(() => expect(value.templateService.find).toHaveBeenCalledWith("old"));
    fireEvent.click(screen.getByRole("button", { name: "替换模板请求" }));
    await waitFor(() => expect(params().has("template")).toBe(false));
    await act(async () => pending.resolve(old));
    expect(text("希望讨论的问题")).toBe(preset.defaults.question);
    fireEvent.click(screen.getByRole("button", { name: "后续模板请求" }));
    await screen.findByRole("button", { name: "应用模板" });
    expect(text("希望讨论的问题")).toBe(preset.defaults.question);
  });
  it("drops a cancelled or unmounted template result", async () => {
    const value = context();
    const pending = deferred<Template | null>();
    value.templateService.find.mockReturnValueOnce(pending.promise);
    const view = mount(value, "/export?template=old");
    await screen.findByText("正在读取导出模板");
    await waitFor(() => expect(value.templateService.find).toHaveBeenCalledWith("old"));
    fireEvent.click(screen.getByRole("button", { name: "取消模板请求" }));
    await waitFor(() => expect(params().has("template")).toBe(false));
    await act(async () => pending.resolve(old));
    expect(text("希望讨论的问题")).toBe(scenarioPresets["goal-analysis"].question);
    const late = deferred<Template | null>();
    value.templateService.find.mockReturnValueOnce(late.promise);
    fireEvent.click(screen.getByRole("button", { name: "后续模板请求" }));
    await screen.findByText("正在读取导出模板");
    await waitFor(() => expect(value.templateService.find).toHaveBeenCalledTimes(2));
    view.unmount();
    await act(async () => late.resolve(old));
    expect(screen.queryByText("已复制当前预览。")).toBeNull();
  });
});

describe("export operation guards", () => {
  it("locks the draft during clipboard writes, prevents duplicates and preserves a failure draft", async () => {
    const pending = deferred<void>();
    const writeText = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    mount(context());
    await ready();
    allowPrivate();
    const copy = screen.getByRole("button", { name: "复制", exact: true });
    fireEvent.click(copy);
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("希望讨论的问题").matches(":disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "下载", exact: true }).hasAttribute("disabled")).toBe(true);
    await act(async () => pending.reject(new Error("clipboard permission")));
    await screen.findByText("复制失败，请检查剪贴板权限，或下载文件。");
    expect(text("希望讨论的问题")).toBe(scenarioPresets["goal-analysis"].question);
    fireEvent.click(copy);
    await screen.findByText("已复制当前预览。");
    expect(writeText).toHaveBeenCalledTimes(2);
  });
  it("does not copy private or empty previews and waits for an in-flight operation before applying templates", async () => {
    const pending = deferred<void>();
    const writeText = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const value = context();
    mount(value);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "复制", exact: true }));
    expect(writeText).not.toHaveBeenCalled();
    allowPrivate();
    fireEvent.click(screen.getByRole("button", { name: "复制", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "后续模板请求" }));
    expect(value.templateService.find).not.toHaveBeenCalled();
    await act(async () => pending.resolve(undefined));
    await screen.findByRole("button", { name: "应用模板" });
    expect(text("希望讨论的问题")).toBe(scenarioPresets["goal-analysis"].question);
  });
  it("prevents concurrent privacy writes, sanitizes failures and keeps the user's question", async () => {
    const value = context();
    const pending = deferred<void>();
    value.contextExportService.setPrivacy.mockReturnValueOnce(pending.promise);
    mount(value);
    await ready();
    fireEvent.change(screen.getByLabelText("希望讨论的问题"), { target: { value: "我的问题" } });
    const select = screen.getByLabelText("目标 照看身体 的隐私等级");
    fireEvent.change(select, { target: { value: "normal" } });
    fireEvent.change(select, { target: { value: "highly_sensitive" } });
    expect(value.contextExportService.setPrivacy).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("希望讨论的问题").matches(":disabled")).toBe(true);
    await act(async () => pending.reject(new Error("C:\\private\\data.db")));
    await screen.findByText("隐私等级保存失败，已保留本次选择。请重试或撤销。");
    expect(text("希望讨论的问题")).toBe("我的问题");
    expect(value.contextExportService.loadRecords).toHaveBeenCalledTimes(1);
    expect(select).toHaveProperty("value", "normal");
    fireEvent.click(screen.getByRole("button", { name: "重试保存隐私等级" }));
    await waitFor(() => expect(value.contextExportService.loadRecords).toHaveBeenCalledTimes(2));
  });
  it("does not reload records after an unmounted privacy write", async () => {
    const value = context();
    const pending = deferred<void>();
    value.contextExportService.setPrivacy.mockReturnValueOnce(pending.promise);
    const view = mount(value);
    await ready();
    fireEvent.change(screen.getByLabelText("目标 照看身体 的隐私等级"), { target: { value: "normal" } });
    view.unmount();
    await act(async () => pending.resolve(undefined));
    expect(value.contextExportService.loadRecords).toHaveBeenCalledTimes(1);
  });
  it("reports failed downloads and removes the temporary link and object URL", async () => {
    const create = vi.fn(() => "blob:lifeos-export");
    const revoke = vi.fn();
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementationOnce(() => { throw new Error("download blocked"); })
      .mockImplementation(() => {});
    mount(context());
    await ready();
    allowPrivate();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "下载", exact: true }));
    expect(screen.getByText("下载失败，请重试，或复制当前预览。")).toBeTruthy();
    expect(document.querySelector('a[download]')).toBeNull();
    act(() => vi.advanceTimersByTime(1000));
    expect(revoke).toHaveBeenCalledWith("blob:lifeos-export");
    fireEvent.click(screen.getByRole("button", { name: "下载", exact: true }));
    expect(screen.getByText("已下载当前预览。")).toBeTruthy();
    expect(click).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(1000));
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(document.querySelector('a[download]')).toBeNull();
  });
  it("ignores an unmounted clipboard result", async () => {
    const pending = deferred<void>();
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(() => pending.promise) } });
    const view = mount(context());
    await ready();
    allowPrivate();
    fireEvent.click(screen.getByRole("button", { name: "复制", exact: true }));
    view.unmount();
    await act(async () => pending.resolve(undefined));
    expect(screen.queryByText("已复制当前预览。")).toBeNull();
  });
});
