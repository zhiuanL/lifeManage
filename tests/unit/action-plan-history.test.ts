import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { ActionEditorDialog } from "../../src/components/ActionEditorDialog";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { m5ActionPlansMigration } from "../../src/db/migrations/0009-m5-action-plans";
import { m5ActionCompletionsMigration } from "../../src/db/migrations/0010-m5-action-completions";
import type { Action } from "../../src/domain/planning/Action";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteActionRepository } from "../../src/repositories/sqlite/SqliteActionRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { ActionService } from "../../src/services/planning/ActionService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(cleanup);

const draft = {
  title: "散步", notes: "", domainId: null, goalId: null, scheduledFor: "2026-09-22",
};

function insertAction(db: DatabaseSync, id: string, date: string) {
  db.prepare(`INSERT INTO actions (id, title, notes, domain_id, goal_id, status,
    scheduled_for, sort_order, completed_at, created_at, updated_at)
    VALUES (?, '散步', '', NULL, NULL, 'open', ?, 0, NULL, ?, ?)`)
    .run(id, date, "2026-09-21T08:00:00.000Z", "2026-09-21T08:00:00.000Z");
}

describe("M5 action plan history", () => {
  it("does not invent a baseline for pre-migration actions and writes changes atomically in SQLite", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      for (const migration of migrations.slice(0, migrations.indexOf(m5ActionPlansMigration))) {
        for (const statement of migration.statements) db.exec(statement);
      }
      insertAction(db, "old", "2026-09-22");
      db.prepare("UPDATE actions SET status = 'completed', completed_at = ? WHERE id = 'old'")
        .run("2026-09-21T10:00:00.000Z");
      for (const statement of m5ActionPlansMigration.statements) db.exec(statement);
      insertAction(db, "between", "2026-09-23");
      db.prepare("UPDATE actions SET status = 'completed', completed_at = ? WHERE id = 'between'")
        .run("2026-09-21T12:00:00.000Z");
      for (const statement of m5ActionCompletionsMigration.statements) db.exec(statement);
      expect(db.prepare("SELECT * FROM action_plan_changes WHERE action_id = 'old'").all())
        .toEqual([]);
      expect(db.prepare("SELECT * FROM action_completion_plans WHERE action_id = 'old'").all())
        .toEqual([]);
      expect(db.prepare("SELECT * FROM action_completion_plans WHERE action_id = 'between'").all())
        .toEqual([]);
      expect(db.prepare("SELECT scheduled_for FROM actions WHERE id = 'old'").get())
        .toEqual({ scheduled_for: "2026-09-22" });

      insertAction(db, "new", "2026-09-23");
      for (const migration of migrations.slice(migrations.indexOf(m5ActionCompletionsMigration) + 1)) {
        for (const statement of migration.statements) db.exec(statement);
      }
      const executor = nativeSqliteExecutor(db);
      const repository = new SqliteActionRepository(executor);
      const original = (await repository.findById("new"))!;
      expect((await repository.listPlanChanges()).filter((change) => change.actionId === "new"))
        .toEqual([expect.objectContaining({
          actionId: "new", beforeDate: null, afterDate: "2026-09-23", reason: "initial",
        })]);
      await expect(repository.updatePlan({ ...original, scheduledFor: "2026-09-25" },
        { reason: "other" as const, note: "a".repeat(501) })).rejects.toThrow();
      expect((await repository.findById("new"))?.scheduledFor).toBe("2026-09-23");
      expect(await repository.listPlanChanges()).toHaveLength(2);

      await repository.updatePlan({
        ...original, scheduledFor: "2026-09-25", updatedAt: "2026-09-22T08:00:00.000Z",
      }, { reason: "external", note: "  会议延期  " });
      expect((await repository.findById("new"))?.scheduledFor).toBe("2026-09-25");
      expect((await repository.listPlanChanges()).find((change) => change.afterDate === "2026-09-25"))
        .toMatchObject({
        beforeDate: "2026-09-23", afterDate: "2026-09-25", reason: "external",
        note: "  会议延期  ",
      });
      const completed = {
        ...original, status: "completed" as const,
        scheduledFor: "2026-09-25", completedAt: "2026-09-22T08:00:00.000Z",
        updatedAt: "2026-09-22T08:00:00.000Z",
      };
      await repository.update(completed);
      expect(await repository.listCompletionPlans()).toEqual([{
        actionId: "new", completedAt: completed.completedAt, plannedDate: "2026-09-25",
      }]);
      await repository.updatePlan({
        ...completed, scheduledFor: "2026-09-27",
      }, { reason: "personal", note: "" });
      expect((await repository.listCompletionPlans())[0].plannedDate).toBe("2026-09-25");
      await repository.update({ ...completed, status: "open", completedAt: null,
        scheduledFor: "2026-09-27" });
      await repository.updatePlan({
        ...completed, scheduledFor: "2026-09-29",
      }, { reason: "conflict", note: "" });
      expect(await repository.listCompletionPlans()).toEqual([{
        actionId: "new", completedAt: completed.completedAt, plannedDate: "2026-09-29",
      }]);
      await expect(repository.update({
        ...completed, scheduledFor: "2026-09-30",
      })).rejects.toThrow("Schedule change requires a reason");
      expect((await repository.findById("new"))?.scheduledFor).toBe("2026-09-29");
      expect((await repository.listPlanChanges())
        .filter((change) => change.actionId === "new").map((change) => change.afterDate))
        .toEqual(["2026-09-23", "2026-09-25", "2026-09-27", "2026-09-29"]);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("requires an explicit reason only when the schedule changes; completion does not create a plan event", async () => {
    const executor = new MemorySqliteExecutor();
    let now = new Date("2026-09-21T08:00:00.000Z");
    const clock = { now: () => now };
    await new MigrationRunner(executor, migrations, clock).run();
    const service = new ActionService(
      new SqliteActionRepository(executor), new SqliteGoalRepository(executor),
      new SqliteLifeDomainRepository(executor), clock, { next: () => "action" },
    );
    const action = await service.create(draft);
    expect(await service.listPlanChanges()).toHaveLength(1);
    now = new Date("2026-09-22T08:00:00.000Z");
    await service.update(action.id, { ...draft, notes: "慢慢来" });
    await expect(service.update(action.id, { ...draft, scheduledFor: "2026-09-24" }))
      .rejects.toThrow("原因");
    expect((await service.findById(action.id))?.scheduledFor).toBe(draft.scheduledFor);
    await service.update(action.id, { ...draft, scheduledFor: "2026-09-24" },
      { reason: "personal", note: "  调整节奏  " });
    expect((await service.listPlanChanges())[1]).toMatchObject({
      beforeDate: draft.scheduledFor, afterDate: "2026-09-24",
      reason: "personal", note: "调整节奏",
    });
    now = new Date("2026-09-23T08:00:00.000Z");
    await service.toggleCompletion(action.id);
    expect(await service.listPlanChanges()).toHaveLength(2);
    expect(await service.listCompletionPlans()).toEqual([{
      actionId: action.id, completedAt: now.toISOString(), plannedDate: "2026-09-24",
    }]);
    await service.update(action.id, { ...draft, scheduledFor: "2026-09-27" },
      { reason: "external", note: "" });
    expect((await service.listCompletionPlans())[0].plannedDate).toBe("2026-09-24");
    await service.toggleCompletion(action.id);
    await service.toggleCompletion(action.id);
    expect((await service.listCompletionPlans())[0].plannedDate).toBe("2026-09-27");
  });

  it("shows a reason input only when editing the date and sends it with the action", async () => {
    const action: Action = {
      id: "action", ...draft, status: "open", sortOrder: 0,
      createdAt: "2026-09-21T08:00:00Z", updatedAt: "2026-09-21T08:00:00Z",
      completedAt: null,
    };
    const update = vi.fn().mockResolvedValue(action);
    const value = { actionService: { update } } as unknown as LifeOSContextValue;
    render(createElement(LifeOSContext.Provider, { value },
      createElement(ActionEditorDialog, {
        action, goals: [], domains: [], onClose: vi.fn(), onSaved: vi.fn(),
      })));
    expect(screen.queryByText("调整原因")).toBeNull();
    fireEvent.change(screen.getByLabelText("安排日期"), { target: { value: "2026-09-25" } });
    fireEvent.change(screen.getByLabelText("调整原因"), { target: { value: "conflict" } });
    fireEvent.change(screen.getByLabelText("补充说明（可选）"),
      { target: { value: "与工作时间冲突" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(
      "action", expect.objectContaining({ scheduledFor: "2026-09-25" }),
      { reason: "conflict", note: "与工作时间冲突" },
    ));
  });
});
