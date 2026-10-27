import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import {
  buildContextDocument, exportTypes, fieldPresets, scenarioPresets, serializeContext,
  type ExportFilter, type ExportRecord, type ExportScenario,
} from "../../src/domain/export/ContextExport";
import { calculateExportGoalProgress } from "../../src/domain/export/GoalExportProgress";
import { localDate, type Habit, type HabitLog } from "../../src/domain/habits/Habit";
import type { Action } from "../../src/domain/planning/Action";
import type { Goal } from "../../src/domain/planning/Goal";
import type { GoalProgressItem } from "../../src/domain/progress/GoalProgressItem";
import { builtInTemplates, validateTemplate } from "../../src/domain/templates/Template";
import { ContextExportPage } from "../../src/pages/ContextExportPage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteActionRepository } from "../../src/repositories/sqlite/SqliteActionRepository";
import { SqliteGoalProgressItemRepository } from "../../src/repositories/sqlite/SqliteGoalProgressItemRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqlitePrivacyRepository } from "../../src/repositories/sqlite/SqlitePrivacyRepository";
import { ContextExportService } from "../../src/services/export/ContextExportService";
import { ActionService } from "../../src/services/planning/ActionService";
import { GoalProgressItemService } from "../../src/services/planning/GoalProgressItemService";
import { GoalService } from "../../src/services/planning/GoalService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(cleanup);
const clock = { now: () => new Date("2026-10-21T08:00:00Z") };
const timestamp = clock.now().toISOString();
const filter: ExportFilter = {
  from: "", to: "", domainId: null, goalId: null, types: exportTypes, maxPrivacy: "private",
};
const empty = { list: async () => [], listPlanChanges: async () => [],
  listDefinitions: async () => [], listRecords: async () => [], listSatisfactionLinks: async () => [] };
const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({
  id, title: id + "目标专项", description: "", domainId: null, domainIds: ["d"], parentId: null,
  status: "active", statusReason: null, targetDate: null, completedAt: null, sortOrder: 0,
  createdAt: timestamp, updatedAt: timestamp, ...extra,
});
const action = (id: string, goalId: string, extra: Partial<Action> = {}): Action => ({
  id, goalId, title: id + "行动专项", notes: "", domainId: null, domainIds: [],
  status: "open", completedAt: null, scheduledFor: null, sortOrder: 0,
  createdAt: timestamp, updatedAt: timestamp, ...extra,
});
const item = (id: string, goalId: string, extra: Partial<GoalProgressItem> = {}): GoalProgressItem => ({
  id, goalId, title: id + "进度项专项", kind: "key_result", targetValue: 10, currentValue: 5,
  weight: 1, sortOrder: 0, createdAt: timestamp, updatedAt: timestamp, ...extra,
});
function serviceFor(goals: readonly Goal[], actions: readonly Action[] = [],
  items: readonly GoalProgressItem[] = [], levels: ReadonlyMap<string, string> = new Map(),
  habits?: { list: () => Promise<readonly Habit[]>; listLogs: () => Promise<readonly HabitLog[]> }) {
  const args = [
    { list: async () => levels }, empty, { list: async () => goals },
    { list: async () => actions, listPlanChanges: async () => [] },
    empty, empty, empty, empty, empty, empty, undefined, undefined, undefined, habits,
    { list: async () => items }, clock,
  ] as unknown as ConstructorParameters<typeof ContextExportService>;
  return new ContextExportService(...args);
}
const build = (records: readonly ExportRecord[], scenario: ExportScenario = "goal-analysis",
  options: Partial<ExportFilter> = {}, fields: Parameters<typeof buildContextDocument>[5] = {}) =>
  buildContextDocument(records, scenario, { ...filter, ...options }, scenarioPresets[scenario].sections, "", fields);
const progressOf = (document: ReturnType<typeof build>, id: string) => document.sections
  .find(section => section.type === "goal")?.records.find(record => record.id === id)?.fields
  .find(field => field.label === "当前进度")?.value;

