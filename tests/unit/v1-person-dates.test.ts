import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { domainHistoryBackupTables, inspectBackup, personDatesBackupTables } from "../../src/domain/backup/Backup";
import { normalizePersonDates, type Person, type PersonDate } from "../../src/domain/records/LifeRecords";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteLifeRecordsRepository } from "../../src/repositories/sqlite/SqliteLifeRecordsRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { LifeRecordsService } from "../../src/services/records/LifeRecordsService";
import { SearchService } from "../../src/services/search/SearchService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const timestamp = "2026-10-22T08:00:00.000Z";
const clock = { now: () => new Date(timestamp) };
const birthday: PersonDate = { kind: "birthday", label: "生日", date: "1990-02-28" };
const important: PersonDate = { kind: "important", label: "第一次合作", date: "2024-02-29" };
const old: Person = { id: "person", name: "朋友", relationshipType: "朋友", state: "保持联系",
  importantDate: "2026-10-01", lastContact: null, sharedExperiences: "", notes: "",
  domainIds: [], archived: false, createdAt: timestamp, updatedAt: timestamp };

describe("V1 explicit birthday and named important dates", () => {
  it("keeps explicit dates independent and clones data without guessing a birthday", () => {
    expect(normalizePersonDates([])).toEqual([]);
    const source = [birthday, { ...important, label: "  第一次合作  " }];
    const normalized = normalizePersonDates(source);
    expect(normalized).toEqual([birthday, important]);
    normalized[0].date = "2000-01-01";
    expect(source[0].date).toBe(birthday.date);
    expect(normalizePersonDates(source, false)[1].label).toBe("  第一次合作  ");
    expect(normalizePersonDates([important, { ...important, label: "毕业" }])).toHaveLength(2);
  });

  it("rejects impossible dates, duplicate birthdays, duplicate named facts and malformed values", () => {
    for (const invalid of [
      null, {}, [{ ...important, date: "2026-02-30" }], [{ ...important, date: "2026-02-29" }],
      [{ ...important, date: "0099-01-01" }], [{ ...important, label: "" }],
      [{ ...important, kind: ["important"] }], [{ ...important, extra: true }],
      [{ ...birthday, label: "纪念日" }], [birthday, { ...birthday, date: "1991-01-01" }],
      [important, important], Array.from({ length: 21 }, (_, n) => ({ ...important, label: String(n) })),
    ]) expect(() => normalizePersonDates(invalid)).toThrow();
    expect(normalizePersonDates([birthday, ...Array.from({ length: 20 },
      (_, n) => ({ ...important, label: String(n) }))])).toHaveLength(21);
  });

  for (const mode of ["SQLite", "memory"] as const) {
    it(`${mode} preserves the old date and omitted fields, explicitly clears dates and rolls back failed saves`, async () => {
      const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
      const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
      try {
        if (db) db.exec("PRAGMA foreign_keys=ON");
        await new MigrationRunner(sql, migrations.slice(0, 48), clock).run();
        const repo = new SqliteLifeRecordsRepository(sql);
        await repo.savePerson(old, true);
        await new MigrationRunner(sql, migrations, clock).run();
        const service = new LifeRecordsService(repo, new SqliteLifeDomainRepository(sql),
          new SqliteGoalRepository(sql), clock, { next: () => "new-person" });
        expect(await service.listPeople()).toEqual([{ ...old, dates: [] }]);
        const saved = await service.savePerson({ ...old, dates: [birthday, important] }, old.id);
        const reloaded = new LifeRecordsService(new SqliteLifeRecordsRepository(sql),
          new SqliteLifeDomainRepository(sql), new SqliteGoalRepository(sql), clock, { next: () => "another" });
        expect((await reloaded.listPeople())[0]).toEqual(saved);
        const empty = { list: async () => [], listDefinitions: async () => [] };
        const searchArgs = [empty, empty, empty, empty, empty, empty, empty, empty,
          undefined, reloaded] as unknown as ConstructorParameters<typeof SearchService>;
        const entries = await new SearchService(...searchArgs).list();
        expect(entries.find(entry => entry.type === "person")).toMatchObject({
          date: old.createdAt.slice(0, 10), domainIds: [],
          href: "/people#person-person", content: expect.stringContaining("生日 1990-02-28"),
        });
        expect(entries.find(entry => entry.type === "person")?.content)
          .toContain("第一次合作 2024-02-29");
        expect(entries.find(entry => entry.type === "person")?.content).toContain(old.importantDate);
        await service.savePerson({ ...old, name: "改名" }, old.id);
        expect((await reloaded.listPeople())[0]).toMatchObject({
          name: "改名", importantDate: old.importantDate, dates: [birthday, important],
        });
        await service.setArchived("people", old.id, true);
        expect((await reloaded.listPeople())[0].dates).toEqual([birthday, important]);
        const before = (await reloaded.listPeople())[0];
        let stop: (() => void) | undefined;
        if (db) {
          db.exec(`CREATE TRIGGER fail_person_date BEFORE INSERT ON person_dates
            BEGIN SELECT RAISE(ABORT, 'injected date failure'); END`);
        } else {
          const original = sql.execute.bind(sql);
          const spy = vi.spyOn(sql, "execute").mockImplementation(async (statement, values) => {
            if (statement.trim().startsWith("INSERT INTO person_dates")) throw new Error("injected date failure");
            return original(statement, values);
          });
          stop = () => spy.mockRestore();
        }
        await expect(service.savePerson({ ...before, name: "不能保存", dates: [birthday] }, old.id))
          .rejects.toThrow();
        if (db) db.exec("DROP TRIGGER fail_person_date");
        stop?.();
        expect((await reloaded.listPeople())[0]).toEqual(before);
        await service.savePerson({ ...before, dates: [] }, old.id);
        expect((await reloaded.listPeople())[0]).toMatchObject({ importantDate: old.importantDate, dates: [] });
        await expect(service.savePerson({ ...before, dates: [birthday, birthday] }, old.id)).rejects.toThrow();
        expect((await reloaded.listPeople())[0].dates).toEqual([]);
        await expect(service.savePerson(before, "missing")).rejects.toThrow("人物已不存在");
      } finally { db?.close(); }
    });
  }

  it("includes dates in version 49 backup validation but never disguises them as version 48", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations, clock).run();
      const repo = new SqliteLifeRecordsRepository(sql);
      await repo.savePerson({ ...old, dates: [birthday, important] }, true);
      const data = Object.fromEntries(personDatesBackupTables.map(table =>
        [table, db.prepare(`SELECT * FROM ${table}`).all()]));
      const backup = { format: "lifeos-backup", schemaVersion: 49, appVersion: "test", exportedAt: timestamp, data };
      expect(inspectBackup(backup).counts.person_dates).toBe(2);
      const legacy = { ...backup, schemaVersion: 48,
        data: Object.fromEntries(domainHistoryBackupTables.map(table => [table, data[table]])) };
      expect(inspectBackup(legacy).counts.person_dates).toBe(0);
      expect(() => inspectBackup({ ...backup, schemaVersion: 48 })).toThrow();
      const row = data.person_dates[0] as Record<string, unknown>;
      for (const patch of [{ person_id: "missing" }, { sort_order: -1 }, { sort_order: 0.5 },
        { happened_on: "2026-02-30" }, { kind: "unknown" }, { label: "" }, { extra: "field" }]) {
        expect(() => inspectBackup({ ...backup, data: { ...data, person_dates: [{ ...row, ...patch }] } })).toThrow();
      }
      expect(() => inspectBackup({ ...backup, data: { ...data, person_dates: [row, row] } })).toThrow();
    } finally { db.close(); }
  });

  it("rolls back migration 49 without rewriting existing people or dates", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, 48), clock).run();
      await new SqliteLifeRecordsRepository(sql).savePerson(old, true);
      const before = db.prepare("SELECT * FROM people").all();
      const migration = migrations[48];
      await expect(new MigrationRunner(sql, [...migrations.slice(0, 48), {
        ...migration, statements: [...migration.statements, "CREATE TABLE people (id TEXT)"],
      }], clock).run()).rejects.toThrow();
      expect(db.prepare("SELECT * FROM people").all()).toEqual(before);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='person_dates'").all()).toEqual([]);
      expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get())
        .toMatchObject({ version: migrations[47].id });
    } finally { db.close(); }
  });
});
