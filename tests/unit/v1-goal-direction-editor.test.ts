import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { GoalDirectionEditor } from "../../src/components/GoalDirectionEditor";
import type { GoalDraft } from "../../src/domain/planning/Goal";
afterEach(cleanup);
const draft = { title: "目标", description: "", domainId: null, status: "active", targetDate: null, horizon: "annual", directionId: "archived" } as GoalDraft;
const directions = [
  { id: "active", kind: "vision", title: "持续成长", archivedAt: null },
  { id: "archived", kind: "vision", title: "原有方向", archivedAt: "2026-10-12" },
  { id: "other", kind: "vision", title: "其他归档方向", archivedAt: "2026-10-12" },
  { id: "principle", kind: "principle", title: "保持诚实", archivedAt: null },
];
function mount(list: ReturnType<typeof vi.fn>, value = draft, disabled = false, allowMissingDirection = false) {
  const onChange = vi.fn();
  render(createElement(LifeOSContext.Provider, { value: { lifeNavigationService: { list } } as unknown as LifeOSContextValue },
    createElement(GoalDirectionEditor, { draft: value, onChange, disabled, allowMissingDirection })));
  return onChange;
}
it("shows Chinese horizons, keeps the linked archived vision and excludes other archived records", async () => {
  const onChange = mount(vi.fn().mockResolvedValue(directions));
  const select = screen.getByLabelText("长期方向") as HTMLSelectElement;
  await waitFor(() => expect(select.disabled).toBe(false));
  expect(select.value).toBe("archived");
  expect(Array.from(select.options).map(option => option.text)).toEqual(["未关联", "持续成长", "原有方向（已归档）"]);
  expect(Array.from((screen.getByLabelText("目标周期") as HTMLSelectElement).options).map(option => option.text)).toEqual(["未分类", "年度目标", "季度目标", "阶段目标", "月度重点"]);
  expect(select.required).toBe(true);
  fireEvent.change(select, { target: { value: "active" } });
  expect(onChange).toHaveBeenLastCalledWith({ directionId: "active" });
  fireEvent.change(screen.getByLabelText("目标周期"), { target: { value: "month" } });
  expect(onChange).toHaveBeenLastCalledWith({ horizon: "month" });
});
it("disables loading choices and retries a failed read without changing the draft", async () => {
  const list = vi.fn().mockRejectedValueOnce(new Error("read failed")).mockResolvedValue(directions);
  const onChange = mount(list);
  expect((screen.getByLabelText("长期方向") as HTMLSelectElement).disabled).toBe(true);
  await screen.findByRole("alert");
  expect((screen.getByLabelText("长期方向") as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect((screen.getByLabelText("长期方向") as HTMLSelectElement).value).toBe("archived"));
  expect(list).toHaveBeenCalledTimes(2);
  expect(onChange).not.toHaveBeenCalled();
});
it("preserves optional legacy annual records and respects saving state", async () => {
  mount(vi.fn().mockResolvedValue(directions), { ...draft, directionId: null }, true, true);
  await waitFor(() => expect(screen.getByRole("option", { name: "持续成长" })).toBeTruthy());
  const select = screen.getByLabelText("长期方向") as HTMLSelectElement;
  expect(select.required).toBe(false);
  expect(select.disabled).toBe(true);
  expect((screen.getByLabelText("目标周期") as HTMLSelectElement).disabled).toBe(true);
});