it("reuses weighted progress precedence for items, actions, exploration and completed goals", () => {
  const goals = [goal("root"), goal("child", { parentId: "root", progressWeight: 3 }),
    goal("explore", { progressMode: "exploration" }), goal("done", { status: "completed" }),
    goal("empty"), goal("archived", { status: "archived", completedAt: timestamp })];
  const actions = [action("open", "root"), action("ignored", "child")];
  const items = [item("kr", "child")];
  const snapshots = calculateExportGoalProgress(goals, actions, items, "2026-10-21");
  expect(snapshots.get("root")?.percent).toBe(38);
  expect(snapshots.get("root")?.dependencies).toEqual([
    { type: "goal", id: "child" }, { type: "progress-item", id: "kr" }, { type: "action", id: "open" },
  ]);
  expect(snapshots.get("explore")?.percent).toBeNull();
  expect(snapshots.get("empty")?.percent).toBeNull();
  for (const id of ["done", "archived"]) expect(snapshots.get(id)).toMatchObject({ percent: 100, dependencies: [] });
  expect(calculateExportGoalProgress([goal("unknown-root"), goal("unknown", { parentId: "unknown-root" })],
    [], [], "2026-10-21").get("unknown-root")?.percent).toBeNull();
  expect(calculateExportGoalProgress([goal("a", { parentId: "b" }), goal("b", { parentId: "a" })],
    [], [], "2026-10-21").get("a")?.percent).toBeNull();
});

it("withholds aggregate progress whenever scope removes a required child or action", async () => {
  const goals = [goal("root"), goal("child", { parentId: "root", status: "completed" })];
  const actions = [action("private-action-id", "root")];
  const records = await serviceFor(goals, actions).loadRecords();
  expect(progressOf(build(records), "root")).toBe("50%");
  for (const options of [
    { types: exportTypes.filter(type => type !== "action") }, { goalId: "root" },
    { domainId: "another" },
  ]) {
    const document = build(records, "goal-analysis", options);
    expect(progressOf(document, "root")).not.toBe("50%");
  }
  for (const [changed, hiddenTitle] of [
    [records.map(record => record.id === "child" ? { ...record, privacy: "highly_sensitive" as const } : record),
      "child目标专项"],
    [records.map(record => record.type === "action" ? { ...record, privacy: "highly_sensitive" as const } : record),
      "private-action-id行动专项"],
    [records.map(record => record.type === "action" ? { ...record, date: "2026-10-20" } : record),
      "private-action-id行动专项"],
  ] as const) {
    const document = build(changed, "goal-analysis", { from: "2026-10-21" });
    expect(progressOf(document, "root")).toContain("未纳入完整计算记录");
    expect(JSON.stringify(document)).not.toContain("dependencies");
    for (const format of ["markdown", "text", "json"] as const) {
      const output = serializeContext(document, format);
      expect(output).not.toContain("50%");
      expect(output).not.toContain(hiddenTitle);
      if (hiddenTitle === "child目标专项") {
        expect(output).toContain("private-action-id行动专项");
      }
    }
  }
});

it("exports original progress items with inherited goal privacy and independently filtered parent titles", async () => {
  const levels = new Map<string, string>([["goal:g", "normal"]]);
  const service = serviceFor([goal("g", { createdAt: "2026-10-01T08:00:00Z" })],
    [], [item("kr", "g", { currentValue: 12 }), { ...item("orphan", "missing") }], levels);
  let records = await service.loadRecords();
  expect(records.find(r => r.type === "progress-item")).toMatchObject({
    privacy: "normal", domainIds: ["d"], goalId: "g", date: localDate(clock.now()),
    fields: expect.arrayContaining([{ label: "目标值", value: "10" },
      { label: "当前值", value: "12" }, { label: "权重", value: "1" }]),
  });
  expect(records.filter(r => r.type === "progress-item")).toHaveLength(1);
  expect(progressOf(build(records), "g")).toBe("100%");
  expect(progressOf(build(records, "goal-analysis", { types: ["goal"] }), "g"))
    .toContain("未纳入完整计算记录");
  for (const format of ["markdown", "text", "json"] as const) {
    const output = serializeContext(build(records, "goal-analysis", { from: "2026-10-21" }), format);
    expect(output).toContain("kr进度项专项");
    expect(output).not.toContain("g目标专项");
  }
  levels.set("goal:g", "highly_sensitive");
  records = await service.loadRecords();
  expect(records.find(r => r.type === "progress-item")?.privacy).toBe("highly_sensitive");
  expect(serializeContext(build(records, "goal-analysis", { types: ["progress-item"] }), "json"))
    .not.toContain("kr进度项专项");
});

