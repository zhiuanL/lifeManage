import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";
import type { LifeNavigation } from "../../src/domain/life/LifeNavigation";
import type { Action } from "../../src/domain/planning/Action";
import type { Goal } from "../../src/domain/planning/Goal";
import type { Habit, HabitLog } from "../../src/domain/habits/Habit";
import type { GoalProgressItem } from "../../src/domain/progress/GoalProgressItem";
import { inspectDataQuality, type DataQualityFacts, type DataQualityReport } from "../../src/domain/system/DataQuality";
import { inspectLinkedRecordQuality, type LinkedQualityFacts } from "../../src/domain/system/LinkedRecordQuality";
import { DataQualityPage } from "../../src/pages/DataQualityPage";
import { MorePage } from "../../src/pages/MorePage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteActionRepository } from "../../src/repositories/sqlite/SqliteActionRepository";
import { SqliteHabitRepository } from "../../src/repositories/sqlite/SqliteHabitRepository";
import { SqliteGoalProgressItemRepository } from "../../src/repositories/sqlite/SqliteGoalProgressItemRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteLifeNavigationRepository } from "../../src/repositories/sqlite/SqliteLifeNavigationRepository";
import type { SqliteExecutor } from "../../src/repositories/sqlite/SqliteExecutor";
import { DataQualityReadError, DataQualityService, type LinkedQualitySources } from "../../src/services/system/DataQualityService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(cleanup);
const clock = { now: () => new Date("2026-10-21T08:00:00Z") };
const timestamp = clock.now().toISOString();
const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({
  id, title: "目标 " + id, description: "", domainId: null, domainIds: [], parentId: null,
  status: "active", targetDate: null, completedAt: null, sortOrder: 0,
  createdAt: timestamp, updatedAt: timestamp, ...extra,
});
const action = (id: string, extra: Partial<Action> = {}): Action => ({
  id, title: "行动 " + id, notes: "", domainId: null, domainIds: [], goalId: null,
  status: "open", scheduledFor: null, completedAt: null, sortOrder: 0,
  createdAt: timestamp, updatedAt: timestamp, ...extra,
});
const habit = (id: string, extra: Partial<Habit> = {}): Habit => ({
  id, title: "习惯 " + id, intention: "", domainIds: [], weeklyTarget: 2,
  stableContext: "", triggerCondition: "", obstacle: "", adjustment: "", startOn: "2026-01-01",
  archived: false, createdAt: timestamp, updatedAt: timestamp, ...extra,
});
const log = (id: string, extra: Partial<HabitLog> = {}): HabitLog => ({
  id, habitId: "h", recordedOn: "2026-10-20", completed: false, obstacle: "", adjustment: "",
  createdAt: timestamp, updatedAt: timestamp, ...extra,
});
const item = (id: string, extra: Partial<GoalProgressItem> = {}): GoalProgressItem => ({
  id, goalId: "g", title: "进度项", kind: "outcome", targetValue: 10, currentValue: 20,
  weight: 1, sortOrder: 0, createdAt: timestamp, updatedAt: timestamp, ...extra,
});
const core = (extra: Partial<DataQualityFacts> = {}): DataQualityFacts => ({
  domains: [], navigation: [], goals: [], actions: [], habits: [], logs: [], items: [], ...extra,
});
const linked = (extra: Partial<LinkedQualityFacts> = {}): LinkedQualityFacts => ({
  roles: [], metrics: [], metricRecords: [], people: [], skills: [], events: [],
  issues: [], decisions: [], reviews: [], resources: [], ...extra,
});
function sources(facts: LinkedQualityFacts = linked()): LinkedQualitySources {
  return {
    records: { listPeople: async () => facts.people, listSkills: async () => facts.skills,
      listEvents: async () => facts.events },
    roles: { list: async () => facts.roles },
    metrics: { listDefinitions: async () => facts.metrics, listRecords: async () => facts.metricRecords },
    issues: { list: async () => facts.issues }, decisions: { list: async () => facts.decisions },
    reviews: { list: async () => facts.reviews }, resources: { list: async () => facts.resources },
  };
}
function service(facts: DataQualityFacts, assets: LinkedQualitySources = sources()) {
  return new DataQualityService({ list: async () => facts.domains }, { list: async () => facts.navigation },
    { list: async () => facts.goals }, { list: async () => facts.actions }, { list: async () => facts.items },
    { list: async () => facts.habits, listLogs: async () => facts.logs }, clock, assets);
}

