import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import {
  defaultAttentionSettings, findAttentionSignals,
  attentionRulePreference, validateAttentionSettings,
  type AttentionSettings,
} from "../../src/domain/attention/Attention";
import type { Issue } from "../../src/domain/issues/Issue";
import type { MetricDefinition, MetricRecord } from "../../src/domain/life/DomainMetric";
import type { Action } from "../../src/domain/planning/Action";
import type { ActionPlanChange } from "../../src/domain/planning/ActionPlanChange";
import type { Goal } from "../../src/domain/planning/Goal";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { AttentionPage } from "../../src/pages/AttentionPage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteActionRepository } from "../../src/repositories/sqlite/SqliteActionRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteIssueRepository } from "../../src/repositories/sqlite/SqliteIssueRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteDomainMetricRepository } from "../../src/repositories/sqlite/SqliteDomainMetricRepository";
import { SqliteSystemRepository } from "../../src/repositories/sqlite/SqliteSystemRepository";
import { AttentionService } from "../../src/services/attention/AttentionService";
import { DomainMetricService } from "../../src/services/life/DomainMetricService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { IssueService } from "../../src/services/issues/IssueService";
import { ActionService } from "../../src/services/planning/ActionService";
import { GoalService } from "../../src/services/planning/GoalService";

afterEach(cleanup);

const base = "2026-08-26T12:00:00.000Z";
const now = new Date("2026-09-23T12:00:00.000Z");
const settings = defaultAttentionSettings;
const clock = { now: () => now };
let nextId = 0;
const ids = { next: () => `record-${++nextId}` };

function goal(overrides: Partial<Goal> = {}): Goal {
  const domainId = overrides.domainId === undefined ? "work" : overrides.domainId;
  return {
    id: "goal", title: "整理工作节奏", description: "", domainId,
    domainIds: domainId ? [domainId] : [], status: "active",
    targetDate: null, sortOrder: 0, completedAt: null, createdAt: base, updatedAt: base,
    ...overrides,
  };
}

function action(overrides: Partial<Action> = {}): Action {
  return {
    id: "action", title: "安排休息", notes: "", domainId: null, domainIds: [], goalId: "goal",
    scheduledFor: null, status: "open", sortOrder: 0, completedAt: null,
    createdAt: base, updatedAt: base, ...overrides,
  };
}

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue", title: "晚间打断", description: "", firstSeen: "2026-08-01",
    occurrenceCount: 3, causeHypothesis: "", attempts: "", followUp: "",
    status: "open", goalId: null, domainIds: ["work", "health"],
    createdAt: base, updatedAt: base, ...overrides,
  };
}

function planChange(id: number, changedAt: string, overrides: Partial<ActionPlanChange> = {}): ActionPlanChange {
  return {
    id, actionId: "action", beforeDate: "2026-09-20", afterDate: "2026-09-21",
    reason: "personal", note: "", changedAt, completedAtAtChange: null,
    domainId: null, goalId: "goal", ...overrides,
  };
}

const metric: MetricDefinition = {
  id: "sleep", name: "睡眠时长", unit: "小时", domainIds: ["work", "health"],
  archived: false, createdAt: base,
};

function metricRecord(id: string, date: string, value: number,
  overrides: Partial<MetricRecord> = {}): MetricRecord {
  return {
    id, metricId: metric.id, recordedOn: date, value, note: "",
    createdAt: base, updatedAt: base, ...overrides,
  };
}

