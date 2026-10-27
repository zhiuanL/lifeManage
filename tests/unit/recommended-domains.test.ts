import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteSystemRepository } from "../../src/repositories/sqlite/SqliteSystemRepository";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { BootstrapApplicationService } from "../../src/services/system/BootstrapApplicationService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
import type { SqliteExecutor } from "../../src/repositories/sqlite/SqliteExecutor";

const clock = { now: () => new Date("2026-09-29T08:00:00.000Z") };

function setup(db: DatabaseSync, executor = nativeSqliteExecutor(db)) {
  const repository = new SqliteLifeDomainRepository(executor);
  let sequence = 0;
  const ids = { next: () => `domain-${++sequence}` };
  return {
    system: new SqliteSystemRepository(executor, clock),
    domains: new LifeDomainService(repository, clock, ids),
    bootstrap: new BootstrapApplicationService(
      new MigrationRunner(executor, migrations, clock),
      new SqliteSystemRepository(executor, clock), clock, ids,
    ),
  };
}

describe("recommended life domains in real SQLite", () => {
  it("keeps the seeded domains after closing and reopening the database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "lifeos-recommendations-"));
    const path = join(directory, "lifeos.db");
    try {
      const first = new DatabaseSync(path);
      try {
        await setup(first).bootstrap.bootstrap();
      } finally {
        first.close();
      }
      const reopened = new DatabaseSync(path);
      try {
        const { bootstrap, domains } = setup(reopened);
        expect((await bootstrap.bootstrap()).isFirstInitialization).toBe(false);
        expect((await domains.list()).map((domain) => domain.name))
          .toEqual(["事业", "成长", "健康", "关系", "财务"]);
      } finally {
        reopened.close();
      }
    } finally {
      unlinkSync(path);
      rmdirSync(directory);
    }
  });

  it("seeds only a truly new space, with no made-up personal context", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const { bootstrap, domains, system } = setup(db);
      expect((await bootstrap.bootstrap()).isFirstInitialization).toBe(true);
      const original = await domains.list();
      expect(original.map((domain) => domain.name))
        .toEqual(["事业", "成长", "健康", "关系", "财务"]);
      expect(original.every((domain) =>
        domain.currentState === "" && domain.focus === "" &&
        domain.description === "" && domain.longTermExpectation === "")).toBe(true);
      expect(await system.getMetadata("m0_recommended_domains_pending")).toBeNull();
      expect((await bootstrap.bootstrap()).isFirstInitialization).toBe(false);
      expect(await domains.list()).toEqual(original);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("does not populate a previously initialized blank space or a restored database", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const { bootstrap, domains, system } = setup(db);
      await new MigrationRunner(nativeSqliteExecutor(db), migrations, clock).run();
      await system.setMetadata("m0_initialized_at", "2026-09-20");
      expect((await bootstrap.bootstrap()).isFirstInitialization).toBe(false);
      expect(await domains.list()).toEqual([]);

      await domains.create({
        name: "自定义领域", description: "保留内容", focus: "真实关注",
        color: "fern", icon: "home",
      });
      db.prepare("DELETE FROM app_metadata WHERE key = 'm0_initialized_at'").run();
      expect((await bootstrap.bootstrap()).isFirstInitialization).toBe(false);
      expect((await domains.list()).map((domain) => domain.name)).toEqual(["自定义领域"]);

      // A restored empty backup with missing metadata must also stay empty.
      db.prepare("DELETE FROM life_domains").run();
      db.prepare("DELETE FROM app_metadata WHERE key = 'm0_initialized_at'").run();
      await bootstrap.bootstrap();
      expect(await domains.list()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("only adds selected missing recommendations and preserves edited or archived domains", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const { bootstrap, domains } = setup(db);
      await bootstrap.bootstrap();
      const health = (await domains.list()).find((domain) => domain.name === "健康")!;
      await domains.update(health.id, { ...health, status: "archived", focus: "恢复运动" });
      await domains.addRecommended(["健康", "事业"]);
      expect((await domains.list()).find((domain) => domain.name === "健康"))
        .toMatchObject({ id: health.id, status: "archived", focus: "恢复运动" });

      db.prepare("DELETE FROM life_domains WHERE name IN ('关系', '财务')").run();
      await domains.addRecommended(["健康", "关系"]);
      expect((await domains.list()).map((domain) => domain.name))
        .toEqual(["事业", "成长", "健康", "关系"]);
      await domains.addRecommended(["关系"]);
      expect(await domains.list()).toHaveLength(4);
      await expect(domains.addRecommended(["未知领域"])).rejects.toThrow("可用的推荐领域");
    } finally {
      db.close();
    }
  });

  it("does not partially add an opt-in batch if SQLite rejects one choice", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const { bootstrap, domains } = setup(db);
      await bootstrap.bootstrap();
      db.prepare("DELETE FROM life_domains WHERE name IN ('关系', '财务')").run();
      db.exec(`CREATE TRIGGER reject_finance BEFORE INSERT ON life_domains
        WHEN NEW.name = '财务' BEGIN SELECT RAISE(ABORT, 'finance failed'); END`);
      await expect(domains.addRecommended(["关系", "财务"])).rejects.toThrow("finance failed");
      expect((await domains.list()).map((domain) => domain.name))
        .toEqual(["事业", "成长", "健康"]);
      db.exec("DROP TRIGGER reject_finance");
      await domains.addRecommended(["关系", "财务"]);
      expect(await domains.list()).toHaveLength(5);
    } finally {
      db.close();
    }
  });

  it("rolls back incomplete fresh seeds, then retries without duplicating data", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const sql = nativeSqliteExecutor(db);
      let shouldFail = true;
      const failingExecutor: SqliteExecutor = {
        ...sql,
        executeTransaction: async (statements) => {
          if (shouldFail && statements.some((entry) =>
            entry.statement.startsWith("INSERT OR IGNORE INTO app_metadata"))) {
            db.exec(`CREATE TRIGGER reject_health BEFORE INSERT ON life_domains
              WHEN NEW.name = '健康' BEGIN SELECT RAISE(ABORT, 'seed failed'); END`);
          }
          return sql.executeTransaction(statements);
        },
      };
      const { bootstrap, domains, system } = setup(db, failingExecutor);
      await expect(bootstrap.bootstrap()).rejects.toThrow("seed failed");
      expect(await domains.list()).toEqual([]);
      expect(await system.getMetadata("m0_initialized_at")).toBeNull();
      expect(await system.getMetadata("m0_recommended_domains_pending")).not.toBeNull();

      db.exec("DROP TRIGGER reject_health");
      shouldFail = false;
      expect((await bootstrap.bootstrap()).isFirstInitialization).toBe(true);
      expect(await domains.list()).toHaveLength(5);
      expect((await bootstrap.bootstrap()).isFirstInitialization).toBe(false);
      expect(await domains.list()).toHaveLength(5);
    } finally {
      db.close();
    }
  });
});
