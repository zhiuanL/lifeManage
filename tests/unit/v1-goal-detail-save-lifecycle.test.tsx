import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { GoalSectionEditor } from "../../src/components/GoalSectionEditor";
import { GoalProgressSectionEditor } from "../../src/components/GoalProgressSectionEditor";
import { GoalEditorDialog } from "../../src/components/GoalEditorDialog";
import { GoalProgressDialog } from "../../src/components/GoalProgressDialog";
import { GoalValidationError, normalizeGoalDraft, type Goal } from "../../src/domain/planning/Goal";
import { ProgressItemValidationError, validateProgressItems, type GoalProgressItem } from "../../src/domain/progress/GoalProgressItem";
import { GoalDetailPage } from "../../src/pages/GoalDetailPage";

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const goal: Goal = {
  id: "original", title: "原目标", description: "", domainId: null, domainIds: [],
  parentId: null, status: "active", targetDate: null, sortOrder: 0,
  completedAt: null, createdAt: "2026-10-22", updatedAt: "2026-10-22",
};
const item: GoalProgressItem = {
  id: "item", goalId: goal.id, kind: "key_result", title: "阅读章节",
  targetValue: 4, currentValue: 2, weight: 1, sortOrder: 0,
  createdAt: "2026-10-22", updatedAt: "2026-10-22",
};
function context(save = vi.fn(), list = vi.fn().mockResolvedValue([goal])) {
  return {
    goalService: { list, updateSection: save },
    goalProgressItemService: { list: vi.fn().mockResolvedValue([]), replace: save },
    actionService: { list: vi.fn().mockResolvedValue([]) },
    lifeDomainService: { list: vi.fn().mockResolvedValue([]) },
    habitService: { list: vi.fn().mockResolvedValue([]), listLogs: vi.fn().mockResolvedValue([]) },
    lifeNavigationService: { list: vi.fn().mockResolvedValue([]) },
  } as unknown as LifeOSContextValue;
}

describe.each(["section", "items"] as const)("goal detail %s editor", (kind) => {
  function editor(value: LifeOSContextValue, target: Goal, saved = vi.fn(), cancel = vi.fn()) {
    return <LifeOSContext.Provider value={value}>
      {kind === "section" ? <GoalSectionEditor goal={target} section="basics" goals={[target]}
        domains={[]} habits={[]} onSaved={saved} onCancel={cancel} /> :
        <GoalProgressSectionEditor goal={target} items={[item]} onSaved={saved} onCancel={cancel} />}
    </LifeOSContext.Provider>;
  }
  const label = kind === "section" ? "目标名称" : "名称";
  it("locks submit, fields and cancellation synchronously; preserves a failed draft", async () => {
    const pending = deferred<Goal | readonly GoalProgressItem[]>();
    const save = vi.fn().mockReturnValueOnce(pending.promise)
      .mockResolvedValue(kind === "section" ? goal : [item]);
    const saved = vi.fn(), cancel = vi.fn();
    render(editor(context(save), goal, saved, cancel));
    fireEvent.change(screen.getByLabelText(label), { target: { value: "保留草稿" } });
    const form = screen.getByRole("form");
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.change(screen.getByLabelText(label), { target: { value: "不能覆盖" } });
      fireEvent.keyDown(form, { key: "Escape" });
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("保留草稿");
    expect(screen.getByLabelText(label).matches(":disabled")).toBe(true);
    await act(async () => pending.reject(new Error("SQL C:\\private\\lifeos.db")));
    expect(screen.getByRole("alert").textContent).toBe("保存失败，请重试。");
    expect(screen.getByLabelText(label).matches(":disabled")).toBe(false);
    fireEvent.submit(form);
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledTimes(2);
    if (kind === "section") expect(save).toHaveBeenLastCalledWith(goal.id, "basics",
      expect.objectContaining({ title: "保留草稿" }));
    else expect(save).toHaveBeenLastCalledWith(goal.id,
      [expect.objectContaining({ id: item.id, title: "保留草稿" })]);
  });
  it("keeps original goal/service ownership and notifies the current mounted callback", async () => {
    const pending = deferred<Goal | readonly GoalProgressItem[]>();
    const save = vi.fn().mockReturnValue(pending.promise), replacementSave = vi.fn();
    const previousSaved = vi.fn(), currentSaved = vi.fn();
    const view = render(editor(context(save), goal, previousSaved));
    fireEvent.change(screen.getByLabelText(label), { target: { value: "原草稿" } });
    view.rerender(editor(context(replacementSave), { ...goal, id: "replacement" }, currentSaved));
    fireEvent.submit(screen.getByRole("form"));
    expect(save.mock.calls[0][0]).toBe(goal.id);
    expect(replacementSave).not.toHaveBeenCalled();
    const result = kind === "section" ? goal : [item];
    await act(async () => pending.resolve(result));
    expect(currentSaved).toHaveBeenCalledWith(result);
    expect(previousSaved).not.toHaveBeenCalled();
  });
  it("ignores save completion after unmount", async () => {
    const pending = deferred<Goal | readonly GoalProgressItem[]>();
    const saved = vi.fn();
    const view = render(editor(context(vi.fn().mockReturnValue(pending.promise)), goal, saved));
    fireEvent.submit(screen.getByRole("form"));
    view.unmount();
    await act(async () => pending.resolve(kind === "section" ? goal : [item]));
    expect(saved).not.toHaveBeenCalled();
  });
  it("shows actionable validation without treating storage errors as validation", async () => {
    const reason = kind === "section" ? new GoalValidationError("请填写目标名称。") :
      new ProgressItemValidationError("请填写进度项名称。");
    render(editor(context(vi.fn().mockRejectedValue(reason)), goal));
    fireEvent.submit(screen.getByRole("form"));
    expect((await screen.findByRole("alert")).textContent).toBe(reason.message);
  });
});

