import { SqliteSystemAssessmentRepository } from "../../src/repositories/sqlite/SqliteSystemAssessmentRepository";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { v1LifeDomainContextMigration } from "../../src/db/migrations/0020-v1-life-domain-context";
import { backupTables, inspectBackup, type LifeOSBackup } from "../../src/domain/backup/Backup";
import { normalizeAssessment } from "../../src/domain/assessments/SystemAssessment";
import { LifeRecordValidationError, selectPersonEvents } from "../../src/domain/records/LifeRecords";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteLifeRecordsRepository } from "../../src/repositories/sqlite/SqliteLifeRecordsRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import type { SqliteExecutor } from "../../src/repositories/sqlite/SqliteExecutor";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
import { SystemAssessmentService } from "../../src/services/assessments/SystemAssessmentService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { GoalService } from "../../src/services/planning/GoalService";
import { LifeRecordsService } from "../../src/services/records/LifeRecordsService";
import { SqliteResourceNeedRepository } from "../../src/repositories/sqlite/SqliteResourceNeedRepository";
import { ResourceService } from "../../src/services/resources/ResourceService";

const clock = { now: () => new Date("2026-09-29T08:00:00Z") };
let sequence = 0;
const ids = { next: () => `m7-${++sequence}` };
const personDraft = { name: "林", relationshipType: "朋友", state: "常联系",
  importantDate: null, lastContact: "2026-09-20", sharedExperiences: "散步",
  notes: "", domainIds: [] as string[] };
function native(db: DatabaseSync): SqliteExecutor {
  return nativeSqliteExecutor(db);
}

