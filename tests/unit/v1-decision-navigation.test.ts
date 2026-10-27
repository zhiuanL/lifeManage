import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteDecisionRepository } from "../../src/repositories/sqlite/SqliteDecisionRepository";
import { SqliteLifeNavigationRepository } from "../../src/repositories/sqlite/SqliteLifeNavigationRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { DecisionService } from "../../src/services/decisions/DecisionService";
import { LifeNavigationService } from "../../src/services/life/LifeNavigationService";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
import type { DecisionDraft } from "../../src/domain/decisions/Decision";
const clock = { now: () => new Date("2026-10-12T08:00:00Z") };
const draft: DecisionDraft = { title: "决策", decidedOn: "2026-10-12", importance: "major", status: "considering",
  background: "原正文", options: "", constraints: "独立约束", criteria: "", risks: "", opportunityCost: "",
  reversibility: "unknown", choice: "", rationale: "", executionConditions: "", outcome: "", reflection: "", domainIds: [], goalId: null };
describe("V1 decision navigation references", () => {
  for (const mode of ["SQLite", "preview"]) it(mode + " preserves references, archives and atomic history", async () => {
    const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    try {
      if (db) db.exec("PRAGMA foreign_keys=ON");
      await new MigrationRunner(sql, migrations, clock).run();
      let seq = 0; const ids = { next: () => "ref-" + ++seq };
      const navigation = new SqliteLifeNavigationRepository(sql);
      const life = new LifeNavigationService(navigation, clock, ids);
      const repository = new SqliteDecisionRepository(sql);
      const decisions = new DecisionService(repository, new SqliteLifeDomainRepository(sql), new SqliteGoalRepository(sql), clock, ids, navigation);
      const refs = [];
      for (const kind of ["mission", "value", "vision", "principle"] as const) refs.push(await life.create(kind, { title: kind, description: "依据正文" }));
      const links = refs.map(r => r.id).sort();
      const decision = await decisions.create({ ...draft, navigationIds: [" " + links[0] + " ", ...links] });
      expect((await decisions.list())[0]).toMatchObject({ navigationIds: links, constraints: "独立约束" });
      await decisions.update(decision.id, { ...draft, title: "改标题" });
      expect((await decisions.findById(decision.id))?.navigationIds).toEqual(links);
      await life.setArchived(links[0], true);
      await decisions.update(decision.id, { ...draft, title: "保留历史依据" });
      await expect(decisions.create({ ...draft, navigationIds: [links[0]] })).rejects.toThrow("归档");
      const history = new VersionHistoryService(new SqliteObjectVersionRepository(sql));
      const before = await decisions.findById(decision.id), versions = await history.list("decision", decision.id);
      await expect(decisions.update(decision.id, { ...draft, background: "不应保存", navigationIds: ["missing"] })).rejects.toThrow("不存在");
      await expect(repository.update({ ...before!, background: "不应保存", navigationIds: ["missing"] })).rejects.toThrow();
      expect(await decisions.findById(decision.id)).toEqual(before);
      expect(await history.list("decision", decision.id)).toEqual(versions);
      await decisions.update(decision.id, { ...draft, navigationIds: [] });
      expect((await decisions.findById(decision.id))?.navigationIds).toEqual([]);
      expect((await history.list("decision", decision.id))[0].snapshot).toMatchObject({ navigation_ids: links });
      await expect(decisions.update(decision.id, { ...draft, navigationIds: [links[0]] })).rejects.toThrow("归档");
      await expect(decisions.create({ ...draft, navigationIds: [" "] })).rejects.toThrow("无效");
    } finally { db?.close(); }
  });
  it("migrates V35 without rewriting facts and validates V36/V35 backups", async () => {
    const db = new DatabaseSync(":memory:"), sql = nativeSqliteExecutor(db);
    try {
      db.exec("PRAGMA foreign_keys=ON");
      await new MigrationRunner(sql, migrations.slice(0, 35), clock).run();
      db.exec("INSERT INTO decisions (id,title,decided_on,importance,status,reversibility,created_at,updated_at) VALUES ('d','旧决策','2026-10-12','major','considering','unknown','2026-10-12','2026-10-12')");
      const before = db.prepare("SELECT * FROM decisions").get();
      await new MigrationRunner(sql, migrations, clock).run();
      await new MigrationRunner(sql, migrations, clock).run();
      expect(db.prepare("SELECT * FROM decisions").get()).toEqual(before);
      expect(db.prepare("SELECT * FROM object_versions").all()).toEqual([]);
      db.exec("INSERT INTO life_navigation (id,kind,title,description,created_at,updated_at) VALUES ('n','principle','原则','正文','2026-10-12','2026-10-12')");
      db.prepare("UPDATE decision_writes SET navigation_ids_json=? WHERE id='d'").run(JSON.stringify(["n"]));
      const backup = { format: "lifeos-backup", schemaVersion: 36, appVersion: "0.1.0", exportedAt: clock.now().toISOString(),
        data: Object.fromEntries(backupTables.slice(0, 37).map(t => [t, db.prepare("SELECT * FROM " + t).all()])) };
      expect(inspectBackup(backup).counts.decision_navigation_links).toBe(1);
      const old = structuredClone(backup); old.schemaVersion = 35; delete old.data.decision_navigation_links;
      expect(inspectBackup(old).counts.decisions).toBe(1);
      for (const changes of [{ navigation_id: "missing" }, { decision_id: "missing" }]) {
        const invalid = structuredClone(backup); Object.assign(invalid.data.decision_navigation_links[0], changes);
        expect(() => inspectBackup(invalid)).toThrow();
      }
      const duplicate = structuredClone(backup); duplicate.data.decision_navigation_links.push(duplicate.data.decision_navigation_links[0]);
      expect(() => inspectBackup(duplicate)).toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });
});