it("allows optional associations, unknown progress, over-target results, archives and daily gaps without mutation", () => {
  const facts = core({ goals: [goal("g", { status: "paused" }), goal("explore", { progressMode: "exploration" })],
    actions: [action("independent"), action("linked", { goalId: "g", scheduledFor: "2027-01-01" })],
    habits: [habit("h", { archived: true })], logs: [log("one")], items: [item("i")] });
  const before = JSON.stringify(facts);
  expect(inspectDataQuality(facts, "2026-10-21")).toEqual([]);
  expect(JSON.stringify(facts)).toBe(before);
  expect(inspectDataQuality(core(), "2026-10-21")).toEqual([]);
});

it("reports missing explicit links and cycle members once, without mislabelling their descendants", () => {
  const facts = core({
    goals: [goal("a", { parentId: "b" }), goal("b", { parentId: "a" }),
      goal("descendant", { parentId: "a" }), goal("self", { parentId: "self" }),
      goal("missing", { parentId: "gone", domainIds: ["missing-domain"], directionId: "gone",
        relations: [{ type: "support", targetGoalId: "gone" }] })],
    actions: [action("a 中文", { goalId: "gone" })], items: [item("orphan", { goalId: "gone" })],
    logs: [log("orphan")],
  });
  const findings = inspectDataQuality(facts, "2026-10-21");
  expect(findings.filter(row => row.category === "hierarchy").map(row => row.sourceTitle))
    .toEqual(["目标 a", "目标 b", "目标 self"]);
  expect(new Set(findings.map(row => row.key)).size).toBe(findings.length);
  expect(findings.find(row => row.sourceType === "行动")?.sourcePath)
    .toBe("/goals?actionStatus=all#action-" + encodeURIComponent("a 中文"));
  expect(findings.filter(row => ["目标进度项", "习惯打卡"].includes(row.sourceType))
    .every(row => row.sourcePath === null)).toBe(true);
  expect(findings.map(row => row.message).join(" ")).not.toContain("missing-domain");
  expect(findings.map(row => row.message).join(" ")).not.toContain("gone");
});

it("uses saved value and habit rules, distinguishing invalid dates from allowed future plans", () => {
  const facts = core({
    goals: [goal("g", { targetDate: "2026-02-30", progressWeight: 0 }),
      goal("habit", { progressMode: "exploration",
        habitProgress: [{ habitId: "h", startOn: "2026-10-01", endOn: "2026-09-01", weeklyTarget: 2, weight: 1 }] })],
    habits: [habit("h", { weeklyTarget: 8 })],
    logs: [log("before", { recordedOn: "2025-12-31" }),
      log("future", { recordedOn: "2026-10-22" }), log("bad", { recordedOn: "2026-02-30" }),
      log("first"), log("duplicate")],
    items: [item("bad", { weight: Number.NaN })],
    actions: [action("future", { scheduledFor: "2027-01-01" })],
  });
  const findings = inspectDataQuality(facts, "2026-10-21");
  expect(findings.filter(row => row.sourceType === "行动")).toEqual([]);
  expect(findings.filter(row => row.sourceType === "习惯打卡" && row.category === "date")).toHaveLength(3);
  expect(findings.filter(row => row.message.includes("重复打卡"))).toHaveLength(1);
  expect(findings.some(row => row.message.includes("贡献权重"))).toBe(true);
  expect(findings.some(row => row.message.includes("习惯型进度的周期"))).toBe(true);
  expect(() => inspectDataQuality(facts, "2026-02-30")).toThrow("检查日期无效");
});

it("checks cross-module references without requiring fields, treating zero metrics and archived sources as valid", () => {
  const saved = { id: "p", name: "人物", archived: true, createdAt: timestamp, updatedAt: timestamp,
    domainIds: [], relationshipType: "", state: "", importantDate: null, lastContact: null,
    sharedExperiences: "", notes: "" };
  const assets = linked({
    people: [saved],
    events: [{ id: "e", title: "事件", description: "", domainIds: [], personId: "p", goalId: "g",
      happenedOn: "2027-01-01", archived: false, createdAt: timestamp, updatedAt: timestamp }],
    resources: [{ id: "r", goalId: "g", kind: "person", description: "联系资源", personId: "p",
      skillId: null, met: false, createdAt: timestamp, updatedAt: timestamp }],
    metrics: [{ id: "m", name: "指标", unit: "次", archived: true, domainIds: [], createdAt: timestamp }],
    metricRecords: [{ id: "mr", metricId: "m", recordedOn: "2026-10-20", value: 0, note: "",
      createdAt: timestamp, updatedAt: timestamp }],
  });
  const facts = core({ goals: [goal("g", { status: "archived" })] });
  expect(inspectLinkedRecordQuality(facts, assets)).toEqual([]);
  const changed = linked({ ...assets, events: [{ ...assets.events[0], goalId: "missing", personId: "missing" }],
    resources: [{ ...assets.resources[0], goalId: null, decisionId: null }] });
  const findings = inspectLinkedRecordQuality(facts, changed);
  expect(findings.filter(row => row.sourceType === "重要事件")).toHaveLength(2);
  expect(findings.find(row => row.sourceType === "资源需求")?.sourcePath).toBeNull();
});

