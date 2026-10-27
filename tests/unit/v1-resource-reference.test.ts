import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteResourceNeedRepository } from "../../src/repositories/sqlite/SqliteResourceNeedRepository";
import { SqliteLifeRecordsRepository } from "../../src/repositories/sqlite/SqliteLifeRecordsRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { ResourceService } from "../../src/services/resources/ResourceService";
import { LifeRecordsService } from "../../src/services/records/LifeRecordsService";
import { GoalService } from "../../src/services/planning/GoalService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
const clock = { now: () => new Date("2026-10-12T08:00:00Z") };

describe("resource reference boundaries", () => {
  for (const mode of ["SQLite", "preview"]) it(mode + " keeps archived history and rejects new or missing references", async () => {
    const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    try {
      if (db) db.exec("PRAGMA foreign_keys=ON");
      await new MigrationRunner(sql, migrations, clock).run();
      let seq = 0; const ids = { next: () => "resource-" + ++seq };
      const domains = new SqliteLifeDomainRepository(sql), goalsRepo = new SqliteGoalRepository(sql);
      const goals = new GoalService(goalsRepo, domains, clock, ids);
      const records = new LifeRecordsService(new SqliteLifeRecordsRepository(sql), domains, goalsRepo, clock, ids);
      const resources = new ResourceService(new SqliteResourceNeedRepository(sql), goals, records, clock, ids);
      const goal = await goals.create({ title: "目标", description: "", domainId: null, status: "active", targetDate: null });
      const person = await records.savePerson({ name: "协作者", relationshipType: "", state: "", importantDate: null,
        lastContact: null, sharedExperiences: "", notes: "", domainIds: [] });
      const skill = await records.saveSkill({ name: "能力", currentLevel: 1, targetLevel: 3,
        learningPath: "", practice: "", reflection: "", goalId: null, domainIds: [] });
      for (const ref of [{ kind: "person" as const, personId: person.id, skillId: null, table: "people" as const },
        { kind: "skill" as const, personId: null, skillId: skill.id, table: "skills" as const }]) {
        const draft = { goalId: goal.id, kind: ref.kind, personId: ref.personId, skillId: ref.skillId,
          description: "需要支持", met: false };
        const need = await resources.save(draft);
        await records.setArchived(ref.table, ref.personId ?? ref.skillId!, true);
        await resources.save({ ...need, met: true }, need.id);
        const before = await resources.list();
        await expect(resources.save(draft)).rejects.toThrow("归档");
        await expect(resources.save({ ...draft, personId: ref.kind === "person" ? "missing" : null,
          skillId: ref.kind === "skill" ? "missing" : null }, need.id)).rejects.toThrow("不存在");
        expect(await resources.list()).toEqual(before);
        await resources.save({ ...need, personId: null, skillId: null }, need.id);
        await expect(resources.save(draft, need.id)).rejects.toThrow("归档");
      }
      await expect(resources.save({ goalId: goal.id, kind: "time", description: "需求", personId: null,
        skillId: null, met: false }, "missing")).rejects.toThrow("不存在");
      if (db) expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db?.close(); }
  });
});

