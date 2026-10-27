import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { v1LifeDomainContextMigration } from "../../src/db/migrations/0020-v1-life-domain-context";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const clock = { now: () => new Date("2026-09-29T08:00:00Z") };

describe("V1 domain context migration", () => {
  it("upgrades existing domains without losing links, and enforces lifecycle constraints", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, migrations.indexOf(v1LifeDomainContextMigration)), clock).run();
      db.prepare(`INSERT INTO life_domains
        (id, name, description, focus, color_key, icon_key, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run("old", "健康", "原有说明", "原有关注", "fern", "heart", 0,
          "2026-09-22", "2026-09-22");
      db.prepare("INSERT INTO metric_definitions (id, name, unit, created_at) VALUES (?, ?, ?, ?)")
        .run("sleep", "睡眠", "小时", "2026-09-22");
      db.prepare("INSERT INTO metric_domain_links (metric_id, domain_id) VALUES (?, ?)")
        .run("sleep", "old");

      expect((await new MigrationRunner(sql, migrations, clock).run()).appliedMigrationIds)
        .toEqual(migrations.slice(migrations.indexOf(v1LifeDomainContextMigration)).map(migration => migration.id));
      const service = new LifeDomainService(new SqliteLifeDomainRepository(sql), clock,
        { next: () => "new" });
      expect(await service.findById("old")).toMatchObject({
        name: "健康", description: "原有说明", focus: "原有关注",
        currentState: "", longTermExpectation: "", status: "active",
      });
      const archived = await service.update("old", {
        name: "健康", description: "原有说明", focus: "原有关注",
        currentState: "正在调整", longTermExpectation: "稳定的节奏",
        status: "archived", color: "fern", icon: "heart",
      });
      expect(archived.status).toBe("archived");
      expect(db.prepare("SELECT domain_id FROM metric_domain_links WHERE metric_id = 'sleep'").get())
        .toMatchObject({ domain_id: "old" });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
      expect(() => db.prepare("UPDATE life_domains SET status = 'deleted' WHERE id = 'old'").run())
        .toThrow();
      expect(await new MigrationRunner(sql, migrations, clock).run()).toMatchObject({
        appliedMigrationIds: [],
      });
      expect((await service.findById("old"))?.longTermExpectation).toBe("稳定的节奏");
    } finally {
      db.close();
    }
  });
});