describe("M5 attention rules", () => {
  it("keeps date and idle rules independently configurable and never broadens an empty domain scope", () => {
    const expired = goal({ targetDate: "2026-09-22" });
    const disabledDate: AttentionSettings = { ...settings, rules: {
      "goal-date": { enabled: false, scope: "all", domainIds: [] },
    } };
    expect(findAttentionSignals([expired], [action()], [], disabledDate, now).map(item => item.kind))
      .toEqual(["idle-actions"]);
    expect(findAttentionSignals([expired], [action()], [], { ...disabledDate, rules: {
      ...disabledDate.rules, "idle-actions": { enabled: true, scope: "domains", domainIds: [] },
    } }, now)).toEqual([]);
    expect(attentionRulePreference(settings, "repeated-reason"))
      .toEqual({ enabled: true, scope: "all", domainIds: [] });
    expect(() => validateAttentionSettings({ ...settings, rules: {
      "goal-date": { enabled: true, scope: "domains", domainIds: ["work", "work"] },
    } })).toThrow("配置无效");
    expect(() => validateAttentionSettings({ ...settings, incompleteReasons: 1 })).toThrow("2–10");
  });

  it("counts repeated reason source actions only after applying the observation and domain scope", () => {
    const candidates = [
      action({ id: "a", domainIds: ["health"], goalId: null, updatedAt: "2026-09-22T09:00:00",
        details: { incompleteReason: "  太累了 " } }),
      action({ id: "b", domainIds: ["health"], goalId: null, updatedAt: "2026-09-22T09:00:00",
        details: { incompleteReason: "太累了" } }),
      action({ id: "c", domainIds: ["work"], goalId: null, updatedAt: "2026-09-22T09:00:00",
        details: { incompleteReason: "太累了" } }),
      action({ id: "old", domainIds: ["health"], goalId: null, updatedAt: "2026-08-01T09:00:00",
        details: { incompleteReason: "太累了" } }),
      action({ id: "future", domainIds: ["health"], goalId: null, updatedAt: "2026-09-24T09:00:00",
        details: { incompleteReason: "太累了" } }),
      action({ id: "done", domainIds: ["health"], goalId: null, status: "completed",
        updatedAt: "2026-09-22T09:00:00", details: { incompleteReason: "太累了" } }),
    ];
    const scoped: AttentionSettings = { ...settings, incompleteReasons: 2, rules: {
      "repeated-reason": { enabled: true, scope: "domains", domainIds: ["health"] },
    } };
    const [signal] = findAttentionSignals([], candidates, [], scoped, now);
    expect(signal.kind).toBe("repeated-reason");
    expect(signal.sources.map(item => item.id)).toEqual(["a", "b"]);
    expect(signal.baseline).toContain("更新日期不是原因发生日期");
    expect(findAttentionSignals([], candidates, [], { ...scoped, incompleteReasons: 3 }, now)).toEqual([]);
    expect(findAttentionSignals([], candidates, [], { ...scoped, rules: {
      "repeated-reason": { enabled: false, scope: "all", domainIds: [] },
    } }, now)).toEqual([]);
  });

  it("shows an idle linked action only at the full threshold, with period and sources", () => {
    expect(findAttentionSignals([goal()], [action()], [], settings,
      new Date(now.getTime() - 1))).toHaveLength(0);
    const signals = findAttentionSignals([goal()], [action()], [], settings, now);
    expect(signals).toMatchObject([{
      id: "idle-actions:goal", domainIds: ["work"], period: "2026-08-26 至 2026-09-23",
      sources: [
        { id: "goal", path: "/goals", fragment: "goal-goal" },
        { id: "action", path: "/goals", fragment: "action-action" },
      ],
    }]);
    expect(signals[0].rule).toContain("4 周");
    expect(findAttentionSignals([goal()], [], [], settings, now)).toHaveLength(0);
  });

  it("does not mistake goal edits, new actions or completed work for the same event", () => {
    const late = "2026-09-20T12:00:00.000Z";
    expect(findAttentionSignals([goal({ updatedAt: late })], [action()], [], settings, now))
      .toHaveLength(1);
    expect(findAttentionSignals([goal()], [action(), action({
      id: "new", createdAt: late,
    })], [], settings, now)).toHaveLength(0);
    expect(findAttentionSignals([goal()], [action(), action({
      id: "completed", status: "completed", completedAt: late,
    })], [], settings, now)).toHaveLength(0);
    expect(findAttentionSignals([goal({ status: "paused" }), goal({
      id: "done", status: "completed",
    })], [action(), action({ goalId: "done" })], [], settings, now)).toHaveLength(0);
  });

  it("keeps explicit dates factual and emits at most one notice per goal", () => {
    expect(findAttentionSignals([goal({ targetDate: "2026-09-23" })], [action()],
      [], settings, now).map((item) => item.id)).toEqual(["idle-actions:goal"]);
    const expired = findAttentionSignals([goal({ targetDate: "2026-09-22" })],
      [action()], [], settings, now);
    expect(expired).toMatchObject([{
      id: "goal-date:goal", baseline: "目标设定日期：2026-09-22",
      period: "2026-09-22 至 2026-09-23",
    }]);
    expect(findAttentionSignals([goal({ targetDate: "2026-09-22", status: "completed" })],
      [], [], settings, now)).toEqual([]);
  });

  it("counts only unresolved, explicitly repeated issues across all linked domains", () => {
    const signals = findAttentionSignals([], [], [
      issue(), issue({ id: "resolved", status: "resolved" }),
      issue({ id: "below", occurrenceCount: 2 }),
      issue({ id: "future", firstSeen: "2026-09-24" }),
    ], settings, now);
    expect(signals).toMatchObject([{
      id: "recurring-issue:issue", domainIds: ["work", "health"],
      period: "2026-08-01 至 2026-09-23",
      sources: [{ path: "/issues", fragment: "issue-issue", title: "晚间打断" }],
    }]);
    expect(findAttentionSignals([], [], [issue({ occurrenceCount: 2 })],
      { ...settings, issueOccurrences: 2 }, now)).toHaveLength(1);
    expect(() => findAttentionSignals([], [], [], { ...settings, idleWeeks: 0 }, now))
      .toThrow("1–12");
    expect(() => findAttentionSignals([], [], [], { ...settings, issueOccurrences: 1.5 }, now))
      .toThrow("2–10");
  });

  it("counts only observed adjustments inside 28 days and links each event to the current action context", () => {
    const changes = [
      planChange(1, "2026-08-26T09:00:00", { note: "out of window" }),
      planChange(2, "2026-09-03T09:00:00", { reason: "initial" }),
      planChange(3, "2026-09-04T09:00:00"),
      planChange(4, "2026-09-12T09:00:00", { reason: "conflict" }),
      planChange(5, "2026-09-22T09:00:00", { reason: "external" }),
      planChange(6, "2026-09-24T09:00:00"),
      planChange(7, "2026-09-20T09:00:00", { actionId: "removed" }),
    ];
    const result = findAttentionSignals([goal({ createdAt: "2026-09-22T09:00:00" })],
      [action({ status: "completed", completedAt: "2026-09-22T09:00:00" })],
      [], settings, now, changes);
    expect(result).toMatchObject([{
      id: "repeated-plan:action", domainIds: ["work"],
      summary: "过去 28 天记录了 3 次安排日期调整。",
      sources: [{ id: "action:3" }, { id: "action:4" }, { id: "action:5" }],
    }]);
    expect(result[0].sources[1].title).toContain("时间冲突");
    expect(result[0].sources[1].fragment).toBe("action-action");
    expect(findAttentionSignals([], [action()], [], { ...settings, planAdjustments: 4 },
      now, changes)).toHaveLength(0);
    expect(() => findAttentionSignals([], [], [], { ...settings, planAdjustments: 1 },
      now)).toThrow("2–10");
  });

  it("reports a recent, strictly falling metric series with each original data point", () => {
    const records = [
      metricRecord("first/part", "2026-09-10", 8),
      metricRecord("middle", "2026-09-16", 7),
      metricRecord("last", "2026-09-22", 6),
    ];
    const [signal] = findAttentionSignals([], [], [], settings, now, [], [metric], records);
    expect(signal).toMatchObject({
      id: "metric-drop:sleep", kind: "metric-drop", domainIds: ["work", "health"],
      period: "2026-09-10 至 2026-09-22",
      sources: [
        { id: "first/part", fragment: "metric-record-first/part", path: "/domains/work" },
        { id: "middle", fragment: "metric-record-middle" },
        { id: "last", fragment: "metric-record-last" },
      ],
    });
    expect(signal.summary).toContain("8 小时 → 6 小时");
    expect(signal.rule).toContain("不判断数值高低是否有利");
    expect(signal.baseline).toContain("未记录的日期不补值");
    expect(findAttentionSignals([], [], [], { ...settings, metricDrops: 3 },
      now, [], [metric], records)).toEqual([]);
    expect(() => findAttentionSignals([], [], [], { ...settings, metricDrops: 1 }, now))
      .toThrow("2–6");
  });

  it("does not combine metrics, use older or future records, or flag a level/increasing series", () => {
    const valid = [
      metricRecord("a", "2026-09-10", 8),
      metricRecord("b", "2026-09-16", 7),
      metricRecord("c", "2026-09-22", 6),
    ];
    const alerts = (records: readonly MetricRecord[], definition = metric, date = now) =>
      findAttentionSignals([], [], [], settings, date, [], [definition], records);
    expect(alerts(valid.slice(0, 2))).toEqual([]);
    expect(alerts([valid[0], metricRecord("b", "2026-09-16", 8), valid[2]])).toEqual([]);
    expect(alerts([valid[0], metricRecord("b", "2026-09-16", 9), valid[2]])).toEqual([]);
    expect(alerts(valid, { ...metric, archived: true })).toEqual([]);
    expect(alerts(valid, { ...metric, domainIds: [] })).toEqual([]);
    expect(alerts(valid, metric, new Date("2026-10-01T12:00:00"))).toEqual([]);
    expect(alerts([metricRecord("old", "2026-08-26", 9), ...valid.slice(1)])).toEqual([]);
    expect(alerts([...valid.slice(0, 2), metricRecord("future", "2026-09-24", 6)])).toEqual([]);
    expect(alerts([valid[0], { ...valid[1], metricId: "other" }, valid[2]])).toEqual([]);
    expect(alerts([metricRecord("earlier", "2026-09-08", 9), ...valid])).toHaveLength(1);
    expect(alerts([metricRecord("old", "2026-08-26", 9), ...valid])[0].sources).toHaveLength(3);
  });

  it("saves thresholds locally and reuses them across service instances", async () => {
    const executor = new MemorySqliteExecutor();
    await new MigrationRunner(executor, migrations, clock).run();
    const domains = new SqliteLifeDomainRepository(executor);
    const goals = new SqliteGoalRepository(executor);
    const goalService = new GoalService(goals, domains, clock, ids);
    const actionService = new ActionService(new SqliteActionRepository(executor), goals, domains, clock, ids);
    const issueService = new IssueService(new SqliteIssueRepository(executor), domains, goals, clock, ids);
    const system = new SqliteSystemRepository(executor, clock);
    const metricService = new DomainMetricService(
      new SqliteDomainMetricRepository(executor), domains, clock, ids,
    );
    const attention = () => new AttentionService(
      goalService, actionService, issueService, system, clock, metricService,
      { list: async () => [], listLogs: async () => [] },
      { list: async () => [] }, { list: async () => [] }, { list: async () => [] },
      { listEvents: async () => [] },
    );
    expect(await attention().getSettings()).toEqual(settings);
    await issueService.create({
      title: "重复打断", description: "", firstSeen: "2026-09-20",
      occurrenceCount: 2, causeHypothesis: "", attempts: "", followUp: "",
      status: "open", goalId: null, domainIds: [],
    });
    expect((await attention().getSnapshot()).signals).toHaveLength(0);
    await attention().setSettings({
      idleWeeks: 6, issueOccurrences: 2, planAdjustments: 4, metricDrops: 3,
    });
    expect((await attention().getSnapshot()).signals[0]?.id).toMatch(/^recurring-issue:/);
    expect(await attention().getSettings()).toEqual({
      idleWeeks: 6, issueOccurrences: 2, planAdjustments: 4, metricDrops: 3,
    });
    await expect(attention().setSettings({ ...settings, idleWeeks: 13 }))
      .rejects.toThrow("1–12");
    expect(await attention().getSettings()).toEqual({
      idleWeeks: 6, issueOccurrences: 2, planAdjustments: 4, metricDrops: 3,
    });
    await system.setMetadata("m5_attention_settings", '{"idleWeeks":"4","issueOccurrences":3}');
    expect(await attention().getSettings()).toEqual(defaultAttentionSettings);
    await system.setMetadata("m5_attention_settings", '{"idleWeeks":6,"issueOccurrences":2}');
    expect(await attention().getSettings()).toEqual({
      idleWeeks: 6, issueOccurrences: 2, planAdjustments: 3, metricDrops: 2,
    });
    const domainService = new LifeDomainService(domains, clock, ids);
    const health = await domainService.create({
      name: "健康", description: "", focus: "", color: "fern", icon: "heart",
    });
    const definition = await metricService.createDefinition("睡眠时长", "小时", [health.id]);
    await metricService.saveRecord(definition.id, "2026-09-10", 8, "");
    await metricService.saveRecord(definition.id, "2026-09-16", 7, "");
    await metricService.saveRecord(definition.id, "2026-09-22", 6, "");
    expect((await attention().getSnapshot()).signals.find((item) =>
      item.id === `metric-drop:${definition.id}`)?.sources).toHaveLength(3);
    await attention().setSettings({ ...settings, metricDrops: 3 });
    expect((await attention().getSnapshot()).signals.some((item) =>
      item.id === `metric-drop:${definition.id}`)).toBe(false);
    const scoped: AttentionSettings = { ...settings, incompleteReasons: 2, rules: {
      "metric-drop": { enabled: false, scope: "domains", domainIds: [health.id] },
      "repeated-reason": { enabled: true, scope: "domains", domainIds: [] },
    } };
    await attention().setSettings(scoped);
    expect(await attention().getSettings()).toEqual(scoped);
    await expect(attention().setSettings({ ...scoped, incompleteReasons: 11 })).rejects.toThrow("2–10");
    expect(await attention().getSettings()).toEqual(scoped);
    await system.setMetadata("m5_attention_settings", JSON.stringify({ ...settings, incompleteReasons: "2" }));
    await expect(attention().getSettings()).rejects.toThrow("配置损坏");
    await system.setMetadata("m5_attention_settings", JSON.stringify({ ...settings, rules: {
      "metric-drop": { enabled: "false", scope: "all", domainIds: [] },
    } }));
    await expect(attention().getSettings()).rejects.toThrow("配置损坏");
  });
});

