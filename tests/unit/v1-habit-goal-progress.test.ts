import { describe, expect, it } from "vitest";
import type { Habit, HabitLog } from "../../src/domain/habits/Habit";
import { calculateHabitGoalProgress, normalizeHabitGoalSettings,
  type HabitGoalProgressSetting } from "../../src/domain/progress/HabitGoalProgress";

const habit = (id: string, overrides: Partial<Habit> = {}): Habit => ({
  id, title: id, intention: "", weeklyTarget: 7, stableContext: "",
  triggerCondition: "", obstacle: "", adjustment: "", startOn: "2026-09-01",
  domainIds: [], archived: false, createdAt: "now", updatedAt: "now", ...overrides,
});
const setting = (habitId: string, overrides: Partial<HabitGoalProgressSetting> = {}) => ({
  habitId, startOn: "2026-09-07", endOn: "2026-09-27",
  weeklyTarget: 2, weight: 1, ...overrides,
});
const log = (habitId: string, recordedOn: string, completed = true): HabitLog => ({
  id: `${habitId}-${recordedOn}`, habitId, recordedOn, completed,
  obstacle: "", adjustment: "", createdAt: "now", updatedAt: "now",
});
const calculate = (settings: HabitGoalProgressSetting[], habits: Habit[], logs: HabitLog[]) =>
  calculateHabitGoalProgress(settings, habits, logs, "2026-10-10");

describe("V1 habit goal progress engine", () => {
  it("uses goal frequency independently and keeps input facts unchanged", () => {
    const habits = [habit("walk")];
    const settings = [setting("walk")];
    const logs = [log("walk", "2026-09-07")];
    const before = JSON.stringify({ habits, settings, logs });
    expect(calculate(settings, habits, logs)).toEqual({ percent: 50, contributions: [{
      habitId: "walk", weight: 1, percent: 50, completed: 1, expected: 2, recordedWeeks: 1,
    }] });
    expect(JSON.stringify({ habits, settings, logs })).toBe(before);
    expect(calculate([setting("walk", { weeklyTarget: 4 })], habits, logs).percent).toBe(25);
  });

  it("weights rates instead of pooling counts with different frequencies", () => {
    const settings = [setting("walk", { weight: 3 }), setting("read", { weeklyTarget: 1 })];
    const result = calculate(settings, [habit("walk"), habit("read")],
      [log("walk", "2026-09-07"), log("read", "2026-09-07")]);
    expect(result.percent).toBe(63);
    expect(result.contributions.map((item) => item.percent)).toEqual([50, 100]);
  });

  it("rounds once after weighting the unrounded ratios", () => {
    expect(calculate([setting("a", { weeklyTarget: 6 }), setting("b")],
      [habit("a"), habit("b")], [log("a", "2026-09-07"), log("b", "2026-09-07", false)])
      .percent).toBe(8);
  });

  it("keeps the whole goal unknown if one habit has no facts or is missing", () => {
    const settings = [setting("walk"), setting("read")];
    const logs = [log("walk", "2026-09-07"), log("walk", "2026-09-08")];
    expect(calculate(settings, [habit("walk"), habit("read")], logs).percent).toBeNull();
    const missing = calculate(settings, [habit("walk")], [...logs, log("read", "2026-09-07")]);
    expect(missing.percent).toBeNull();
    expect(missing.contributions[1]).toMatchObject({ percent: null, expected: 0 });
    expect(calculate([setting("walk")], [habit("walk")], []).percent).toBeNull();
  });

  it("counts explicit uncompleted facts as zero without filling unrecorded weeks", () => {
    const result = calculate([setting("walk")], [habit("walk")],
      [log("walk", "2026-09-07", false), log("other", "2026-09-14")]);
    expect(result).toMatchObject({ percent: 0, contributions: [{ recordedWeeks: 1, expected: 2 }] });
  });

  it("preserves archived facts, deduplicates and caps each week", () => {
    const result = calculate([setting("walk")], [habit("walk", { archived: true })],
      [log("walk", "2026-09-07"), log("walk", "2026-09-07"),
        log("walk", "2026-09-08"), log("walk", "2026-09-09")]);
    expect(result).toMatchObject({ percent: 100, contributions: [{ completed: 2, expected: 2 }] });
  });

  it("uses each selected period and excludes partial, current and future weeks", () => {
    const result = calculate([setting("walk", { startOn: "2026-09-08", endOn: "2026-10-09" })],
      [habit("walk")], [log("walk", "2026-09-08"), log("walk", "2026-09-14"),
        log("walk", "2026-10-09"), log("walk", "2026-10-12")]);
    expect(result).toMatchObject({ percent: 50, contributions: [{ recordedWeeks: 1 }] });
    expect(calculate([setting("walk")], [habit("walk", { startOn: "2026-09-08" })],
      [log("walk", "2026-09-08")]).percent).toBeNull();
  });

  it("normalizes identifiers without retaining caller-owned configuration", () => {
    const input = [setting(" walk ")];
    const normalized = normalizeHabitGoalSettings(input);
    expect(normalized[0].habitId).toBe("walk");
    expect(normalized[0]).not.toBe(input[0]);
    expect(input[0].habitId).toBe(" walk ");
  });

  it("rejects empty, excessive, missing and duplicate associations", () => {
    expect(() => normalizeHabitGoalSettings([])).toThrow("关联");
    expect(() => normalizeHabitGoalSettings(Array.from({ length: 31 }, (_, i) => setting(`${i}`))))
      .toThrow("30");
    expect(() => normalizeHabitGoalSettings([setting("")])).toThrow("缺失");
    expect(() => normalizeHabitGoalSettings([setting("walk"), setting(" walk ")])).toThrow("重复");
    expect(() => normalizeHabitGoalSettings(null as unknown as HabitGoalProgressSetting[])).toThrow("关联");
    expect(() => normalizeHabitGoalSettings([null as unknown as HabitGoalProgressSetting])).toThrow("无效");
    expect(() => normalizeHabitGoalSettings(new Array<HabitGoalProgressSetting>(1))).toThrow("无效");
  });

  it("rejects invalid dates, ranges, frequencies and weights", () => {
    for (const overrides of [{ startOn: "2026-02-30" }, { endOn: "invalid" },
      { startOn: "2026-10-01" }, { weeklyTarget: 0 }, { weeklyTarget: 8 },
      { weeklyTarget: 1.5 }, { weeklyTarget: NaN }, { weight: 0 }, { weight: -1 },
      { weight: 101 }, { weight: Infinity }, { weight: NaN }]) {
      expect(() => normalizeHabitGoalSettings([setting("walk", overrides)])).toThrow();
    }
    expect(() => calculateHabitGoalProgress([setting("walk")], [habit("walk")], [], "2026-02-30"))
      .toThrow("计算日期");
  });
});