it("includes only participating full-week habit rows as progress dependencies", async () => {
  const habit: Habit = { id: "h", title: "习惯专项", intention: "", weeklyTarget: 3, startOn: "2026-10-01",
    stableContext: "", triggerCondition: "", obstacle: "", adjustment: "", domainIds: ["d"],
    archived: false, createdAt: timestamp, updatedAt: timestamp };
  const log = (id: string, recordedOn: string, completed: boolean): HabitLog => ({
    id, habitId: "h", recordedOn, completed, obstacle: "", adjustment: "",
    createdAt: timestamp, updatedAt: timestamp,
  });
  const logs = [log("partial", "2026-10-01", true), log("real", "2026-10-12", true),
    log("not-done", "2026-10-13", false), log("unfinished", "2026-10-21", true),
    log("future", "2026-10-22", true)];
  const g = goal("habit-goal", { habitProgress: [
    { habitId: "h", startOn: "2026-10-01", endOn: "2026-10-31", weeklyTarget: 2, weight: 1 },
  ] });
  const snapshot = calculateExportGoalProgress([g], [], [], "2026-10-21", { habits: [habit], logs }).get(g.id)!;
  expect(snapshot.percent).toBe(50);
  expect(snapshot.dependencies).toEqual([
    { type: "habit", id: "h" }, { type: "habit-log", id: "real" }, { type: "habit-log", id: "not-done" },
  ]);
  const records = await serviceFor([g], [], [], new Map(), {
    list: async () => [habit], listLogs: async () => logs,
  }).loadRecords();
  expect(progressOf(build(records), g.id)).toBe("50%");
  expect(serializeContext(build(records), "text"))
    .toContain("习惯专项：2026-10-01 至 2026-10-31；每周期望 2 次；权重 1");
  expect(progressOf(build(records, "goal-analysis", { types: exportTypes.filter(t => t !== "habit-log") }), g.id))
    .toContain("未纳入完整计算记录");
  const hidden = await serviceFor([g], [], [], new Map([["habit:h", "highly_sensitive"]]), {
    list: async () => [habit], listLogs: async () => logs,
  }).loadRecords();
  expect(progressOf(build(hidden), g.id)).toContain("未纳入完整计算记录");
  expect(serializeContext(build(hidden), "text")).not.toContain("每周期望 2 次");
});

it("exports Chinese lifecycle, horizon, priority, hierarchy and directed relations only when visible", async () => {
  const goals = [goal("parent"), goal("child", { parentId: "parent", status: "paused",
    statusReason: "原文原因", horizon: "quarter", priority: "high", progressWeight: 2,
    relations: [{ type: "depend", targetGoalId: "related" }] }), goal("related")];
  const records = await serviceFor(goals).loadRecords();
  const output = serializeContext(build(records, "life-domain", {}, { goal: fieldPresets.goal }), "text");
  for (const text of ["状态原因：原文原因", "目标周期：季度目标", "优先级：高",
    "贡献权重：2", "上层目标：parent目标专项", "下级目标：child目标专项",
    "依赖目标：related目标专项", "被依赖目标：child目标专项", "进度计算日期：2026-10-21"]) {
    expect(output).toContain(text);
  }
  const hidden = records.map(r => r.id === "parent" || r.id === "related"
    ? { ...r, privacy: "highly_sensitive" as const } : r);
  const filtered = serializeContext(build(hidden), "json");
  expect(filtered).not.toContain("parent目标专项");
  expect(filtered).not.toContain("related目标专项");
  expect(filtered).not.toContain("上层目标");
  expect(filtered).not.toContain("依赖目标");
});

it("keeps explicit old goal fields and sections unchanged in all five progress scenarios", async () => {
  const records = await serviceFor([goal("g")], [], [item("kr", "g")]).loadRecords();
  for (const scenario of ["goal-analysis", "period-review", "life-domain", "issue-diagnosis", "major-decision"] as const) {
    const template = builtInTemplates.find(t => t.id === `default-export-${scenario}`)!;
    expect(() => validateTemplate("export", template.name, template.defaults)).not.toThrow();
    const sections = scenarioPresets[scenario].sections.filter(t => t !== "progress-item");
    const fields = { goal: ["说明", "状态", "目标日期"] };
    const old = validateTemplate("export", template.name, { ...template.defaults, sections, fields });
    expect(old.defaults.sections).toEqual(sections);
    expect(old.defaults.fields).toEqual(fields);
    const output = serializeContext(buildContextDocument(records, scenario, filter, sections, "", fields), "text");
    expect(output).not.toContain("当前进度");
    expect(output).not.toContain("kr进度项专项");
    expect(progressOf(build(records, scenario), "g")).toBe("50%");
  }
  const args = [empty, empty, empty, empty, empty, empty, empty, empty, empty, empty,
    undefined, undefined, undefined, undefined,
    { list: async () => { throw new Error("C:\\private\\lifeos.db"); } },
  ] as unknown as ConstructorParameters<typeof ContextExportService>;
  await expect(new ContextExportService(...args).loadRecords())
    .rejects.toThrow("无法读取目标进度项，请重新读取后再试。");
});

