import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteDecisionRepository } from "../../src/repositories/sqlite/SqliteDecisionRepository";
import { SqliteLifeNavigationRepository } from "../../src/repositories/sqlite/SqliteLifeNavigationRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { ContextExportService } from "../../src/services/export/ContextExportService";
import { SqlitePrivacyRepository } from "../../src/repositories/sqlite/SqlitePrivacyRepository";
import { DecisionService } from "../../src/services/decisions/DecisionService";
import { LifeRecordsService } from "../../src/services/records/LifeRecordsService";
import { SqliteLifeRecordsRepository } from "../../src/repositories/sqlite/SqliteLifeRecordsRepository";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
import type { DecisionDraft } from "../../src/domain/decisions/Decision";
const clock = { now: () => new Date("2026-10-12T08:00:00Z") };
const draft: DecisionDraft = { title: "决策", decidedOn: "2026-10-12", importance: "major", status: "considering",
  background: "原正文", options: "", constraints: "独立约束", criteria: "", risks: "", opportunityCost: "",
  reversibility: "unknown", choice: "", rationale: "", executionConditions: "", outcome: "", reflection: "", domainIds: [], goalId: null };
describe("V1 decision person references", () => {
  for (const mode of ["SQLite", "preview"]) it(mode + " preserves references, archives and atomic history", async () => {
    const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    try {
      if (db) db.exec("PRAGMA foreign_keys=ON");
      await new MigrationRunner(sql, migrations, clock).run();
      let seq = 0; const ids = { next: () => "ref-" + ++seq };
      const navigation = new SqliteLifeNavigationRepository(sql);
      const records = new SqliteLifeRecordsRepository(sql);
      const life = new LifeRecordsService(records, new SqliteLifeDomainRepository(sql), new SqliteGoalRepository(sql), clock, ids);
      const repository = new SqliteDecisionRepository(sql);
      const decisions = new DecisionService(repository, new SqliteLifeDomainRepository(sql), new SqliteGoalRepository(sql), clock, ids, navigation, records);
      const refs = [];
      for (const name of ["甲", "乙", "丙"]) refs.push(await life.savePerson({ name, relationshipType: "朋友", state: "", importantDate: null, lastContact: null, sharedExperiences: "", notes: "", domainIds: [] }));
      const empty = { list: async () => [], listPlanChanges: async () => [], listDefinitions: async () => [], listRecords: async () => [], listSatisfactionLinks: async () => [] };
      const exportDeps = [new SqlitePrivacyRepository(sql), empty, empty, empty, empty, empty, empty, decisions, empty, empty, life] as unknown as ConstructorParameters<typeof ContextExportService>;
      const exports = new ContextExportService(...exportDeps);
      expect((await exports.loadRecords()).find(r => r.id === refs[0].id)).toMatchObject({ type: "person", privacy: "private" });
      await exports.setPrivacy("person", refs[0].id, "normal");
      await life.savePerson({ ...refs[0], notes: "更新备注" }, refs[0].id);
      expect((await exports.loadRecords()).find(r => r.id === refs[0].id)).toMatchObject({ privacy: "normal", fields: expect.arrayContaining([{ label: "备注", value: "更新备注" }]) });
      await expect(exports.setPrivacy("person", "missing", "normal")).rejects.toThrow("不存在");
      const links = refs.map(r => r.id).sort();
      const decision = await decisions.create({ ...draft, personIds: [" " + links[0] + " ", ...links] });
      expect((await decisions.list())[0]).toMatchObject({ personIds: links, constraints: "独立约束" });
      await decisions.update(decision.id, { ...draft, title: "改标题" });
      expect((await decisions.findById(decision.id))?.personIds).toEqual(links);
      await life.setArchived("people", links[0], true);
      await decisions.update(decision.id, { ...draft, title: "保留历史依据" });
      await expect(decisions.create({ ...draft, personIds: [links[0]] })).rejects.toThrow("归档");
      const history = new VersionHistoryService(new SqliteObjectVersionRepository(sql));
      const before = await decisions.findById(decision.id), versions = await history.list("decision", decision.id);
      await expect(decisions.update(decision.id, { ...draft, background: "不应保存", personIds: ["missing"] })).rejects.toThrow("不存在");
      await expect(repository.update({ ...before!, background: "不应保存", personIds: ["missing"] })).rejects.toThrow();
      expect(await decisions.findById(decision.id)).toEqual(before);
      expect(await history.list("decision", decision.id)).toEqual(versions);
      await decisions.update(decision.id, { ...draft, personIds: [] });
      expect((await decisions.findById(decision.id))?.personIds).toEqual([]);
      expect((await history.list("decision", decision.id))[0].snapshot).toMatchObject({ person_ids: links });
      await expect(decisions.update(decision.id, { ...draft, personIds: [links[0]] })).rejects.toThrow("归档");
      await expect(decisions.create({ ...draft, personIds: [" "] })).rejects.toThrow("无效");
    } finally { db?.close(); }
  });
  it("migrates V36 without rewriting facts and checks V37/V36 backup links", async () => {
    const db = new DatabaseSync(":memory:"), sql = nativeSqliteExecutor(db);
    try {
      db.exec("PRAGMA foreign_keys=ON");
      await new MigrationRunner(sql, migrations.slice(0, 36), clock).run();
      db.exec("INSERT INTO decisions (id,title,decided_on,importance,status,reversibility,created_at,updated_at) VALUES ('d','旧选择','2026-10-12','major','considering','unknown','2026-10-12','2026-10-12')");
      const before = db.prepare("SELECT * FROM decisions").get();
      await new MigrationRunner(sql, migrations, clock).run();
      await new MigrationRunner(sql, migrations, clock).run();
      expect(db.prepare("SELECT * FROM decisions").get()).toEqual(before);
      expect(db.prepare("SELECT * FROM object_versions").all()).toEqual([]);
      db.exec("INSERT INTO people (id,name,created_at,updated_at) VALUES ('p','人物','2026-10-12','2026-10-12')");
      db.prepare("UPDATE decision_writes SET person_ids_json=? WHERE id='d'").run(JSON.stringify(["p"]));
      const backup = { format: "lifeos-backup", schemaVersion: 37, appVersion: "0.1.0", exportedAt: clock.now().toISOString(), data: Object.fromEntries(backupTables.slice(0, 38).map(t => [t, db.prepare("SELECT * FROM " + t).all()])) };
      expect(inspectBackup(backup).counts.decision_person_links).toBe(1);
      const old = structuredClone(backup); old.schemaVersion = 36; delete old.data.decision_person_links;
      expect(inspectBackup(old).counts.decision_person_links).toBe(0);
      for (const key of ["person_id", "decision_id"]) {
        const invalid = structuredClone(backup); invalid.data.decision_person_links[0][key] = "missing";
        expect(() => inspectBackup(invalid)).toThrow();
      }
      const duplicate = structuredClone(backup); duplicate.data.decision_person_links.push(duplicate.data.decision_person_links[0]);
      expect(() => inspectBackup(duplicate)).toThrow("重复");
      expect(() => db.exec("DELETE FROM people WHERE id='p'")).toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });
});