function page(value: LifeOSContextValue) {
  return <MemoryRouter initialEntries={["/goals/original"]}>
    <LifeOSContext.Provider value={value}><Routes>
      <Route path="/goals/:goalId" element={<GoalDetailPage />} />
    </Routes></LifeOSContext.Provider>
  </MemoryRouter>;
}

it("retains an inline draft across route changes and does not redirect its save", async () => {
  const other = { ...goal, id: "other", title: "另一目标" };
  const pending = deferred<Goal>();
  const save = vi.fn().mockReturnValue(pending.promise);
  const value = context(save, vi.fn().mockResolvedValue([goal, other]));
  // An explicit relation provides the page's normal navigation path.
  value.goalService.list = vi.fn().mockResolvedValue([
    { ...goal, relations: [{ targetGoalId: other.id, type: "related" }] }, other,
  ]);
  render(page(value));
  fireEvent.click(await screen.findByRole("button", { name: "编辑基本信息" }));
  const form = screen.getByRole("form");
  fireEvent.change(screen.getByLabelText("目标名称"), { target: { value: "原目标草稿" } });
  fireEvent.click(screen.getByRole("link", { name: other.title }));
  await screen.findByText("当前草稿仍属于“原目标”。");
  expect(screen.getByRole("form")).toBe(form);
  fireEvent.submit(form);
  await act(async () => pending.resolve({ ...goal, title: "原目标草稿" }));
  await screen.findByRole("heading", { name: other.title });
  expect(save).toHaveBeenCalledWith(goal.id, "basics", expect.objectContaining({ title: "原目标草稿" }));
  expect(screen.queryByRole("form")).toBeNull();
});