describe("goal progress export persisted facts", () => {
  for (const mode of ["SQLite", "preview"]) it(mode + " rereads edits without rewriting source or privacy", async () => {
    const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    try {
      if (db) db.exec("PRAGMA foreign_keys=ON");
      await new MigrationRunner(sql, migrations, clock).run();
      let sequence = 0;
      const ids = { next: () => `persist-${++sequence}` };
      const domainsRepo = new SqliteLifeDomainRepository(sql);
      const goalsRepo = new SqliteGoalRepository(sql);
      const goals = new GoalService(goalsRepo, domainsRepo, clock, ids);
      const actions = new ActionService(new SqliteActionRepository(sql), goalsRepo, domainsRepo, clock, ids);
      const items = new GoalProgressItemService(new SqliteGoalProgressItemRepository(sql), goalsRepo, clock, ids);
      const created = await goals.create({ title: "持久化进度专项", description: "", domainId: null,
        status: "active", targetDate: null }, [item("unused", "unused")]);
      const args = [new SqlitePrivacyRepository(sql), empty, goals, actions, empty, empty, empty, empty,
        empty, empty, undefined, undefined, undefined, undefined, items, clock,
      ] as unknown as ConstructorParameters<typeof ContextExportService>;
      const service = new ContextExportService(...args);
      await service.setPrivacy("goal", created.id, "normal");
      expect(progressOf(build(await service.loadRecords()), created.id)).toBe("50%");
      const saved = (await items.list())[0];
      await items.replace(created.id, [{ ...saved, currentValue: 8 }]);
      const records = await new ContextExportService(...args).loadRecords();
      expect(progressOf(build(records), created.id)).toBe("80%");
      expect(records.find(r => r.type === "progress-item")).toMatchObject({
        id: saved.id, privacy: "normal", fields: expect.arrayContaining([{ label: "当前值", value: "8" }]),
      });
      expect((await items.list())[0].currentValue).toBe(8);
      await service.setPrivacy("goal", created.id, "highly_sensitive");
      expect(serializeContext(build(await service.loadRecords()), "text")).not.toContain(created.title);
      await expect(service.setPrivacy("progress-item" as "goal", saved.id, "normal")).rejects.toThrow("无效");
    } finally { db?.close(); }
  });
});

it("provides inherited progress item privacy and Chinese progress controls on the actual page", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  const created = await app.goalService.create({ title: "页面进度专项", description: "", domainId: null,
    status: "active", targetDate: null }, [{ kind: "outcome", title: "页面进度项专项",
    targetValue: 10, currentValue: 7, weight: 1 }]);
  render(<MemoryRouter><LifeOSContext.Provider value={app as unknown as LifeOSContextValue}>
    <ContextExportPage />
  </LifeOSContext.Provider></MemoryRouter>);
  await screen.findByLabelText(`目标 ${created.title} 的隐私等级`);
  const preview = () => document.querySelector(".export-preview")?.textContent ?? "";
  expect(preview()).not.toContain(created.title);
  expect(screen.queryByLabelText("目标进度项 页面进度项专项 的隐私等级")).toBeNull();
  fireEvent.change(screen.getByLabelText("允许纳入的最高隐私等级"), { target: { value: "private" } });
  await waitFor(() => expect(preview()).toContain("当前进度：70%"));
  expect(preview()).toContain("页面进度项专项");
  fireEvent.click(screen.getByLabelText("我已查看预览，确认包含私密记录"));
  expect((screen.getByRole("button", { name: "下载" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByLabelText("目标进度项"));
  expect(preview()).not.toContain("70%");
  expect(preview()).toContain("未纳入完整计算记录");
  expect((screen.getByRole("button", { name: "下载" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("移除目标的当前进度"));
  expect(preview()).not.toContain("当前进度：");
});