describe("M7 personal records and resource facts", () => {
  for (const [label, create] of [
    ["browser preview", () => ({ sql: new MemorySqliteExecutor(), close: () => {} })],
    ["real SQLite", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("PRAGMA foreign_keys=ON");
      return { sql: native(db), close: () => db.close(), db };
    }],
  ] as const) {
    it(`${label} preserves links on edits, archives, and tracks needs and monthly/quarterly reflection`, async () => {
      const { sql, close } = create();
      try {
        await new MigrationRunner(sql, migrations, clock).run();
        const domainRepo = new SqliteLifeDomainRepository(sql);
        const goalRepo = new SqliteGoalRepository(sql);
        const domains = new LifeDomainService(domainRepo, clock, ids);
        const goals = new GoalService(goalRepo, domainRepo, clock, ids);
        const records = new LifeRecordsService(new SqliteLifeRecordsRepository(sql),
          domainRepo, goalRepo, clock, ids);
        const resources = new ResourceService(new SqliteResourceNeedRepository(sql), goals, records, clock, ids);
        const assessments = new SystemAssessmentService(new SqliteSystemAssessmentRepository(sql), clock, ids);
        const health = await domains.create({ name: "健康", description: "", focus: "",
          color: "fern", icon: "heart" });
        const friends = await domains.create({ name: "关系", description: "", focus: "",
          color: "coral", icon: "users" });
        const goal = await goals.create({ title: "规律生活", description: "",
          domainId: health.id, status: "active", targetDate: null });
        const person = await records.savePerson({ ...personDraft, domainIds: [health.id, friends.id] });
        const event = await records.saveEvent({ title: "一起散步", happenedOn: "2026-09-28",
          description: "晚间", personId: person.id, goalId: goal.id, domainIds: [friends.id] });
        const skill = await records.saveSkill({ name: "时间规划", currentLevel: 1,
          targetLevel: 3, learningPath: "练习", practice: "", reflection: "",
          goalId: goal.id, domainIds: [health.id] });
        expect((await records.listPeople())[0].domainIds).toEqual([health.id, friends.id].sort());
        await records.savePerson({ ...personDraft, domainIds: [friends.id] }, person.id);
        expect((await records.listPeople())[0].domainIds).toEqual([friends.id]);
        await records.setArchived("people", person.id, true);
        expect((await records.listEvents())[0].personId).toBe(person.id);
        expect((await records.listPeople())[0].archived).toBe(true);
        const secondPerson = await records.savePerson({ ...personDraft, name: "新协作者" });
        await records.saveEvent({ ...event, personId: secondPerson.id }, event.id);
        const reloadedRecords = new LifeRecordsService(new SqliteLifeRecordsRepository(sql),
          domainRepo, goalRepo, clock, ids);
        const reloadedEvents = await reloadedRecords.listEvents();
        expect(selectPersonEvents(reloadedEvents, person.id)).toEqual([]);
        expect(selectPersonEvents(reloadedEvents, secondPerson.id, friends.id))
          .toEqual([expect.objectContaining({ id: event.id, description: "晚间", goalId: goal.id })]);
        await records.setArchived("life_events", event.id, true);
        expect(selectPersonEvents(await reloadedRecords.listEvents(), secondPerson.id)).toEqual([]);
        expect(selectPersonEvents(await reloadedRecords.listEvents(), secondPerson.id, friends.id, true))
          .toHaveLength(1);
        await expect(records.saveEvent({ ...event, personId: "missing" }, event.id))
          .rejects.toThrow(LifeRecordValidationError);
        expect((await reloadedRecords.listEvents())[0].personId).toBe(secondPerson.id);
        const need = await resources.save({ goalId: goal.id, kind: "skill",
          description: "需要规划能力", skillId: skill.id, personId: null, met: false });
        await resources.save({ ...need, met: true }, need.id);
        expect((await resources.list())[0]).toMatchObject({ id: need.id, met: true, skillId: skill.id });
        await expect(resources.save({ ...need, goalId: "missing" })).rejects.toThrow("目标");
        const draft = { periodKind: "quarter" as const, periodStart: "2026-07-01",
          clarity: "有帮助", alignment: "", reviews: "", decisions: "", earlyIssues: "",
          adjustment: "继续" };
        const original = await assessments.save(draft);
        const changed = await assessments.save({ ...draft, clarity: "更清楚" });
        expect(changed.id).toBe(original.id);
        expect(await assessments.list()).toHaveLength(1);
        expect(event.happenedOn).toBe("2026-09-28");
        expect(() => normalizeAssessment({ ...draft, periodStart: "2026-08-01" })).toThrow();
      } finally { close(); }
    });
  }

  it("rolls back a failed multi-domain update in browser preview", async () => {
    const sql = new MemorySqliteExecutor();
    await new MigrationRunner(sql, migrations, clock).run();
    const domainRepo = new SqliteLifeDomainRepository(sql);
    const recordsRepo = new SqliteLifeRecordsRepository(sql);
    const domains = new LifeDomainService(domainRepo, clock, ids);
    const life = new LifeRecordsService(recordsRepo, domainRepo, new SqliteGoalRepository(sql),
      clock, ids);
    const domain = await domains.create({ name: "关系", description: "", focus: "",
      color: "coral", icon: "users" });
    const saved = await life.savePerson({ ...personDraft, domainIds: [domain.id] });
    await expect(recordsRepo.savePerson({ ...saved, name: "不能保留",
      domainIds: [domain.id, "missing"] }, false)).rejects.toThrow("Invalid");
    expect((await life.listPeople())[0]).toMatchObject({
      name: "林", domainIds: [domain.id],
    });
  });

  it("migrates old data without rewriting it and validates new backup references", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys=ON");
      const sql = native(db);
      await new MigrationRunner(sql, migrations.slice(0, 17), clock).run();
      db.prepare(`INSERT INTO life_domains
        (id, name, description, focus, color_key, icon_key, sort_order, created_at, updated_at)
        VALUES ('old', '已有领域', '', '', 'fern', 'heart', 1, '2026-09-20', '2026-09-20')`).run();
      await new MigrationRunner(sql, migrations.slice(0, migrations.indexOf(v1LifeDomainContextMigration)), clock).run();
      db.prepare(`INSERT INTO people (id, name, created_at, updated_at)
        VALUES ('person-old', '林', '2026-09-29', '2026-09-29')`).run();
      db.prepare(`INSERT INTO person_domain_links (person_id, domain_id)
        VALUES ('person-old', 'old')`).run();
      expect(() => db.prepare(`INSERT INTO person_domain_links VALUES (?, 'missing')`)
        .run("person-old")).toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
      const backup: LifeOSBackup = { format: "lifeos-backup", schemaVersion: 19,
        appVersion: "0.1.0", exportedAt: "2026-09-29T08:00:00Z",
        data: Object.fromEntries(backupTables.slice(0, 29).map((table) => [
          table, db.prepare(`SELECT * FROM ${table}`).all(),
        ])) as LifeOSBackup["data"] };
      expect(backup.data.life_domains[0]).not.toHaveProperty("current_state");
      expect(backup.data.life_domains[0]).not.toHaveProperty("status");
      expect(inspectBackup(backup).counts.people).toBe(1);
      await new MigrationRunner(sql, migrations, clock).run();
      expect(db.prepare("SELECT name, current_state, status FROM life_domains WHERE id='old'").get())
        .toMatchObject({ name: "已有领域", current_state: "", status: "active" });
      const broken = structuredClone(backup);
      broken.data.person_domain_links![0].domain_id = "missing";
      expect(() => inspectBackup(broken)).toThrow("引用");
      for (const [version, count] of [[18, 27], [17, 21], [16, 18]] as const) {
        const old = structuredClone(backup);
        old.schemaVersion = version;
        old.data = Object.fromEntries(backupTables.slice(0, count)
          .map((table) => [table, backup.data[table]])) as LifeOSBackup["data"];
        expect(inspectBackup(old).counts.people).toBe(version >= 18 ? 1 : 0);
      }
    } finally { db.close(); }
  });
});
