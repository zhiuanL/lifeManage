import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { AttentionSettingsEditor } from "../../src/components/AttentionSettingsEditor";
import {
  defaultAttentionSettings, findAttentionSignals, validateAttentionSettings, type AttentionSettings,
} from "../../src/domain/attention/Attention";
import type { Habit, HabitLog } from "../../src/domain/habits/Habit";
import { findHabitDeclineSignals } from "../../src/domain/attention/HabitAttentionFacts";
import { AttentionPage } from "../../src/pages/AttentionPage";
import { AttentionService } from "../../src/services/attention/AttentionService";
import type { SystemRepository } from "../../src/repositories/system/SystemRepository";
import type { GoalService } from "../../src/services/planning/GoalService";
import type { ActionService } from "../../src/services/planning/ActionService";
import type { IssueService } from "../../src/services/issues/IssueService";
import type { DomainMetricService } from "../../src/services/life/DomainMetricService";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const now = new Date("2026-10-20T10:00:00");
const savedAt = new Date("2026-10-20T09:00:00").toISOString();
const habit: Habit = {
  id: "习惯 &1", title: "散步", weeklyTarget: 4, startOn: "2026-08-24", archived: false,
  intention: "", stableContext: "", triggerCondition: "", obstacle: "", adjustment: "",
  domainIds: ["health"], createdAt: savedAt, updatedAt: savedAt,
};
const baselineWeeks = ["2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14"];
const latestWeeks = ["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"];

