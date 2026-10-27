import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import {
  buildContextDocument, exportTypes, scenarioPresets, serializeContext,
  type ExportFilter, type ExportRecord,
} from "../../src/domain/export/ContextExport";
import { localDate, type Habit, type HabitLog } from "../../src/domain/habits/Habit";
import { builtInTemplates, validateTemplate } from "../../src/domain/templates/Template";
import { ContextExportPage } from "../../src/pages/ContextExportPage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteHabitRepository } from "../../src/repositories/sqlite/SqliteHabitRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqlitePrivacyRepository } from "../../src/repositories/sqlite/SqlitePrivacyRepository";
import { ContextExportService } from "../../src/services/export/ContextExportService";
import { HabitService } from "../../src/services/habits/HabitService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(cleanup);
const clock = { now: () => new Date("2026-10-20T08:00:00Z") };
const filter: ExportFilter = {
  from: "", to: "", domainId: null, goalId: null, types: exportTypes, maxPrivacy: "private",
};
const habit: Habit = {
  id: "habit-1", title: "午间散步专项", intention: "保留轻量活动", weeklyTarget: 3,
  stableContext: "午饭后", triggerCondition: "收好餐具", obstacle: "下雨",
  adjustment: "改到室内", startOn: "2026-10-01", domainIds: ["health"], archived: false,
  createdAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-20T08:00:00Z",
};
const log = (id: string, recordedOn: string, completed: boolean): HabitLog => ({
  id, habitId: habit.id, recordedOn, completed, obstacle: "明确记录的阻碍",
  adjustment: "缩短路线", createdAt: "2026-10-20T08:00:00Z", updatedAt: "2026-10-20T08:00:00Z",
});
const empty = {
  list: async () => [], listPlanChanges: async () => [],
  listDefinitions: async () => [], listRecords: async () => [], listSatisfactionLinks: async () => [],
};
function serviceFor(
  habits: Pick<HabitService, "list" | "listLogs">,
  levels: ReadonlyMap<string, string> = new Map(),
) {
  const goal = (id: string, linked: boolean) => ({
    id, title: `${id}私密目标名`, domainIds: ["work"], status: "active",
    description: "", targetDate: null, createdAt: "2026-10-01T08:00:00Z",
    habitProgress: linked ? [{ habitId: habit.id }] : null,
  });
  const args = [
    { list: async () => levels },
    { list: async () => [{ id: "health", name: "健康专项", createdAt: "2026-10-01", status: "active" }] },
    { list: async () => [goal("g1", true), goal("g2", true), goal("unrelated", false)] },
    empty, empty, empty, empty, empty, empty, empty, undefined, undefined, undefined, habits,
  ] as unknown as ConstructorParameters<typeof ContextExportService>;
  return new ContextExportService(...args);
}
const build = (records: readonly ExportRecord[], options: Partial<ExportFilter> = {},
  fields: Parameters<typeof buildContextDocument>[5] = {}) => buildContextDocument(
  records, "goal-analysis", { ...filter, ...options }, scenarioPresets["goal-analysis"].sections, "", fields,
);

it("exports only real log rows and current definitions, with own domains and explicit multi-goal links", async () => {
  const records = await serviceFor({
    list: async () => [habit], listLogs: async () => [
      log("done", "2026-10-12", true), log("not-done", "2026-10-14", false),
      { ...log("orphan", "2026-10-15", true), habitId: "missing" },
    ],
  }).loadRecords();
  const definition = records.find(r => r.type === "habit")!;
  expect(definition).toMatchObject({
    date: localDate(new Date(habit.updatedAt)), privacy: "private", domainIds: ["health"], goalId: null,
    fields: expect.arrayContaining([
      { label: "当前每周期望次数", value: "3" }, { label: "定义更新时间", value: habit.updatedAt },
      { label: "稳定情境", value: "午饭后" }, { label: "触发条件", value: "收好餐具" },
    ]),
  });
  expect(definition.links.filter(l => l.type === "goal").map(l => l.id)).toEqual(["g1", "g2"]);
  const logs = records.filter(r => r.type === "habit-log");
  expect(logs).toHaveLength(2);
  expect(logs.map(r => r.date)).toEqual(["2026-10-12", "2026-10-14"]);
  expect(logs[1].fields).toContainEqual({ label: "打卡状态", value: "明确未完成" });
  expect(logs[0].fields).toContainEqual({ label: "打卡状态", value: "已完成" });
  expect(JSON.stringify(logs)).not.toMatch(/完成率|连续失败|历史频率/);
  for (const goalId of ["g1", "g2"]) {
    const document = build(records, { goalId });
    expect(document.sections.find(s => s.type === "habit")?.records).toHaveLength(1);
    expect(document.sections.find(s => s.type === "habit-log")?.records).toHaveLength(2);
  }
  for (const options of [{ goalId: "unrelated" }, { domainId: "work" }, { domainId: "missing" }]) {
    expect(serializeContext(build(records, options), "json")).not.toContain(habit.title);
  }
});