it("keeps drafts during replacement reads, failure and retry; discards old save results", async () => {
  const pendingSave = deferred<Goal>(), pendingRead = deferred<readonly Goal[]>();
  const save = vi.fn().mockReturnValue(pendingSave.promise);
  const oldValue = context(save);
  const newList = vi.fn().mockReturnValueOnce(pendingRead.promise)
    .mockRejectedValueOnce(new Error("SQL private"))
    .mockResolvedValue([{ ...goal, title: "新来源目标" }]);
  const newSave = vi.fn();
  const newValue = context(newSave, newList);
  const view = render(page(oldValue));
  fireEvent.click(await screen.findByRole("button", { name: "编辑基本信息" }));
  const form = screen.getByRole("form");
  fireEvent.change(screen.getByLabelText("目标名称"), { target: { value: "旧来源草稿" } });
  view.rerender(page(newValue));
  expect(screen.getByRole("form")).toBe(form);
  await act(async () => pendingRead.reject(new Error("SQL private")));
  expect(screen.getByRole("alert").textContent).not.toContain("SQL");
  fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
  await waitFor(() => expect(newList).toHaveBeenCalledTimes(2));
  await screen.findByRole("alert");
  expect(screen.getByRole("form")).toBe(form);
  fireEvent.submit(form);
  await act(async () => pendingSave.resolve({ ...goal, title: "旧来源草稿" }));
  await screen.findByRole("heading", { name: "新来源目标" });
  expect(newSave).not.toHaveBeenCalled();
  expect(save.mock.calls[0][0]).toBe(goal.id);
});

it("does not show a previous service snapshot while its replacement is loading", async () => {
  const view = render(page(context()));
  await screen.findByRole("heading", { name: goal.title });
  const pending = deferred<readonly Goal[]>();
  view.rerender(page(context(vi.fn(), vi.fn().mockReturnValue(pending.promise))));
  expect(screen.queryByRole("heading", { name: goal.title })).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("正在读取目标详情");
  await act(async () => pending.resolve([{ ...goal, title: "新来源" }]));
  await screen.findByRole("heading", { name: "新来源" });
});

it("uses saved progress facts without a second read or repeated persistence", async () => {
  const save = vi.fn().mockResolvedValue([item]);
  const value = context(save);
  render(page(value));
  fireEvent.click(await screen.findByRole("button", { name: "编辑进度项" }));
  fireEvent.click(screen.getByRole("button", { name: "添加进度项" }));
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: item.title } });
  fireEvent.submit(screen.getByRole("form"));
  await screen.findByText("当前进度 50%");
  expect(save).toHaveBeenCalledTimes(1);
  expect(value.goalProgressItemService.list).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("form")).toBeNull();
});

it("translates goal setting and progress-item input failures to typed validation", () => {
  expect(() => normalizeGoalDraft({ ...goal, progressWeight: 0 })).toThrow(GoalValidationError);
  expect(() => normalizeGoalDraft({ ...goal, habitProgress: [] })).toThrow(GoalValidationError);
  expect(() => validateProgressItems([{ ...item, targetValue: 0 }])).toThrow(ProgressItemValidationError);
});

describe.each(["goal", "progress"] as const)("planning %s dialog ownership", (kind) => {
  it("keeps the original service and goal, locks draft mutation and uses the latest callback", async () => {
    const pending = deferred<Goal | readonly GoalProgressItem[]>();
    const save = vi.fn().mockReturnValue(pending.promise), nextSave = vi.fn();
    const before = context(save), after = context(nextSave);
    before.goalService.update = save;
    after.goalService.update = nextSave;
    const previousSaved = vi.fn(), currentSaved = vi.fn();
    function dialog(value: LifeOSContextValue, target: Goal, saved: typeof currentSaved) {
      return <MemoryRouter><LifeOSContext.Provider value={value}>
        {kind === "goal" ? <GoalEditorDialog goal={target} goals={[target]} domains={[]}
          onClose={vi.fn()} onSaved={saved} /> :
          <GoalProgressDialog goal={target} items={[item]} onClose={vi.fn()} onSaved={saved} />}
      </LifeOSContext.Provider></MemoryRouter>;
    }
    const label = kind === "goal" ? "目标名称" : "名称";
    const view = render(dialog(before, goal, previousSaved));
    fireEvent.change(screen.getByLabelText(label), { target: { value: "原草稿" } });
    view.rerender(dialog(after, { ...goal, id: "replacement" }, currentSaved));
    const form = screen.getByRole("dialog").querySelector("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.change(screen.getByLabelText(label), { target: { value: "不应覆盖" } });
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBe(goal.id);
    expect(nextSave).not.toHaveBeenCalled();
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("原草稿");
    await act(async () => pending.resolve(kind === "goal" ? goal : [item]));
    expect(currentSaved).toHaveBeenCalledTimes(1);
    expect(previousSaved).not.toHaveBeenCalled();
  });
});