function logsFor(weeks: string[], completed: number, target = habit): HabitLog[] {
  return weeks.flatMap(week => Array.from({ length: Math.max(completed, 1) }, (_, offset) => {
    const day = new Date(`${week}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + offset);
    const date = day.toISOString().slice(0, 10);
    return {
      id: `记录 &${date}`, habitId: target.id, recordedOn: date, completed: completed > 0,
      obstacle: "原始阻碍", adjustment: "原始调整", createdAt: savedAt, updatedAt: savedAt,
    };
  }));
}

const logs = [...logsFor(baselineWeeks, 4), ...logsFor(latestWeeks, 2)];
const settings = { ...defaultAttentionSettings };
function signals(records = logs, target = habit, preferences: AttentionSettings = settings, date = now) {
  return findAttentionSignals([], [], [], preferences, date, [], [], [], [target], records);
}

function service(records = logs) {
  let metadata: string | null = null;
  const system = {
    getMetadata: async () => metadata,
    setMetadata: async (_key: string, value: string) => { metadata = value; },
  } as unknown as SystemRepository;
  const habits = { list: vi.fn().mockResolvedValue([habit]), listLogs: vi.fn().mockResolvedValue(records) };
  const attention = () => new AttentionService(
    { list: async () => [] } as unknown as GoalService,
    { list: async () => [], listPlanChanges: async () => [] } as unknown as ActionService,
    { list: async () => [] } as unknown as IssueService, system, { now: () => now },
    { listDefinitions: async () => [], listRecords: async () => [] } as unknown as DomainMetricService, habits,
    { list: async () => [] }, { list: async () => [] }, { list: async () => [] },
    { listEvents: async () => [] },
  );
  return { attention, habits, system };
}

describe("V1 recorded-week habit attention facts", () => {
  it("does not manufacture periods or throw when the current clock is invalid", () => {
    expect(signals(logs, habit, settings, new Date(NaN))).toEqual([]);
    expect(findHabitDeclineSignals([habit], logs,
      { enabled: true, scope: "all", domainIds: [] }, 20, new Date(NaN))).toEqual([]);
    expect(findHabitDeclineSignals([habit], logs,
      { enabled: true, scope: "all", domainIds: [] }, 20, new Date("0001-01-01T00:00:00Z"))).toEqual([]);
  });

  it("compares two four-week windows and retains the exact source logs without rewriting them", () => {
    const original = structuredClone(logs);
    const [signal] = signals();
    expect(signal.kind).toBe("habit-drop");
    expect(signal.summary).toContain("100% 降至 50%");
    expect(signal.summary).toContain("50 个百分点");
    expect(signal.period).toBe("2026-08-24 至 2026-10-18");
    expect(signal.baseline).toContain("16 / 期望 16");
    expect(signal.baseline).toContain("不代表历史频率");
    expect(signal.sources).toHaveLength(logs.length + 1);
    expect(signal.sources[1].fragment).toBe(`habit-log-${logs[0].id}`);
    expect(logs).toEqual(original);
    expect(signals(logs, habit, { ...settings, habitDropPoints: 51 })).toEqual([]);
    expect(signals(logs, habit, { ...settings, habitDropPoints: 50 })).toHaveLength(1);
  });

  it("keeps blank weeks unknown while explicit incomplete records can give a zero proportion", () => {
    expect(signals(logsFor(baselineWeeks, 4))).toEqual([]);
    const partial = [...logsFor(baselineWeeks.slice(0, 2), 4),
      ...logsFor([latestWeeks[0], latestWeeks[3]], 0)];
    const [signal] = signals(partial);
    expect(signal.summary).toContain("100% 降至 0%");
    expect(signal.baseline).toContain("2 个有记录完整周");
    expect(signal.baseline).toContain("后四周 2026-09-21 至 2026-10-18：2 周");
    expect(signal.baseline).toContain("0 / 8");
    expect(signals([...logsFor(baselineWeeks, 4), ...logsFor([latestWeeks[3]], 0)])).toEqual([]);
    expect(signals([...logsFor([baselineWeeks[0]], 4), ...logsFor(latestWeeks, 0)])).toEqual([]);
    expect(signals([...logsFor(baselineWeeks, 4), ...logsFor(latestWeeks.slice(0, 3), 0)])).toEqual([]);
  });

  it("excludes a partial first week, unfinished current week, future edits and invalid dates", () => {
    const current = logsFor(["2026-10-19"], 0);
    const future = { ...logs[0], id: "future-edit", completed: false,
      updatedAt: new Date(now.getTime() + 86400000).toISOString() };
    const invalid = { ...logs[0], id: "invalid-date", recordedOn: "2026-09-31" };
    const [signal] = signals([...logs, ...current, future, invalid], { ...habit, startOn: "2026-08-25" });
    expect(signal.baseline).toContain("3 个有记录完整周");
    expect(signal.sources.some(source => source.fragment === `habit-log-${logs[0].id}`)).toBe(false);
    expect(signal.sources.some(source => source.id === "future-edit" || source.id === "invalid-date")).toBe(false);
    expect(signal.sources.some(source => source.date >= "2026-10-19")).toBe(false);
    expect(signals(logs, { ...habit, archived: true })).toEqual([]);
    expect(signals(logs, { ...habit, startOn: "2026-09-21" })).toEqual([]);
  });

  it("uses the latest same-day record, requires a strict drop and observes independent scope", () => {
    const replacement = { ...logs[0], id: "replacement", completed: false,
      updatedAt: now.toISOString() };
    const [signal] = signals([...logs, replacement]);
    expect(signal.sources.some(source => source.id === logs[0].id)).toBe(false);
    expect(signal.sources.some(source => source.id === replacement.id)).toBe(true);
    expect(signals([...logsFor(baselineWeeks, 2), ...logsFor(latestWeeks, 2)])).toEqual([]);
    expect(signals([...logsFor(baselineWeeks, 1), ...logsFor(latestWeeks, 2)])).toEqual([]);
    const scoped: AttentionSettings = { ...settings, rules: {
      "habit-drop": { enabled: true, scope: "domains", domainIds: ["health"] },
    } };
    expect(signals(logs, habit, scoped)).toHaveLength(1);
    expect(signals(logs, { ...habit, domainIds: ["work"] }, scoped)).toEqual([]);
    expect(signals(logs, habit, { ...settings, rules: {
      "habit-drop": { enabled: true, scope: "domains", domainIds: [] },
    } })).toEqual([]);
    expect(signals(logs, habit, { ...settings, rules: {
      "habit-drop": { enabled: false, scope: "all", domainIds: [] },
    } })).toEqual([]);
  });

  it("compares the unrounded proportions against the threshold", () => {
    const target = { ...habit, weeklyTarget: 3 };
    const records = [...logsFor(baselineWeeks, 2), ...logsFor(latestWeeks, 1)];
    expect(signals(records, target, { ...settings, habitDropPoints: 34 })).toEqual([]);
    expect(signals(records, target, { ...settings, habitDropPoints: 33 })[0].summary)
      .toContain("33.3 个百分点");
  });

  it("retains legacy settings, persists the new preference and refuses corrupt new values", async () => {
    const { attention, habits, system } = service();
    expect(await attention().getSettings()).toEqual(settings);
    expect((await attention().getSnapshot()).signals).toHaveLength(1);
    expect(habits.list).toHaveBeenCalled();
    expect(habits.listLogs).toHaveBeenCalled();
    const saved: AttentionSettings = { ...settings, habitDropPoints: 60, rules: {
      "habit-drop": { enabled: true, scope: "domains", domainIds: ["health"] },
    } };
    await attention().setSettings(saved);
    expect(await attention().getSettings()).toEqual(saved);
    expect((await attention().getSnapshot()).signals).toEqual([]);
    await expect(attention().setSettings({ ...saved, habitDropPoints: 0 })).rejects.toThrow("1–100");
    expect(await attention().getSettings()).toEqual(saved);
    await system.setMetadata("m5_attention_settings", JSON.stringify({ ...settings, habitDropPoints: "20" }));
    await expect(attention().getSettings()).rejects.toThrow("配置损坏");
    for (const invalid of [0, 101, 1.5, NaN]) {
      expect(() => validateAttentionSettings({ ...settings, habitDropPoints: invalid })).toThrow();
    }
  });

  it("shows explainable Chinese evidence and encoded habit-log source links", async () => {
    const value = {
      attentionService: { getSnapshot: async () => ({ settings, signals: signals() }) },
      lifeDomainService: { list: async () => [] },
    } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider, { value },
      createElement(AttentionPage))));
    await screen.findByRole("heading", { name: habit.title });
    fireEvent.click(screen.getByText("查看依据"));
    expect(screen.getByText("有记录完整周的习惯事实")).toBeTruthy();
    expect(screen.getByRole("link", { name: "2026-08-24 · 已完成" }).getAttribute("href"))
      .toBe(`/habits#${encodeURIComponent(`habit-log-${logs[0].id}`)}`);
    expect(screen.getByText(/两期均按当前每周期望/)).toBeTruthy();
  });

  it("keeps the threshold draft on save failure and requires an explicit save", async () => {
    const { attention } = service();
    const instance = attention();
    const save = vi.spyOn(instance, "setSettings").mockRejectedValueOnce(new Error("SQLITE_BUSY: private path"));
    const value = { attentionService: instance, lifeDomainService: { list: async () => [] } } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider, { value },
      createElement(AttentionSettingsEditor))));
    const rules = within(await screen.findByRole("region", { name: "提醒规则" }));
    const input = await rules.findByLabelText("习惯完成比例下降（百分点）");
    expect((input as HTMLInputElement).value).toBe("20");
    expect(rules.getByRole("checkbox", { name: "习惯记录完成比例下降" })).toBeTruthy();
    fireEvent.change(input, { target: { value: "60" } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(rules.getByRole("button", { name: "保存规则" }));
    expect((await rules.findByRole("alert")).textContent).toBe("提醒规则保存失败，请重试。");
    expect((input as HTMLInputElement).value).toBe("60");
    fireEvent.click(rules.getByRole("button", { name: "保存规则" }));
    await waitFor(() => expect(rules.getByRole("status").textContent).toBe("已保存"));
    expect((await instance.getSettings()).habitDropPoints).toBe(60);
  });
});