describe("M5 attention workspace", () => {
  it("returns no invented attention facts when the clock is invalid", () => {
    expect(findAttentionSignals([goal()], [action()], [issue()], settings, new Date(NaN))).toEqual([]);
  });

  it("filters by domain and updates the rule threshold from the page", async () => {
    const snapshot = {
      settings: { ...defaultAttentionSettings },
      signals: findAttentionSignals([goal()], [action()], [issue()], settings, now),
    };
    const attentionService = {
      getSnapshot: vi.fn().mockImplementation(async () => snapshot),
      setSettings: vi.fn().mockImplementation(async (next: AttentionSettings) => {
        snapshot.settings = next;
      }),
    };
    const domainService = {
      list: vi.fn().mockResolvedValue([
        { id: "work", name: "事业", color: "ocean" },
        { id: "health", name: "健康", color: "fern" },
      ]),
    };
    const value = {
      attentionService, lifeDomainService: domainService as Partial<LifeDomainService>,
    } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, { initialEntries: ["/attention?domain=health"] },
      createElement(LifeOSContext.Provider, { value }, createElement(AttentionPage))));
    expect(await screen.findByRole("heading", { name: "晚间打断" })).toBeTruthy();
    expect(screen.queryByText("整理工作节奏")).toBeNull();
    fireEvent.click(screen.getByText("查看依据"));
    expect(screen.getByText(/首次记录计为 1 次/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "晚间打断" }).getAttribute("href"))
      .toBe("/issues?domain=health#issue-issue");
    fireEvent.change(screen.getByLabelText("问题出现次数"), { target: { value: "4" } });
    await waitFor(() => expect(attentionService.setSettings)
      .toHaveBeenCalledWith({ idleWeeks: 4, issueOccurrences: 4, planAdjustments: 3, metricDrops: 2 }));
    await waitFor(() => expect((screen.getByLabelText("问题出现次数") as HTMLSelectElement).value)
      .toBe("4"));
    await waitFor(() => expect(screen.getByLabelText("28 天内改期次数")).toHaveProperty("disabled", false));
    fireEvent.change(screen.getByLabelText("28 天内改期次数"), { target: { value: "5" } });
    await waitFor(() => expect(attentionService.setSettings)
      .toHaveBeenCalledWith({ idleWeeks: 4, issueOccurrences: 4, planAdjustments: 5, metricDrops: 2 }));
    await waitFor(() => expect(screen.getByLabelText("指标连续下降次数")).toHaveProperty("disabled", false));
    fireEvent.change(screen.getByLabelText("指标连续下降次数"), { target: { value: "4" } });
    await waitFor(() => expect(attentionService.setSettings)
      .toHaveBeenCalledWith({ idleWeeks: 4, issueOccurrences: 4, planAdjustments: 5, metricDrops: 4 }));
    await waitFor(() => expect(screen.getByLabelText("生活领域")).toHaveProperty("disabled", false));
    fireEvent.change(screen.getByLabelText("生活领域"), { target: { value: "work" } });
    expect(await screen.findByRole("heading", { name: "整理工作节奏" })).toBeTruthy();
  });

  it("shows metric evidence in Chinese and navigates shared records within the selected domain", async () => {
    const snapshot = {
      settings: { ...settings },
      signals: findAttentionSignals([], [], [], settings, now, [], [metric], [
        metricRecord("first/part", "2026-09-10", 8),
        metricRecord("middle", "2026-09-16", 7),
        metricRecord("last", "2026-09-22", 6),
      ]),
    };
    const value = {
      attentionService: { getSnapshot: vi.fn().mockResolvedValue(snapshot) },
      lifeDomainService: { list: vi.fn().mockResolvedValue([
        { id: "work", name: "事业" }, { id: "health", name: "健康" },
      ]) },
    } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, { initialEntries: ["/attention?domain=health"] },
      createElement(LifeOSContext.Provider, { value }, createElement(AttentionPage))));
    expect(await screen.findByRole("heading", { name: "睡眠时长" })).toBeTruthy();
    expect(screen.getByText("指标数值变化")).toBeTruthy();
    fireEvent.click(screen.getByText("查看依据"));
    expect(screen.getByText(/未记录的日期不补值/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "2026-09-10 · 8 小时" }).getAttribute("href"))
      .toBe("/domains/health#metric-record-first%2Fpart");
  });
});
