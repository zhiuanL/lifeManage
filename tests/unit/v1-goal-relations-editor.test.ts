import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { GoalEditorDialog } from "../../src/components/GoalEditorDialog";
import type { Goal } from "../../src/domain/planning/Goal";
afterEach(cleanup);
const target = { id: "target", title: "长期方向" } as Goal;
const goal = { id: "source", title: "当前目标", description: "", status: "active", progressMode: "automatic", domainIds: [], relations: [] } as unknown as Goal;
function mount(value: Goal, update: ReturnType<typeof vi.fn>) {
  return render(createElement(MemoryRouter, null, createElement(LifeOSContext.Provider,
    { value: { lifeNavigationService: { list: vi.fn().mockResolvedValue([]) }, goalService: { update } } as unknown as LifeOSContextValue },
    createElement(GoalEditorDialog, { goal: value, goals: [value, target], domains: [], onClose: vi.fn(), onSaved: vi.fn() }))));
}
it("edits Chinese relations, excludes self and retains drafts after failure", async () => {
  const update = vi.fn().mockRejectedValueOnce(new Error("保存失败，请重试")).mockResolvedValue(goal);
  mount(goal, update);
  const summary = screen.getByText("目标关系", { selector: "summary" });
  expect(summary.parentElement).toHaveProperty("open", false);
  fireEvent.click(summary);
  fireEvent.click(screen.getByRole("button", { name: "添加关系" }));
  expect(screen.getByLabelText("关联目标 1").querySelectorAll("option")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("关系类型 1"), { target: { value: "depend" } });
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await screen.findByText("保存失败，请重试。");
  expect(screen.getByLabelText("关系类型 1")).toHaveProperty("value", "depend");
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update).toHaveBeenLastCalledWith("source", expect.objectContaining({ relations: [{ targetGoalId: "target", type: "depend" }] }));
});
it("reopens existing relations and saves explicit removal", async () => {
  const update = vi.fn().mockResolvedValue(goal);
  mount({ ...goal, relations: [{ targetGoalId: "target", type: "support" }] }, update);
  fireEvent.click(screen.getByText("目标关系（1）", { selector: "summary" }));
  expect(screen.getByLabelText("关系类型 1")).toHaveProperty("value", "support");
  fireEvent.click(screen.getByRole("button", { name: "移除目标关系 1" }));
  expect(screen.queryByLabelText("关系类型 1")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith("source", expect.objectContaining({ relations: [] })));
});
