import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { GoalEditorDialog } from "../../src/components/GoalEditorDialog";
import type { Goal } from "../../src/domain/planning/Goal";
import type { Habit } from "../../src/domain/habits/Habit";
afterEach(cleanup);
const settings = [{ habitId: "walk", startOn: "2026-09-28", endOn: "2026-10-04", weeklyTarget: 3, weight: 1 }];
const habit = { id: "walk", title: "散步", archived: false } as Habit;
const goal = { id: "goal", title: "保持节奏", description: "", status: "active",
  progressMode: "automatic", domainIds: [], habitProgress: settings } as unknown as Goal;
it("reopens Chinese habit settings and retains edits across mode switches", async () => {
  const update = vi.fn().mockResolvedValue(goal);
  render(createElement(MemoryRouter, null, createElement(LifeOSContext.Provider,
    { value: { lifeNavigationService: { list: vi.fn().mockResolvedValue([]) }, goalService: { update } } as unknown as LifeOSContextValue },
    createElement(GoalEditorDialog, { goal, goals: [], domains: [], habits: [habit], onClose: vi.fn(), onSaved: vi.fn() }))));
  fireEvent.click(screen.getByText("进度设置", { selector: "summary" }));
  expect(screen.getByLabelText("进度方式")).toHaveProperty("value", "habit");
  expect(screen.getByLabelText("统计结束")).toHaveProperty("value", "2026-10-04");
  fireEvent.change(screen.getByLabelText("权重"), { target: { value: "" } });
  expect(screen.getByLabelText("权重")).toHaveProperty("value", "");
  fireEvent.change(screen.getByLabelText("权重"), { target: { value: "0.001" } });
  fireEvent.change(screen.getByLabelText("进度方式"), { target: { value: "exploration" } });
  expect(screen.queryByLabelText("权重")).toBeNull();
  fireEvent.change(screen.getByLabelText("进度方式"), { target: { value: "habit" } });
  expect(screen.getByLabelText("权重")).toHaveProperty("value", "0.001");
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith("goal", expect.objectContaining({ habitProgress: [{ ...settings[0], weight: 0.001 }] })));
});
