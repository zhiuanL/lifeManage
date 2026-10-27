import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { inspectBackup, personDatesBackupTables, personRelationshipBackupTables } from "../../src/domain/backup/Backup";
import { buildPersonRelationshipTimeline, parsePersonRelationshipSnapshot,
  type PersonRelationshipChange } from "../../src/domain/records/PersonRelationshipHistory";
import type { Person } from "../../src/domain/records/LifeRecords";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteLifeRecordsRepository } from "../../src/repositories/sqlite/SqliteLifeRecordsRepository";
import { SqlitePersonRelationshipHistoryRepository } from "../../src/repositories/sqlite/SqlitePersonRelationshipHistoryRepository";
import { PersonRelationshipTimelineService } from "../../src/services/history/PersonRelationshipTimelineService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { LifeRecordsService } from "../../src/services/records/LifeRecordsService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const stamp = "2026-10-22T08:00:00.000Z";
const before = { name: "老朋友", relationshipType: "朋友", state: "保持联系", domainIds: ["health"] };
const change: PersonRelationshipChange = { id: 1, personId: "person/a", changedAt: stamp,
  before, after: { ...before, state: "暂时疏远", domainIds: ["career"] } };
const old: Person = { id: "person", name: "老朋友", relationshipType: "朋友", state: "保持联系",
  importantDate: "2026-10-01", lastContact: null, sharedExperiences: "", notes: "", domainIds: [],
  archived: false, createdAt: stamp, updatedAt: stamp };