it("covers review/decision/role/skill and metric ownership without exporting missing identifiers", () => {
  const assets = linked({
    roles: [{ id: "role", name: "角色", description: "", active: false, privacyLevel: "private",
      domainIds: ["lost"], goalIds: ["lost"], archivedAt: timestamp, deletedAt: null,
      createdAt: timestamp, updatedAt: timestamp, version: 1 }],
    skills: [{ id: "s", name: "能力", currentLevel: 0, targetLevel: 7, domainIds: [], goalId: "lost",
      learningPath: "", practice: "", reflection: "", archived: false, createdAt: timestamp, updatedAt: timestamp }],
    reviews: [{ id: "r", title: "复盘", reviewedOn: "2026-02-30", reflection: "", insight: "",
      nextFocus: "", domainId: null, domainIds: [], goalIds: ["lost"], issueIds: ["lost"],
      createdAt: timestamp, updatedAt: timestamp }],
    decisions: [{ id: "d", title: "决策", decidedOn: "2026-10-20", importance: "ordinary",
      status: "considering", background: "", options: "", constraints: "", criteria: "", risks: "",
      opportunityCost: "", reversibility: "unknown", choice: "", rationale: "", executionConditions: "",
      outcome: "", reflection: "", goalId: null, domainIds: [], navigationIds: ["lost"],
      personIds: ["lost"], resourceNeedIds: ["lost"], createdAt: timestamp, updatedAt: timestamp }],
    metricRecords: [{ id: "mr", metricId: "lost", recordedOn: "2026-10-20", value: 0, note: "",
      createdAt: timestamp, updatedAt: timestamp }],
  });
  const findings = inspectLinkedRecordQuality(core(), assets);
  expect(findings.filter(row => row.sourceType === "身份角色")).toHaveLength(2);
  expect(findings.filter(row => row.sourceType === "能力")).toHaveLength(2);
  expect(findings.filter(row => row.sourceType === "复盘")).toHaveLength(3);
  expect(findings.filter(row => row.sourceType === "决策")).toHaveLength(3);
  expect(findings.find(row => row.sourceType === "指标记录")?.sourcePath).toBeNull();
  expect(findings.map(row => row.message).join(" ")).not.toContain("lost");
});

it("links metric findings to global sources even without any valid domain", () => {
  const metricId = "m/中文%part", recordId = "r/中文%part";
  const findings = inspectLinkedRecordQuality(core(), linked({
    metrics: [{ id: metricId, name: "状态", unit: "分", archived: false,
      domainIds: ["missing"], createdAt: timestamp }],
    metricRecords: [{ id: recordId, metricId, recordedOn: "2026-02-30",
      value: Number.NaN, note: "", createdAt: timestamp, updatedAt: timestamp }],
  }));
  expect(findings.find(row => row.sourceType === "指标")?.sourcePath)
    .toBe(`/metrics#metric-${encodeURIComponent(metricId)}`);
  expect(findings.filter(row => row.sourceType === "指标记录")).toHaveLength(2);
  expect(findings.filter(row => row.sourceType === "指标记录")
    .every(row => row.sourcePath === `/metrics#metric-record-${encodeURIComponent(recordId)}`)).toBe(true);
});

it("returns all read counts and sanitizes every source failure instead of returning a partial healthy report", async () => {
  const report = await service(core({ goals: [goal("g")] })).inspect();
  expect(report.checkedAt).toBe(timestamp);
  expect(report.counts).toHaveLength(17);
  expect(report.counts.find(row => row.label === "目标")?.count).toBe(1);
  const assets = sources();
  assets.records.listEvents = async () => { throw new Error("C:\\private\\db.sqlite"); };
  await expect(service(core(), assets).inspect()).rejects.toThrow("无法读取重要事件，数据质量检查未完成，请重试。");
  await expect(service(core(), assets).inspect()).rejects.not.toThrow("private");
});

