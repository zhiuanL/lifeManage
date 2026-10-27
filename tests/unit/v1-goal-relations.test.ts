import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { goalRelationTypes, visibleGoalRelations } from "../../src/domain/planning/GoalRelation";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteGoalProgressItemRepository } from "../../src/repositories/sqlite/SqliteGoalProgressItemRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { GoalService } from "../../src/services/planning/GoalService";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
const clock = { now: () => new Date("2026-10-12T08:00:00Z") };
const draft = { title: "目标", description: "", domainId: null, status: "active" as const, targetDate: null };
describe("V1 goal relations", () => {
  for (const mode of ["SQLite", "preview"] as const) {
    it(mode + " persists four types, preserves omitted relations and captures history", async () => {
      const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
      db?.exec("PRAGMA foreign_keys = ON");
      const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
      try {
        await new MigrationRunner(sql, migrations, clock).run();
        let sequence = 0;
        const repo = new SqliteGoalRepository(sql);
        const service = new GoalService(repo, new SqliteLifeDomainRepository(sql), clock, { next: () => "relation-" + ++sequence });
        const target = await service.create(draft);
        const relations = goalRelationTypes.map((type) => ({ targetGoalId: target.id, type }));
        const source = await service.create({ ...draft, relations });
        expect((await service.findById(source.id))?.relations).toHaveLength(4);
        expect(visibleGoalRelations(target, await service.list()).map((item) => item.label).sort()).toEqual(["被支持", "被依赖", "冲突", "相关"].sort());
        await service.update(source.id, { ...draft, title: "只改标题" });
        expect((await service.findById(source.id))?.relations).toHaveLength(4);
        await new SqliteGoalProgressItemRepository(sql).replace(source.id, [], clock.now().toISOString());
        const history = await new VersionHistoryService(new SqliteObjectVersionRepository(sql)).list("goal", source.id);
        expect(history).toHaveLength(2);
        expect(history.every((version) => Array.isArray(version.snapshot.relations) && version.snapshot.relations.length === 4)).toBe(true);
        for (const invalid of [
          [{ targetGoalId: source.id, type: "support" as const }],
          [{ targetGoalId: "missing", type: "support" as const }],
          [{ targetGoalId: target.id, type: "unknown" as never }],
          [relations[0], relations[0]],
        ]) await expect(service.update(source.id, { ...draft, relations: invalid })).rejects.toThrow();
        await expect(service.update(target.id, { ...draft, relations: [{ targetGoalId: source.id, type: "conflict" }] })).rejects.toThrow("已存在");
        await service.update(target.id, { ...draft, relations: [{ targetGoalId: source.id, type: "support" }] });
        const previous = await service.findById(source.id);
        await expect(repo.update({ ...previous!, title: "不能留下", relations: [{ targetGoalId: "missing", type: "related" }] })).rejects.toThrow();
        expect(await service.findById(source.id)).toEqual(previous);
        expect(await new VersionHistoryService(new SqliteObjectVersionRepository(sql)).list("goal", source.id)).toHaveLength(2);
        await service.update(source.id, { ...draft, relations: [] });
        expect((await service.findById(source.id))?.relations).toEqual([]);
      } finally { db?.close(); }
    });
  }
  it("migrates V30 without rewriting facts and validates V31 and legacy backups", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, 30), clock).run();
      db.exec("INSERT INTO goals (id,title,status,sort_order,created_at,updated_at) VALUES ('a','旧目标','active',0,'2026-10-10','2026-10-10'), ('b','目标二','active',1,'2026-10-10','2026-10-10')");
      const before = db.prepare("SELECT * FROM goals").all();
      await new MigrationRunner(sql, migrations, clock).run();
      await new MigrationRunner(sql, migrations, clock).run();
      expect(db.prepare("SELECT * FROM goals").all()).toEqual(before.map(row => ({ ...row, horizon: null, direction_id: null })));
      expect(db.prepare("SELECT * FROM object_versions").all()).toEqual([]);
      const backup = { format: "lifeos-backup", schemaVersion: 31, appVersion: "0.1.0", exportedAt: clock.now().toISOString(), data: Object.fromEntries(backupTables.slice(0, 35).map((table) => [table, db.prepare("SELECT * FROM " + table).all()])) };
      backup.data.goal_relations = [{ goal_id: "a", target_goal_id: "b", relation_type: "related" }];
      expect(inspectBackup(backup).counts.goal_relations).toBe(1);
      for (const changes of [{ target_goal_id: "a" }, { target_goal_id: "missing" }, { relation_type: "unknown" }]) {
        const bad = structuredClone(backup); Object.assign(bad.data.goal_relations[0], changes);
        expect(() => inspectBackup(bad)).toThrow();
      }
      const duplicate = structuredClone(backup); duplicate.data.goal_relations.push({ goal_id: "b", target_goal_id: "a", relation_type: "related" });
      expect(() => inspectBackup(duplicate)).toThrow("重复");
      const legacy = structuredClone(backup); legacy.schemaVersion = 30; delete legacy.data.goal_relations;
      expect(inspectBackup(legacy).counts.goal_relations).toBe(0);
      db.exec("INSERT INTO goal_relations VALUES ('a','b','related')");
      for (const query of ["INSERT INTO goal_relations VALUES ('b','a','related')", "INSERT INTO goal_relations VALUES ('a','a','support')", "INSERT INTO goal_relations VALUES ('a','missing','support')"]) expect(() => db.exec(query)).toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });
});