describe("V1 original person relationship facts", () => {
  it("uses actual changes, original scopes and timestamps and retains later reversals", () => {
    const reversed = { ...change, id: 2, before: change.after, after: change.before };
    const noOp = { ...change, id: 3, after: { ...before, name: "改名", domainIds: ["elsewhere"] } };
    const entries = buildPersonRelationshipTimeline([change, reversed, noOp]);
    expect(entries.map(entry => entry.change.id)).toEqual([2, 1]);
    expect(entries[1]).toMatchObject({ personId: change.personId, changedAt: stamp,
      domainIds: ["health", "career"], detail: "关系状态：保持联系 → 暂时疏远" });
    entries[1].change.before.domainIds = [];
    expect(before.domainIds).toEqual(["health"]);
    expect(buildPersonRelationshipTimeline([{ ...change, after: { ...before,
      relationshipType: "同事", state: "" } }])[0].detail)
      .toBe("关系类型：朋友 → 同事；关系状态：保持联系 → 未填写");
    const raw = { ...before, name: "  原始名字  ", state: "  原始状态  " };
    expect(parsePersonRelationshipSnapshot(raw)).toEqual(raw);
  });

  it("rejects malformed history rather than guessing missing fields or dates", () => {
    for (const row of [
      { ...before, domainIds: ["health", "health"] }, { ...before, domainIds: [1] },
      { ...before, domainIds: [""] }, { ...before, name: "" }, { ...before, state: "字".repeat(201) },
      { ...before, extra: true }, { name: "旧记录", state: "", domainIds: [] },
    ]) expect(() => parsePersonRelationshipSnapshot(row)).toThrow();
    for (const patch of [{ id: 0 }, { id: 0.5 }, { personId: "" },
      { changedAt: "2026-02-30T08:00:00Z" }, { changedAt: "2026-10-22" }]) {
      expect(() => buildPersonRelationshipTimeline([{ ...change, ...patch }])).toThrow();
    }
    expect(() => buildPersonRelationshipTimeline([change, change])).toThrow();
  });

  for (const mode of ["SQLite", "memory"] as const) {
    it(`${mode} captures before-state in the write transaction and rolls back failed changes`, async () => {
      const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
      const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
      const clock = { now: () => new Date(stamp) };
      try {
        if (db) db.exec("PRAGMA foreign_keys=ON");
        await new MigrationRunner(sql, migrations.slice(0, 49), clock).run();
        const repo = new SqliteLifeRecordsRepository(sql);
        await repo.savePerson(old, true);
        const domains = new SqliteLifeDomainRepository(sql);
        let index = 0;
        const domainService = new LifeDomainService(domains, clock, { next: () => `domain-${++index}` });
        const health = await domainService.create({ name: "健康", description: "", focus: "",
          color: "fern", icon: "heart" });
        const career = await domainService.create({ name: "事业", description: "", focus: "",
          color: "ocean", icon: "briefcase" });
        await new MigrationRunner(sql, migrations.slice(0, 50), clock).run();
        const history = new SqlitePersonRelationshipHistoryRepository(sql);
        const life = new LifeRecordsService(repo, domains, new SqliteGoalRepository(sql), clock,
          { next: () => "second-person" });
        expect(await history.listChanges()).toEqual([]);
        const linked = await life.savePerson({ ...old, domainIds: [health.id, career.id] }, old.id);
        const dated = await life.savePerson({ ...linked, dates: [
          { kind: "birthday", label: "生日", date: "1990-02-28" },
        ], domainIds: [career.id, health.id], notes: "只补充备注" }, old.id);
        expect(await history.listChanges()).toEqual([]);
        const changed = await life.savePerson({ ...dated, state: "暂时疏远",
          domainIds: [career.id] }, old.id);
        expect(await history.listChanges()).toEqual([{
          id: 1, personId: old.id, changedAt: stamp,
          before: { name: old.name, relationshipType: old.relationshipType, state: old.state,
            domainIds: [health.id, career.id].sort() },
          after: { name: old.name, relationshipType: old.relationshipType, state: "暂时疏远",
            domainIds: [career.id] },
        }]);
        await life.savePerson(changed, old.id);
        await life.setArchived("people", old.id, true);
        expect(await history.listChanges()).toHaveLength(1);
        // A stale submitted object must not be used as the historical before-state.
        await repo.savePerson({ ...dated, state: "保持联系" }, false);
        const restoredHistory = await new SqlitePersonRelationshipHistoryRepository(sql).listChanges();
        expect(restoredHistory).toHaveLength(2);
        expect(restoredHistory[1].before.state).toBe("暂时疏远");
        expect(restoredHistory[1].before.domainIds).toEqual([career.id]);
        expect(restoredHistory[1].after.domainIds).toEqual([health.id, career.id].sort());
        expect(await new PersonRelationshipTimelineService(history).list()).toHaveLength(2);
        const stable = (await life.listPeople())[0];
        let restoreSpy: (() => void) | undefined;
        if (db) {
          db.exec(`CREATE TRIGGER fail_relationship_save BEFORE INSERT ON person_dates
            BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
        } else {
          const execute = sql.execute.bind(sql);
          const spy = vi.spyOn(sql, "execute").mockImplementation(async (statement, values) => {
            if (statement.trim().startsWith("INSERT INTO person_dates")) throw new Error("injected failure");
            return execute(statement, values);
          });
          restoreSpy = () => spy.mockRestore();
        }
        await expect(life.savePerson({ ...stable, state: "不能留下历史", domainIds: [] }, old.id))
          .rejects.toThrow();
        if (db) db.exec("DROP TRIGGER fail_relationship_save");
        restoreSpy?.();
        expect((await life.listPeople())[0]).toEqual(stable);
        expect(await history.listChanges()).toEqual(restoredHistory);
        await expect(life.savePerson(stable, "missing")).rejects.toThrow("人物已不存在");
        await life.savePerson({ ...old, state: "新建时已疏远" });
        expect(await history.listChanges()).toHaveLength(2);
        if (db) {
          expect(() => db.prepare("DELETE FROM people WHERE id = ?").run(old.id)).toThrow();
          expect(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?")
            .get("person_relationship_versions")).toEqual({ seq: 2 });
        }
      } finally { db?.close(); }
    });
  }

  it("preflights version 50 rows and original scope references while old backups stay empty", async () => {
    const db = new DatabaseSync(":memory:");
    const clock = { now: () => new Date(stamp) };
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, 50), clock).run();
      const repo = new SqliteLifeRecordsRepository(sql);
      await repo.savePerson(old, true);
      await repo.savePerson({ ...old, state: "暂时疏远" }, false);
      const data = Object.fromEntries(personRelationshipBackupTables.map(table =>
        [table, db.prepare(`SELECT * FROM ${table}`).all()]));
      const backup = { format: "lifeos-backup", schemaVersion: 50, appVersion: "test", exportedAt: stamp, data };
      expect(inspectBackup(backup).counts.person_relationship_versions).toBe(1);
      const legacy = { ...backup, schemaVersion: 49,
        data: Object.fromEntries(personDatesBackupTables.map(table => [table, data[table]])) };
      expect(inspectBackup(legacy).counts.person_relationship_versions).toBe(0);
      expect(() => inspectBackup({ ...backup, schemaVersion: 49 })).toThrow();
      const row = data.person_relationship_versions[0] as Record<string, unknown>;
      for (const patch of [{ person_id: "missing" }, { id: 0.5 }, { changed_at: "2026-02-30T08:00:00Z" },
        { before_json: "{}" }, { after_json: JSON.stringify({ ...before, domainIds: ["missing"] }) },
        { extra: "field" }]) {
        expect(() => inspectBackup({ ...backup, data: { ...data,
          person_relationship_versions: [{ ...row, ...patch }] } })).toThrow();
      }
      expect(() => inspectBackup({ ...backup, data: { ...data,
        person_relationship_versions: [row, row] } })).toThrow();
    } finally { db.close(); }
  });

  it("rolls back migration 50 without backfilling or rewriting existing people and dates", async () => {
    const db = new DatabaseSync(":memory:");
    const clock = { now: () => new Date(stamp) };
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, 49), clock).run();
      await new SqliteLifeRecordsRepository(sql).savePerson({ ...old, dates: [
        { kind: "birthday", label: "生日", date: "1990-02-28" },
      ] }, true);
      const people = db.prepare("SELECT * FROM people").all();
      const dates = db.prepare("SELECT * FROM person_dates").all();
      const migration = migrations[49];
      await expect(new MigrationRunner(sql, [...migrations.slice(0, 49), {
        ...migration, statements: [...migration.statements, "CREATE TABLE people (id TEXT)"],
      }], clock).run()).rejects.toThrow();
      expect(db.prepare("SELECT * FROM people").all()).toEqual(people);
      expect(db.prepare("SELECT * FROM person_dates").all()).toEqual(dates);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='person_relationship_versions'").all()).toEqual([]);
      expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get())
        .toMatchObject({ version: migrations[48].id });
    } finally { db.close(); }
  });
});