function persistedService(db: SqliteExecutor) {
  return new DataQualityService(new SqliteLifeDomainRepository(db), new SqliteLifeNavigationRepository(db),
    new SqliteGoalRepository(db), new SqliteActionRepository(db), new SqliteGoalProgressItemRepository(db),
    new SqliteHabitRepository(db), clock, sources());
}
describe.each(["native", "preview"] as const)("isolated %s quality reads", engine => {
  it("rereads actual stored goal edits, hierarchy and archived habits without writing during inspection", async () => {
    const native = engine === "native" ? new DatabaseSync(":memory:") : null;
    try {
      const db = native ? nativeSqliteExecutor(native) : new MemorySqliteExecutor();
      await new MigrationRunner(db, migrations, clock).run();
      const goals = new SqliteGoalRepository(db);
      const habits = new SqliteHabitRepository(db);
      const domains = new SqliteLifeDomainRepository(db);
      const domain: LifeDomain = { id: "domain", name: "健康", description: "", focus: "", currentState: "",
        longTermExpectation: "", status: "paused", icon: "heart", color: "fern", sortOrder: 0,
        createdAt: timestamp, updatedAt: timestamp };
      await domains.create(domain);
      const saved = goal("g", { domainId: "domain", domainIds: ["domain"] });
      await goals.create(saved);
      await habits.create(habit("h"));
      await habits.setArchived("h", true, timestamp);
      await habits.createLog(log("one"));
      const before = JSON.stringify(await goals.list());
      expect((await persistedService(db).inspect()).findings).toEqual([]);
      expect(JSON.stringify(await goals.list())).toBe(before);
      await goals.create(goal("child", { parentId: "g" }));
      await goals.update({ ...saved, parentId: "child" });
      expect((await persistedService(db).inspect()).findings
        .filter(row => row.category === "hierarchy")).toHaveLength(2);
      await goals.update(saved);
      expect((await persistedService(db).inspect()).findings).toEqual([]);
    } finally { native?.close(); }
  });
});

it("keeps an archived long-term direction valid and rejects a saved direction with the wrong kind", () => {
  const direction: LifeNavigation = { id: "n", title: "方向", description: "", kind: "vision",
    archivedAt: timestamp, createdAt: timestamp, updatedAt: timestamp };
  expect(inspectDataQuality(core({ navigation: [direction], goals: [goal("g", { directionId: "n" })] }),
    "2026-10-21")).toEqual([]);
  expect(inspectDataQuality(core({ navigation: [{ ...direction, kind: "value" }],
    goals: [goal("g", { directionId: "n" })] }), "2026-10-21")).toHaveLength(1);
});

function show(inspect: () => Promise<DataQualityReport>) {
  const value = { dataQualityService: { inspect } } as unknown as LifeOSContextValue;
  return render(<LifeOSContext.Provider value={value}><MemoryRouter><DataQualityPage /></MemoryRouter>
  </LifeOSContext.Provider>);
}
it("shows Chinese evidence, category filtering, source navigation and explicit reread", async () => {
  const report = await service(core({ goals: [goal("a 中文", { parentId: "a 中文" })],
    actions: [action("bad", { goalId: "lost" })] })).inspect();
  const inspect = vi.fn().mockResolvedValueOnce(report).mockResolvedValueOnce({ ...report, findings: [] });
  show(inspect);
  await screen.findByText("本次发现 2 条待检查记录。");
  fireEvent.change(screen.getByRole("combobox", { name: "检查类别" }), { target: { value: "hierarchy" } });
  expect(screen.getByRole("link", { name: "查看原记录" }).getAttribute("href"))
    .toBe("/goals/" + encodeURIComponent("a 中文"));
  expect(screen.queryByText("行动 bad")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
  await screen.findByText("本次检查范围内未发现异常。");
  expect(inspect).toHaveBeenCalledTimes(2);
});
it("does not present a read failure as a healthy result, and retries without revealing storage errors", async () => {
  const inspect = vi.fn().mockRejectedValueOnce(new DataQualityReadError("习惯打卡"))
    .mockResolvedValueOnce(await service(core()).inspect());
  show(inspect);
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("无法读取习惯打卡");
  expect(screen.queryByText("本次检查范围内未发现异常。")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
  await screen.findByText("本次检查范围内未发现异常。");
  cleanup();
  show(async () => { throw new Error("C:\\private\\db.sqlite"); });
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).not.toContain("private");
});
it("drops a pending result after page unmount and exposes the system entry even with modules disabled", async () => {
  let resolve!: (report: DataQualityReport) => void;
  const pending = new Promise<DataQualityReport>(done => { resolve = done; });
  const view = show(() => pending);
  expect(screen.getByRole("button", { name: "重新检查" }).hasAttribute("disabled")).toBe(true);
  view.unmount();
  resolve(await service(core()).inspect());
  await waitFor(() => expect(screen.queryByText("本次检查范围内未发现异常。")).toBeNull());
  const value = { modulePreference: { disabledModules: ["goals", "habits"] } } as unknown as LifeOSContextValue;
  render(<LifeOSContext.Provider value={value}><MemoryRouter><MorePage /></MemoryRouter></LifeOSContext.Provider>);
  expect(screen.getByRole("link", { name: "系统健康与数据质量" }).getAttribute("href")).toBe("/data-quality");
});
