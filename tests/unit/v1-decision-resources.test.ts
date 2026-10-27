import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteDecisionRepository } from "../../src/repositories/sqlite/SqliteDecisionRepository";
import { SqliteLifeNavigationRepository } from "../../src/repositories/sqlite/SqliteLifeNavigationRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteResourceNeedRepository } from "../../src/repositories/sqlite/SqliteResourceNeedRepository";
import { ResourceService } from "../../src/services/resources/ResourceService";
import { GoalService } from "../../src/services/planning/GoalService";
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
describe("V1 decision resource references", () => {
  for (const mode of ["SQLite", "preview"]) it(mode + " preserves links and rolls back invalid updates with history", async () => {
    const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    try {
      if (db) db.exec("PRAGMA foreign_keys=ON");
      await new MigrationRunner(sql, migrations, clock).run();
      let seq = 0; const ids = { next: () => "ref-" + ++seq };
      const domains = new SqliteLifeDomainRepository(sql), goalsRepo = new SqliteGoalRepository(sql);
      const goals = new GoalService(goalsRepo, domains, clock, ids);
      const records = new SqliteLifeRecordsRepository(sql);
      const life = new LifeRecordsService(records, domains, goalsRepo, clock, ids);
      const needsRepo = new SqliteResourceNeedRepository(sql);
      const resources = new ResourceService(needsRepo, goals, life, clock, ids);
      const repository = new SqliteDecisionRepository(sql);
      const decisions = new DecisionService(repository, domains, goalsRepo, clock, ids, new SqliteLifeNavigationRepository(sql), records, needsRepo);
      const goal = await goals.create({ title: "目标", description: "", domainId: null, status: "active", targetDate: null });
      const refs = [];
      for (const kind of ["time", "tool"] as const) refs.push(await resources.save({ goalId: goal.id, kind, description: "需要支持", skillId: null, personId: null, met: false }));
      const links = refs.map(r => r.id).sort();
      const decision = await decisions.create({ ...draft, resourceNeedIds: [" " + links[0] + " ", ...links] });
      expect((await decisions.list())[0]).toMatchObject({ resourceNeedIds: links, constraints: "独立约束" });
      await decisions.update(decision.id, { ...draft, title: "修改标题" });
      expect((await decisions.findById(decision.id))?.resourceNeedIds).toEqual(links);
      await resources.save({ ...refs[0], met: true }, refs[0].id);
      const history = new VersionHistoryService(new SqliteObjectVersionRepository(sql));
      const before = await decisions.findById(decision.id), versions = await history.list("decision", decision.id);
      await expect(decisions.update(decision.id, { ...draft, resourceNeedIds: ["missing"] })).rejects.toThrow("不存在");
      await expect(repository.update({ ...before!, background: "不应保存", resourceNeedIds: ["missing"] })).rejects.toThrow();
      expect(await decisions.findById(decision.id)).toEqual(before);
      expect(await history.list("decision", decision.id)).toEqual(versions);
      await expect(repository.create({ ...before!, id: "invalid", resourceNeedIds: ["missing"] })).rejects.toThrow();
      expect(await decisions.findById("invalid")).toBeNull();
      await decisions.update(decision.id, { ...draft, resourceNeedIds: [] });
      expect((await decisions.findById(decision.id))?.resourceNeedIds).toEqual([]);
      expect((await history.list("decision", decision.id))[0].snapshot).toMatchObject({ resource_need_ids: links });
      await expect(decisions.create({ ...draft, resourceNeedIds: [" "] })).rejects.toThrow("无效");
    } finally { db?.close(); }
  });
  it("migrates V37 without rewriting facts and checks V38/V37 backup links", async () => {
    const db = new DatabaseSync(":memory:"), sql = nativeSqliteExecutor(db);
    try {
      db.exec("PRAGMA foreign_keys=ON");
      await new MigrationRunner(sql, migrations.slice(0, 37), clock).run();
      db.exec("INSERT INTO decisions (id,title,decided_on,importance,status,reversibility,created_at,updated_at) VALUES ('d','旧选择','2026-10-12','major','considering','unknown','2026-10-12','2026-10-12')");
      db.exec("INSERT INTO people (id,name,created_at,updated_at) VALUES ('person','旧人物','2026-10-12','2026-10-12'); INSERT INTO decision_person_links VALUES ('d','person'); UPDATE decision_writes SET title='保留旧历史' WHERE id='d'");
      const oldPeople = db.prepare("SELECT * FROM decision_person_links").all();
      const oldHistory = db.prepare("SELECT * FROM object_versions").all();
      const before = db.prepare("SELECT * FROM decisions").get();
      await new MigrationRunner(sql, migrations, clock).run();
      await new MigrationRunner(sql, migrations, clock).run();
      expect(db.prepare("SELECT * FROM decisions").get()).toEqual(before);
      expect(db.prepare("SELECT * FROM object_versions").all()).toEqual(oldHistory);
      expect(db.prepare("SELECT * FROM decision_person_links").all()).toEqual(oldPeople);
      db.exec("INSERT INTO goals (id,title,status,sort_order,created_at,updated_at) VALUES ('g','目标','active',0,'2026-10-12','2026-10-12'); INSERT INTO resource_needs (id,goal_id,kind,description,created_at,updated_at) VALUES ('p','g','time','时间支持','2026-10-12','2026-10-12')");
      db.prepare("UPDATE decision_writes SET resource_need_ids_json=? WHERE id='d'").run(JSON.stringify(["p"]));
      const backup = { format: "lifeos-backup", schemaVersion: 38, appVersion: "0.1.0", exportedAt: clock.now().toISOString(), data: Object.fromEntries(backupTables.map(t => [t, db.prepare("SELECT * FROM " + t).all()])) };
      expect(inspectBackup(backup).counts.decision_resource_need_links).toBe(1);
      const old = structuredClone(backup); old.schemaVersion = 37; delete old.data.decision_resource_need_links;
      expect(inspectBackup(old).counts.decision_resource_need_links).toBe(0);
      for (const key of ["resource_need_id", "decision_id"]) {
        const invalid = structuredClone(backup); invalid.data.decision_resource_need_links[0][key] = "missing";
        expect(() => inspectBackup(invalid)).toThrow();
      }
      for (const value of ["", null, 7]) {
        const invalid = structuredClone(backup); invalid.data.decision_resource_need_links[0].resource_need_id = value;
        expect(() => inspectBackup(invalid)).toThrow("无效");
      }
      const duplicate = structuredClone(backup); duplicate.data.decision_resource_need_links.push(duplicate.data.decision_resource_need_links[0]);
      expect(() => inspectBackup(duplicate)).toThrow("重复");
      expect(() => db.exec("DELETE FROM resource_needs WHERE id='p'")).toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });
});

