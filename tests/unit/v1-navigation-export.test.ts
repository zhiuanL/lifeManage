import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { buildContextDocument, exportTypes, scenarioPresets, serializeContext, type ExportRecord } from "../../src/domain/export/ContextExport";
import { ContextExportService } from "../../src/services/export/ContextExportService";
import { LifeNavigationService } from "../../src/services/life/LifeNavigationService";
import { SqliteLifeNavigationRepository } from "../../src/repositories/sqlite/SqliteLifeNavigationRepository";
import { SqlitePrivacyRepository } from "../../src/repositories/sqlite/SqlitePrivacyRepository";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
const clock = { now: () => new Date("2026-10-12T08:00:00Z") };
const filter = { from: "", to: "", domainId: null, goalId: null, types: [...exportTypes], maxPrivacy: "normal" as const };
const rec = (type: ExportRecord["type"], id: string, privacy: ExportRecord["privacy"] = "normal"): ExportRecord => ({
  type, id, title: id + "标题", date: "2026-10-12", domainIds: [], goalId: null, privacy,
  fields: [{ label: "内容", value: id + "内容" }], links: [],
});
describe("V1 navigation context export", () => {
  it("scopes decision navigation references without leaking private titles", () => {
    const nav = rec("navigation", "私密依据", "private"), unrelated = rec("navigation", "无关导航");
    const decision = { ...rec("decision", "决策"), domainIds: ["d"], fields: [{ label: "重要程度", value: "重大" }], links: [{ type: "navigation" as const, id: nav.id, title: nav.title }] };
    for (const maxPrivacy of ["normal", "private"] as const) {
      const doc = buildContextDocument([nav, decision, unrelated], "major-decision", { ...filter, domainId: "d", maxPrivacy }, scenarioPresets["major-decision"].sections, "");
      for (const format of ["markdown", "text", "json"] as const) {
        const out = serializeContext(doc, format);
        expect(out.includes(nav.title)).toBe(maxPrivacy === "private");
        expect(out.includes("人生导航依据")).toBe(maxPrivacy === "private");
        expect(out).not.toContain(unrelated.title);
      }
    }
  });
  for (const mode of ["SQLite", "preview"]) it(mode + " persists privacy independently from navigation edits", async () => {
    const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    try {
      await new MigrationRunner(sql, migrations, clock).run();
      let sequence = 0;
      const lifeNavigationService = new LifeNavigationService(new SqliteLifeNavigationRepository(sql), clock, { next: () => "n-" + ++sequence });
      const empty = { list: async () => [], listPlanChanges: async () => [], listDefinitions: async () => [], listRecords: async () => [], listSatisfactionLinks: async () => [] };
      const dependencies = [new SqlitePrivacyRepository(sql), empty, empty, empty, empty, empty, empty, empty, empty, lifeNavigationService] as unknown as ConstructorParameters<typeof ContextExportService>;
      const app = { lifeNavigationService, contextExportService: new ContextExportService(...dependencies) };
      for (const kind of ["mission", "value", "vision", "principle"] as const) {
        const item = await app.lifeNavigationService.create(kind, { title: kind, description: "导航正文" });
        expect((await app.contextExportService.loadRecords()).find(r => r.id === item.id)).toMatchObject({
          type: "navigation", privacy: "private", domainIds: [], goalId: null,
          fields: expect.arrayContaining([{ label: "内容", value: "导航正文" }]),
        });
        await app.contextExportService.setPrivacy("navigation", item.id, "normal");
        await app.lifeNavigationService.update(item.id, { title: kind, description: "更新正文" });
        await app.lifeNavigationService.setArchived(item.id, true);
        expect((await app.contextExportService.loadRecords()).find(r => r.id === item.id)).toMatchObject({
          privacy: "normal", fields: expect.arrayContaining([{ label: "状态", value: "已归档" }]),
        });
      }
      await expect(app.contextExportService.setPrivacy("navigation", "missing", "normal")).rejects.toThrow("记录已不存在");
    } finally { db?.close(); }
  });
  it("migrates old navigation without changing its content and validates backup privacy", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, 34), clock).run();
      db.exec("INSERT INTO life_navigation VALUES ('n', 'vision', '原有方向', '保留内容', NULL, '2026-10-12', '2026-10-12')");
      await new MigrationRunner(sql, migrations, clock).run();
      expect(db.prepare("SELECT title, description, privacy_level FROM life_navigation").get()).toEqual({
        title: "原有方向", description: "保留内容", privacy_level: "private",
      });
      expect(() => db.exec("UPDATE life_navigation SET privacy_level = 'invalid'")).toThrow();
      const backup = { format: "lifeos-backup", schemaVersion: 36, appVersion: "0.1.0", exportedAt: clock.now().toISOString(),
        data: Object.fromEntries(backupTables.slice(0, 37).map(table => [table, db.prepare("SELECT * FROM " + table).all()])) };
      expect(inspectBackup(backup).counts.life_navigation).toBe(1);
      const old = structuredClone(backup); old.schemaVersion = 34; delete old.data.decision_navigation_links;
      delete (old.data.life_navigation[0] as Record<string, unknown>).privacy_level;
      expect(inspectBackup(old).counts.life_navigation).toBe(1);
      delete (backup.data.life_navigation[0] as Record<string, unknown>).privacy_level;
      expect(() => inspectBackup(backup)).toThrow("隐私级别");
    } finally { db.close(); }
  });
  it("filters navigation and linked direction titles in all formats", () => {
    const hidden = rec("navigation", "秘密方向", "private"), unrelated = rec("navigation", "无关方向");
    const goal = { ...rec("goal", "目标"), domainIds: ["d"], goalId: "目标",
      links: [{ type: "navigation" as const, id: hidden.id, title: hidden.title }] };
    const records = [goal, hidden, unrelated];
    for (const maxPrivacy of ["normal", "private"] as const) {
      const doc = buildContextDocument(records, "goal-analysis", { ...filter, goalId: goal.id, maxPrivacy }, scenarioPresets["goal-analysis"].sections, "");
      for (const format of ["markdown", "text", "json"] as const) {
        const out = serializeContext(doc, format);
        expect(out).not.toContain(unrelated.title);
        expect(out.includes(hidden.title)).toBe(maxPrivacy === "private");
        expect(out).not.toContain('"id"');
      }
    }
    for (const options of [{ domainId: "d" }, { from: "2026-10-13" }, { types: exportTypes.filter(t => t !== "navigation") }]) {
      const doc = buildContextDocument(records, "goal-analysis", { ...filter, ...options }, scenarioPresets["goal-analysis"].sections, "");
      expect(serializeContext(doc, "json")).not.toContain(hidden.title);
    }
    const major = buildContextDocument([hidden], "major-decision", { ...filter, maxPrivacy: "private" }, scenarioPresets["major-decision"].sections, "",
      { navigation: ["状态"] });
    expect(major.sections.find(s => s.type === "navigation")?.records[0].fields).toEqual([]);
    expect(serializeContext(major, "text")).not.toContain(hidden.id + "内容");
    expect(buildContextDocument([rec("navigation", "敏感", "highly_sensitive")], "major-decision", { ...filter, maxPrivacy: "private" }, scenarioPresets["major-decision"].sections, "")
      .sections.find(s => s.type === "navigation")?.records).toEqual([]);
  });
});