it("inherits privacy even when only logs are selected, and withholds filtered linked titles and IDs", async () => {
  const levels = new Map<string, string>([
    ["habit:habit-1", "normal"], ["goal:g1", "highly_sensitive"], ["goal:g2", "private"],
  ]);
  const service = serviceFor({
    list: async () => [habit], listLogs: async () => [log("private-log-id", "2026-10-12", false)],
  }, levels);
  const records = await service.loadRecords();
  for (const format of ["markdown", "text", "json"] as const) {
    const output = serializeContext(build(records, {
      from: "2026-10-12", to: "2026-10-12", types: ["habit-log"], maxPrivacy: "normal",
    }), format);
    expect(output).toContain(habit.title);
    expect(output).toContain("明确未完成");
    expect(output).not.toContain("关联习惯");
    expect(output).not.toContain("私密目标名");
    expect(output).not.toContain("private-log-id");
    expect(output).not.toContain("habit-1");
    expect(serializeContext(build(records, {}, { "habit-log": ["打卡状态"], habit: [] }), format))
      .not.toContain("明确记录的阻碍");
  }
  levels.set("habit:habit-1", "highly_sensitive");
  const hidden = await service.loadRecords();
  expect(hidden.filter(r => r.type === "habit" || r.type === "habit-log")
    .every(r => r.privacy === "highly_sensitive")).toBe(true);
  for (const format of ["markdown", "text", "json"] as const) {
    expect(serializeContext(build(hidden, { types: ["habit-log"] }), format)).not.toContain(habit.title);
  }
});

it("keeps existing explicit template sections unchanged and supports all four relevant scenarios", async () => {
  const records = await serviceFor({
    list: async () => [habit], listLogs: async () => [log("done", "2026-10-12", true)],
  }).loadRecords();
  for (const scenario of ["goal-analysis", "period-review", "life-domain", "issue-diagnosis"] as const) {
    const template = builtInTemplates.find(t => t.id === `default-export-${scenario}`)!;
    expect(() => validateTemplate("export", template.name, template.defaults)).not.toThrow();
    const oldSections = scenarioPresets[scenario].sections.filter(t => t !== "habit" && t !== "habit-log");
    const defaults = { ...template.defaults, sections: oldSections, fields: { goal: ["说明"] } };
    expect(validateTemplate("export", template.name, defaults).defaults.sections).toEqual(oldSections);
    const old = buildContextDocument(records, scenario, filter, oldSections, "", defaults.fields);
    expect(serializeContext(old, "text")).not.toContain(habit.title);
    const current = buildContextDocument(records, scenario, filter, scenarioPresets[scenario].sections, "");
    expect(current.sections.find(s => s.type === "habit-log")?.records).toHaveLength(1);
  }
});

it("returns a Chinese recoverable error without exposing database paths or silently omitting habits", async () => {
  for (const failing of ["list", "listLogs"] as const) {
    await expect(serviceFor({
      list: async () => { if (failing === "list") throw new Error("C:\\private\\lifeos.db"); return [habit]; },
      listLogs: async () => { if (failing === "listLogs") throw new Error("SQL SELECT *"); return []; },
    }).loadRecords()).rejects.toThrow("无法读取习惯或打卡记录，请重新读取后再试。");
  }
});

