import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteDecisionRepository } from "../../src/repositories/sqlite/SqliteDecisionRepository";
import { SqliteResourceNeedRepository } from "../../src/repositories/sqlite/SqliteResourceNeedRepository";
import { SqlitePrivacyRepository } from "../../src/repositories/sqlite/SqlitePrivacyRepository";
import { ResourceService } from "../../src/services/resources/ResourceService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import type { GoalService } from "../../src/services/planning/GoalService";
import type { LifeRecordsService } from "../../src/services/records/LifeRecordsService";
const clock = { now: () => new Date("2026-10-12T08:00:00Z") };
const decision = { id: "d", title: "choice", decidedOn: "2026-10-12", importance: "ordinary" as const,
  status: "considering" as const, background: "", options: "", constraints: "", criteria: "", risks: "",
  opportunityCost: "", reversibility: "unknown" as const, choice: "", rationale: "", executionConditions: "",
  outcome: "", reflection: "", domainIds: [], goalId: null, createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() };
describe("decision-owned resource needs", () => {
  for (const mode of ["SQLite", "preview"]) it(mode + " saves without a goal and rejects invalid ownership", async () => {
    const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    try {
      db?.exec("PRAGMA foreign_keys=ON");
      await new MigrationRunner(sql, migrations, clock).run();
      const decisions = new SqliteDecisionRepository(sql);
      await decisions.create(decision);
      const repo = new SqliteResourceNeedRepository(sql);
      let seq = 0;
      const service = new ResourceService(repo, { findById: async () => null } as unknown as GoalService,
        {} as LifeRecordsService, clock, { next: () => "need-" + ++seq }, decisions);
      const draft = { goalId: null, decisionId: "d", kind: "time" as const, description: "two hours", skillId: null, personId: null, met: false };
      const need = await service.save(draft);
      expect(need).toMatchObject({ goalId: null, decisionId: "d" });
      const privacy = new SqlitePrivacyRepository(sql);
      expect((await privacy.list()).get(`resource:${need.id}`)).toBe("private");
      expect(await privacy.set("resource", need.id, "highly_sensitive")).toBe(true);
      expect(await privacy.set("resource", "missing", "normal")).toBe(false);
      await service.save({ ...draft, met: true }, need.id);
      expect((await privacy.list()).get(`resource:${need.id}`)).toBe("highly_sensitive");
      expect(await service.list()).toHaveLength(1);
      expect((await service.list())[0].met).toBe(true);
      await expect(service.save({ ...draft, decisionId: "missing" })).rejects.toThrow();
      await expect(service.save({ ...draft, goalId: "g" })).rejects.toThrow();
      await expect(service.save({ ...draft, decisionId: null })).rejects.toThrow();
      await decisions.create({ ...decision, id: "other" });
      await expect(service.save({ ...draft, decisionId: "other" }, need.id)).rejects.toThrow();
      expect((await service.list())[0]).toMatchObject({ decisionId: "d", met: true });
      if (db) {
        const backup = { format: "lifeos-backup", schemaVersion: 40, appVersion: "0.1.0", exportedAt: clock.now().toISOString(),
          data: Object.fromEntries(backupTables.map(t => [t, db.prepare("SELECT * FROM " + t).all()])) };
        expect(inspectBackup(backup).counts.resource_needs).toBe(1);
        for (const value of [null, "missing"]) {
          const bad = structuredClone(backup); bad.data.resource_needs[0].decision_id = value;
          expect(() => inspectBackup(bad)).toThrow();
        }
        expect(() => db.exec("DELETE FROM decisions WHERE id='d'")).toThrow();
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      }
    } finally { db?.close(); }
  });
  it("preserves V38 facts, references and history and rolls back a failed migration", async () => {
    const db = new DatabaseSync(":memory:"), sql = nativeSqliteExecutor(db);
    try {
      db.exec("PRAGMA foreign_keys=ON");
      await new MigrationRunner(sql, migrations.slice(0, 38), clock).run();
      await new SqliteDecisionRepository(sql).create(decision);
      db.exec("INSERT INTO goals (id,title,status,sort_order,created_at,updated_at) VALUES ('g','goal','active',0,'2026-10-12','2026-10-12')");
      db.exec("INSERT INTO resource_needs (id,goal_id,kind,description,created_at,updated_at) VALUES ('n','g','time','need','2026-10-12','2026-10-12')");
      db.exec("INSERT INTO decision_resource_need_links VALUES ('d','n'); UPDATE decision_writes SET title='changed' WHERE id='d'");
      const facts = db.prepare("SELECT * FROM resource_needs").all();
      const links = db.prepare("SELECT * FROM decision_resource_need_links").all();
      const history = db.prepare("SELECT * FROM object_versions").all();
      const last = migrations[38];
      await expect(new MigrationRunner(sql, [...migrations.slice(0, 38), { ...last, statements: [...last.statements, "SELECT invalid_column FROM resource_needs"] }], clock).run()).rejects.toThrow();
      expect(db.prepare("SELECT * FROM resource_needs").all()).toEqual(facts);
      expect(db.prepare("SELECT * FROM decision_resource_need_links").all()).toEqual(links);
      await new MigrationRunner(sql, migrations, clock).run();
      await new MigrationRunner(sql, migrations, clock).run();
      expect(db.prepare("SELECT * FROM resource_needs").all()).toEqual(facts.map(r => ({ ...r, decision_id: null, privacy_level: "private" })));
      expect(db.prepare("SELECT * FROM decision_resource_need_links").all()).toEqual(links);
      expect(db.prepare("SELECT * FROM object_versions").all()).toEqual(history);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });
});
