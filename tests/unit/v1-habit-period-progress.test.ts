import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { HabitPeriodSummary } from "../../src/components/HabitPeriodSummary";
import type { Habit, HabitLog } from "../../src/domain/habits/Habit";
import { calculateHabitPeriodProgress } from "../../src/domain/habits/HabitPeriodProgress";

afterEach(cleanup);
const habit: Habit = { id: "walk", title: "散步", intention: "", weeklyTarget: 3,
  stableContext: "", triggerCondition: "", obstacle: "", adjustment: "",
  startOn: "2026-09-01", domainIds: [], archived: false, createdAt: "now", updatedAt: "now" };
const log = (recordedOn: string, completed = true, habitId = habit.id): HabitLog => ({
  id: `${habitId}-${recordedOn}`, habitId, recordedOn, completed, obstacle: "",
  adjustment: "", createdAt: "now", updatedAt: "now",
});
const calculate = (logs: HabitLog[], start = "2026-09-01", end = "2026-10-10") =>
  calculateHabitPeriodProgress(habit, logs, start, end, "2026-10-10");

describe("V1 habit period progress", () => {
  it("counts only recorded complete weeks without filling gaps", () => {
    expect(calculate([log("2026-09-07"), log("2026-09-08"), log("2026-09-21")]))
      .toEqual({ percent: 50, completed: 3, expected: 6, recordedWeeks: 2 });
  });
  it("excludes partial first and last weeks and the unfinished current week", () => {
    expect(calculate([log("2026-09-01"), log("2026-09-07"), log("2026-09-14"), log("2026-10-09")],
      "2026-09-01", "2026-09-16"))
      .toEqual({ percent: 33, completed: 1, expected: 3, recordedWeeks: 1 });
    expect(calculate([log("2026-10-09")])).toMatchObject({ percent: null, recordedWeeks: 0 });
  });
  it("returns unknown for no facts and zero for a recorded unfinished week", () => {
    expect(calculate([])).toEqual({ percent: null, completed: 0, expected: 0, recordedWeeks: 0 });
    expect(calculate([log("2026-09-07", false)])).toMatchObject({ percent: 0, expected: 3 });
  });
  it("filters other habits, invalid and future dates", () => {
    expect(calculate([log("2026-09-07", true, "other"), log("2026-02-30"), log("2026-10-12")]))
      .toMatchObject({ percent: null, recordedWeeks: 0 });
  });
  it("deduplicates days and caps each week at its target", () => {
    expect(calculate([log("2026-09-07"), log("2026-09-07"), log("2026-09-08"),
      log("2026-09-09"), log("2026-09-10")])).toMatchObject({ percent: 100, completed: 3 });
  });
  it("includes a Sunday only after the week has ended", () => {
    const logs = [log("2026-09-13")];
    expect(calculateHabitPeriodProgress(habit, logs, "2026-09-07", "2026-09-13", "2026-09-13"))
      .toMatchObject({ percent: null });
    expect(calculateHabitPeriodProgress(habit, logs, "2026-09-07", "2026-09-13", "2026-09-14"))
      .toMatchObject({ percent: 33 });
  });
  it("rejects invalid and reversed ranges instead of producing a score", () => {
    expect(() => calculate([], "2026-02-30")).toThrow("统计周期");
    expect(() => calculate([], "2026-10-11", "2026-10-10")).toThrow("统计周期");
  });
  it("preserves archived facts and lets the Chinese period controls change the range", () => {
    render(createElement(HabitPeriodSummary, { habit: { ...habit, archived: true },
      logs: [log("2026-09-07"), log("2026-09-08"), log("2026-09-21")], today: "2026-10-10" }));
    fireEvent.click(screen.getByText("周期统计"));
    expect(screen.getByText("50%")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("周期开始"), { target: { value: "2026-09-14" } });
    expect(screen.getByText("33%")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("周期结束"), { target: { value: "2026-09-13" } });
    expect(screen.getByRole("alert").textContent).toContain("统计周期");
    expect(screen.queryByText("33%")).toBeNull();
  });
});
