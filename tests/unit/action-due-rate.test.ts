import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { m5ActionStatesMigration } from "../../src/db/migrations/0011-m5-action-states";
import { evaluateActionDueOutcomes } from "../../src/domain/analytics/ActionDueRate";
import type { ActionStateEvent } from "../../src/domain/planning/ActionStateEvent";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteActionRepository } from "../../src/repositories/sqlite/SqliteActionRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { ActionService } from "../../src/services/planning/ActionService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

function state(id: number, afterStatus: "open" | "completed",
  scheduledFor: string | null, day: string,
  beforeStatus: "open" | "completed" | null = "open"): ActionStateEvent {
  return { id, actionId: "a", beforeStatus, afterStatus, scheduledFor,
    changedAt: `${day}T12:00:00` };
}

describe("M5 auditable due completion rate", () => {
  it("removes a same-day reschedule but preserves an earlier overdue commitment", () => {
    const events = [
      state(1, "open", "2026-09-21", "2026-09-20", null),
      state(2, "open", "2026-09-22", "2026-09-21"),
      state(3, "open", "2026-09-25", "2026-09-23"),
      state(4, "completed", "2026-09-25", "2026-09-25"),
    ];
    expect(evaluateActionDueOutcomes(events, "2026-09-24"))
      .toEqual([{ dueDate: "2026-09-22", onTime: false }]);
    expect(evaluateActionDueOutcomes([...events].reverse(), "2026-09-26")).toEqual([
      { dueDate: "2026-09-22", onTime: false },
      { dueDate: "2026-09-25", onTime: true },
    ]);
  });

  it("takes the final status on the due day, not the current status or last completion", () => {
    const events = [
      state(1, "open", "2026-09-21", "2026-09-20", null),
      state(2, "completed", "2026-09-21", "2026-09-20", "open"),
      state(3, "open", "2026-09-21", "2026-09-21", "completed"),
      state(4, "completed", "2026-09-21", "2026-09-21", "open"),
      state(5, "open", "2026-09-21", "2026-09-22", "completed"),
    ];
    expect(evaluateActionDueOutcomes(events.slice(0, 3), "2026-09-22"))
      .toEqual([{ dueDate: "2026-09-21", onTime: false }]);
    expect(evaluateActionDueOutcomes(events, "2026-09-22"))
      .toEqual([{ dueDate: "2026-09-21", onTime: true }]);
    expect(evaluateActionDueOutcomes(events, "2026-09-20")).toEqual([]);
  });

  it("ignores edits after completion until reopening and excludes old actions with no baseline", () => {
    expect(evaluateActionDueOutcomes([
      state(1, "open", "2026-09-21", "2026-09-20"),
      state(2, "completed", "2026-09-21", "2026-09-21"),
    ], "2026-09-22")).toEqual([]);
    const events = [
      state(1, "open", "2026-09-21", "2026-09-20", null),
      state(2, "completed", "2026-09-21", "2026-09-20"),
      state(3, "completed", "2026-09-24", "2026-09-20", "completed"),
      state(4, "open", "2026-09-24", "2026-09-22", "completed"),
      state(5, "completed", "2026-09-24", "2026-09-24"),
    ];
    expect(evaluateActionDueOutcomes(events, "2026-09-24")).toEqual([
      { dueDate: "2026-09-21", onTime: true },
      { dueDate: "2026-09-24", onTime: true },
    ]);
  });

  it("keeps pre-migration rows intact without inventing a starting event in real SQLite", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      for (const migration of migrations.slice(0, migrations.indexOf(m5ActionStatesMigration))) {
        for (const statement of migration.statements) db.exec(statement);
      }
      db.prepare(`INSERT INTO actions (id, title, status, scheduled_for, sort_order,
        created_at, updated_at) VALUES ('old', '旧行动', 'open', '2026-09-21', 0, ?, ?)`)
        .run("2026-09-20T08:00:00.000Z", "2026-09-20T08:00:00.000Z");
      for (const statement of m5ActionStatesMigration.statements) db.exec(statement);
      for (const migration of migrations.slice(migrations.indexOf(m5ActionStatesMigration) + 1)) {
        for (const statement of migration.statements) db.exec(statement);
      }
      const executor = nativeSqliteExecutor(db);
      const repo = new SqliteActionRepository(executor);
      expect(await repo.listStateEvents()).toEqual([]);
      const old = (await repo.findById("old"))!;
      await repo.updatePlan({ ...old, scheduledFor: "2026-09-24",
        updatedAt: "2026-09-22T08:00:00.000Z" }, { reason: "personal", note: "" });
      const oldEvents = await repo.listStateEvents();
      expect(oldEvents).toEqual([expect.objectContaining({
        actionId: "old", beforeStatus: "open", scheduledFor: "2026-09-24",
      })]);
      expect(evaluateActionDueOutcomes(oldEvents, "2026-09-25")).toEqual([]);

      let now = new Date("2026-09-20T08:00:00.000Z");
      const clock = { now: () => now };
      const service = new ActionService(repo, new SqliteGoalRepository(executor),
        new SqliteLifeDomainRepository(executor), clock, { next: () => "new" });
      const draft = { title: "新行动", notes: "", domainId: null, goalId: null,
        scheduledFor: "2026-09-21" };
      await service.create(draft);
      now = new Date("2026-09-21T08:00:00.000Z");
      await service.update("new", { ...draft, scheduledFor: "2026-09-22" },
        { reason: "external", note: "" });
      now = new Date("2026-09-22T08:00:00.000Z");
      await service.toggleCompletion("new");
      now = new Date("2026-09-23T08:00:00.000Z");
      await service.toggleCompletion("new");
      await service.update("new", { ...draft, scheduledFor: "2026-09-25" },
        { reason: "personal", note: "" });
      now = new Date("2026-09-24T08:00:00.000Z");
      await service.toggleCompletion("new");
      const history = (await service.listStateEvents()).filter((event) => event.actionId === "new");
      expect(history.map((event) => [event.beforeStatus, event.afterStatus, event.scheduledFor]))
        .toEqual([
          [null, "open", "2026-09-21"],
          ["open", "open", "2026-09-22"],
          ["open", "completed", "2026-09-22"],
          ["completed", "open", "2026-09-22"],
          ["open", "open", "2026-09-25"],
          ["open", "completed", "2026-09-25"],
        ]);
      expect(evaluateActionDueOutcomes(history, "2026-09-25")).toEqual([
        { dueDate: "2026-09-22", onTime: true },
        { dueDate: "2026-09-25", onTime: true },
      ]);
      await expect(repo.updatePlan({ ...(await repo.findById("new"))!,
        scheduledFor: "2026-09-27", updatedAt: "2026-09-26T08:00:00.000Z",
      }, { reason: "other", note: "a".repeat(501) })).rejects.toThrow();
      expect((await service.listStateEvents()).filter((event) => event.actionId === "new"))
        .toHaveLength(history.length);
      expect((await repo.findById("old"))?.title).toBe("旧行动");
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("uses the same event semantics in the browser preview adapter", async () => {
    const executor = new MemorySqliteExecutor();
    let now = new Date("2026-09-20T08:00:00.000Z");
    const clock = { now: () => now };
    await new MigrationRunner(executor, migrations, clock).run();
    const service = new ActionService(new SqliteActionRepository(executor),
      new SqliteGoalRepository(executor), new SqliteLifeDomainRepository(executor),
      clock, { next: () => "preview" });
    const draft = { title: "预览行动", notes: "", domainId: null, goalId: null,
      scheduledFor: "2026-09-21" };
    await service.create(draft);
    await service.update("preview", { ...draft, notes: "只改备注" });
    now = new Date("2026-09-21T08:00:00.000Z");
    await service.toggleCompletion("preview");
    await service.toggleCompletion("preview");
    expect((await service.listStateEvents()).map((event) => event.afterStatus))
      .toEqual(["open", "completed", "open"]);
    expect(evaluateActionDueOutcomes(await service.listStateEvents(), "2026-09-21"))
      .toEqual([{ dueDate: "2026-09-21", onTime: false }]);
  });
});