describe("habit export existing persisted privacy", () => {
  for (const mode of ["SQLite", "preview"]) it(mode + " preserves privacy, current edits and archive history on reread", async () => {
    const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    try {
      if (db) db.exec("PRAGMA foreign_keys=ON");
      await new MigrationRunner(sql, migrations, clock).run();
      let sequence = 0;
      const habits = new HabitService(new SqliteHabitRepository(sql), new SqliteLifeDomainRepository(sql),
        clock, { next: () => `habit-persist-${++sequence}` });
      const created = await habits.create({ ...habit, domainIds: [] });
      const recorded = await habits.saveLog(created.id, "2026-10-12", false, "实际阻碍", "实际调整");
      const args = [new SqlitePrivacyRepository(sql), empty, empty, empty, empty, empty, empty, empty,
        empty, empty, undefined, undefined, undefined, habits] as unknown as ConstructorParameters<typeof ContextExportService>;
      const service = new ContextExportService(...args);
      const facts = () => new ContextExportService(...args).loadRecords();
      expect((await facts()).map(r => r.privacy)).toEqual(["private", "private"]);
      await service.setPrivacy("habit", created.id, "highly_sensitive");
      await habits.update(created.id, { ...created, title: "散步更新", weeklyTarget: 2 });
      await habits.saveLog(created.id, "2026-10-12", true, "修改后阻碍", "修改后调整");
      await habits.setArchived(created.id, true);
      const reread = await facts();
      expect(reread).toHaveLength(2);
      expect(reread[0]).toMatchObject({ title: "散步更新", privacy: "highly_sensitive",
        fields: expect.arrayContaining([
          { label: "状态", value: "已归档" }, { label: "当前每周期望次数", value: "2" },
        ]) });
      expect(reread[1]).toMatchObject({
        id: recorded.id, date: "2026-10-12", privacy: "highly_sensitive",
        fields: expect.arrayContaining([{ label: "打卡状态", value: "已完成" },
          { label: "阻碍", value: "修改后阻碍" }]),
      });
      await service.setPrivacy("habit", created.id, "normal");
      expect((await facts()).every(r => r.privacy === "normal")).toBe(true);
      await expect(service.setPrivacy("habit", "missing", "normal")).rejects.toThrow("已不存在");
      await expect(service.setPrivacy("habit-log" as "habit", recorded.id, "normal")).rejects.toThrow("无效");
      if (db) {
        expect(db.prepare("SELECT privacy_level FROM habits WHERE id = ?").get(created.id))
          .toEqual({ privacy_level: "normal" });
        expect(() => db.prepare("UPDATE habits SET privacy_level = 'invalid' WHERE id = ?")
          .run(created.id)).toThrow();
      }
    } finally { db?.close(); }
  });
});

it("exposes Chinese controls, inherited log privacy and preview-bound confirmation in the actual page", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  const created = await app.habitService.create({ ...habit, domainIds: [] });
  await app.habitService.saveLog(created.id, "2026-10-12", false, "导出阻碍专项");
  render(<MemoryRouter><LifeOSContext.Provider value={app as unknown as LifeOSContextValue}>
    <ContextExportPage />
  </LifeOSContext.Provider></MemoryRouter>);
  await screen.findByLabelText(`习惯 ${habit.title} 的隐私等级`);
  const preview = () => document.querySelector(".export-preview")?.textContent ?? "";
  expect(preview()).not.toContain(habit.title);
  expect(screen.getByLabelText("习惯打卡")).toBeTruthy();
  expect(screen.queryByLabelText(`习惯打卡 ${habit.title} 的隐私等级`)).toBeNull();
  fireEvent.change(screen.getByLabelText("允许纳入的最高隐私等级"), { target: { value: "private" } });
  await waitFor(() => expect(preview()).toContain("明确未完成"));
  expect((screen.getByRole("button", { name: "下载" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("我已查看预览，确认包含私密记录"));
  expect((screen.getByRole("button", { name: "下载" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByLabelText("习惯打卡"));
  expect(preview()).not.toContain("导出阻碍专项");
  expect((screen.getByRole("button", { name: "下载" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("习惯打卡"));
  fireEvent.change(screen.getByLabelText(`习惯 ${habit.title} 的隐私等级`),
    { target: { value: "highly_sensitive" } });
  await waitFor(() => expect((screen.getByLabelText(`习惯 ${habit.title} 的隐私等级`) as HTMLSelectElement)
    .value).toBe("highly_sensitive"));
  expect(preview()).not.toContain(habit.title);
  expect((await app.contextExportService.loadRecords()).filter(r => r.type === "habit-log")
    .every(r => r.privacy === "highly_sensitive")).toBe(true);
});
