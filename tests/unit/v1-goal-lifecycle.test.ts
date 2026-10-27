import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { GoalEditorDialog } from "../../src/components/GoalEditorDialog";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { buildAnalytics } from "../../src/domain/analytics/Analytics";
import { goalStatuses } from "../../src/domain/planning/Goal";
import { calculateGoalProgress } from "../../src/domain/progress/GoalProgress";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteGoalProgressItemRepository } from "../../src/repositories/sqlite/SqliteGoalProgressItemRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { GoalService } from "../../src/services/planning/GoalService";
import { GoalProgressItemService } from "../../src/services/planning/GoalProgressItemService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(cleanup);
const clock = { now: () => new Date("2026-10-08T08:00:00Z") };
const draft = { title: "学习方向", description: "", domainId: null,
  status: "active" as const, targetDate: null };

describe("V1 goal lifecycle", () => {
  for (const mode of ["SQLite", "preview"] as const) {
    it(`${mode} preserves reasons, versions, completion facts and rejects invalid transitions`, async () => {
      const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
      db?.exec("PRAGMA foreign_keys = ON");
      const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
      try {
        await new MigrationRunner(sql, migrations, clock).run();
        let seq = 0;
        const ids = { next: () => `lifecycle-${++seq}` };
        const repo = new SqliteGoalRepository(sql);
        const service = new GoalService(repo, new SqliteLifeDomainRepository(sql), clock, ids);
        const history = new VersionHistoryService(new SqliteObjectVersionRepository(sql));
        const items = new GoalProgressItemService(new SqliteGoalProgressItemRepository(sql), repo, clock, ids);
        for (const status of ["paused", "abandoned"] as const) {
          await expect(service.create({ ...draft, status })).rejects.toThrow("原因");
        }
        const initial = await service.create({ ...draft, status: "candidate" });
        expect((await service.findById(initial.id))?.status).toBe("candidate");
        const active = await service.update(initial.id, { ...initial, status: "active" });
        await expect(service.update(active.id, { ...active, status: "paused" })).rejects.toThrow("原因");
        expect(await history.list("goal", active.id)).toHaveLength(1);
        const paused = await service.update(active.id, { ...active, status: "paused", statusReason: "  留出休息时间  " });
        expect(paused.statusReason).toBe("留出休息时间");
        await expect(service.update(paused.id, { ...paused, statusReason: "" })).rejects.toThrow("原因");
        await items.replace(paused.id, [{ kind: "milestone", title: "第一阶段", targetValue: 10, currentValue: 3, weight: 1 }]);
        expect((await history.list("goal", paused.id))[0].snapshot).toMatchObject({ status: "paused", status_reason: "留出休息时间" });
        const abandoned = await service.update(paused.id, { ...paused, status: "abandoned", statusReason: "换一个方向" });
        expect((await service.findById(paused.id))?.status).toBe("abandoned");
        const archived = await service.update(paused.id, { ...abandoned, status: "archived" });
        expect(archived.archivedAt).toBe(clock.now().toISOString());
        expect(archived.completedAt).toBeNull();
        expect(calculateGoalProgress([archived], [], await items.list()).get(archived.id)?.percent).toBe(30);
        const completed = await service.update(paused.id, { ...archived, status: "completed" });
        const archivedComplete = await service.update(paused.id, { ...completed, status: "archived" });
        expect(archivedComplete.completedAt).toBe(completed.completedAt);
        expect(calculateGoalProgress([archivedComplete], []).get(paused.id)?.percent).toBe(100);
        const analytics = buildAnalytics({ goals: [archivedComplete], actions: [], reviews: [], issues: [],
          planChanges: [], completionPlans: [], stateEvents: [] },
        { weeks: 4, domainId: null, goalId: null }, clock.now());
        expect(analytics.weeks.flatMap((week) => week.goalsCompleted)).toHaveLength(1);
        const restored = await service.update(paused.id, { ...archivedComplete, status: "active" });
        expect(restored.completedAt).toBeNull();
        expect(restored.archivedAt).toBeNull();
        expect(restored.statusReason).toBeNull();
        expect((await history.list("goal", paused.id))[0].snapshot).toMatchObject({ status: "archived", completed_at: completed.completedAt });
        await expect(service.update(paused.id, { ...restored, status: "paused", statusReason: "x".repeat(601) })).rejects.toThrow("600");
      } finally { db?.close(); }
    });
  }

  it("migrates without changing old facts or breaking ownership and allows legacy paused edits", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, 25), clock).run();
      db.exec(`INSERT INTO goals (id, title, status, sort_order, created_at, updated_at)
        VALUES ('old', '原有暂停目标', 'paused', 0, '2026-10-01', '2026-10-01');
        INSERT INTO actions (id, title, goal_id, status, sort_order, created_at, updated_at)
        VALUES ('action', '保留行动', 'old', 'open', 0, '2026-10-01', '2026-10-01');
        INSERT INTO goal_progress_items VALUES ('item', 'old', 'milestone', '保留进度', 10, 3, 1, 0, '2026-10-01', '2026-10-01')`);
      const old = db.prepare("SELECT * FROM goals").get();
      const actions = db.prepare("SELECT * FROM actions").all();
      const items = db.prepare("SELECT * FROM goal_progress_items").all();
      const history = db.prepare("SELECT * FROM object_versions").all();
      await new MigrationRunner(sql, migrations, clock).run();
      expect(db.prepare("SELECT * FROM goals").get()).toEqual({ ...old, lifecycle_status: null, status_reason: null, archived_at: null, progress_mode: "automatic", progress_weight: 1, priority: "medium", horizon: null, direction_id: null });
      expect(db.prepare("SELECT * FROM actions").all()).toEqual(actions.map((row) => ({ ...row, progress_weight: 1, details_json: "{}" })));
      expect(db.prepare("SELECT * FROM goal_progress_items").all()).toEqual(items);
      expect(db.prepare("SELECT * FROM object_versions").all()).toEqual(history);
      const service = new GoalService(new SqliteGoalRepository(sql), new SqliteLifeDomainRepository(sql), clock, { next: () => "new" });
      const existing = (await service.findById("old"))!;
      await service.update("old", { ...existing, title: "只改名称" });
      await expect(service.update("old", { ...existing, status: "abandoned" })).rejects.toThrow("原因");
      const before = db.prepare("SELECT * FROM goals").get();
      expect(() => db.exec("UPDATE goals SET lifecycle_status = 'abandoned' WHERE id = 'old'")).toThrow();
      expect(db.prepare("SELECT * FROM goals").get()).toEqual(before);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      const backup = { format: "lifeos-backup", schemaVersion: 26, appVersion: "0.1.0", exportedAt: clock.now().toISOString(),
        data: Object.fromEntries(backupTables.slice(0, 33).map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()])) };
      expect(inspectBackup(backup).counts.goals).toBe(1);
      const invalid = structuredClone(backup);
      invalid.data.goals[0].lifecycle_status = "abandoned";
      expect(() => inspectBackup(invalid)).toThrow("生命周期");
      const v25 = structuredClone(backup);
      v25.schemaVersion = 25;
      for (const row of v25.data.goals) {
        delete row.lifecycle_status; delete row.status_reason; delete row.archived_at;
      }
      expect(inspectBackup(v25).counts.goals).toBe(1);
    } finally { db.close(); }
  });

  it("offers six Chinese states and submits the pause reason", async () => {
    const create = vi.fn().mockResolvedValue({ id: "goal", ...draft, status: "paused", statusReason: "调整节奏" });
    const saved = vi.fn();
    const context = { lifeNavigationService: { list: vi.fn().mockResolvedValue([]) }, goalService: { create }, templateService: {} } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, null, createElement(LifeOSContext.Provider, { value: context },
      createElement(GoalEditorDialog, { goals: [], domains: [], onClose: vi.fn(), onSaved: saved }))));
    await waitFor(() => expect(screen.getByRole("button", { name: "创建目标" })).toHaveProperty("disabled", false));
    const status = screen.getByLabelText("当前状态");
    expect(status.querySelectorAll("option")).toHaveLength(goalStatuses.length);
    fireEvent.change(screen.getByLabelText("目标名称"), { target: { value: "调整方向" } });
    fireEvent.change(status, { target: { value: "paused" } });
    expect(screen.getByLabelText("暂停原因").hasAttribute("required")).toBe(true);
    fireEvent.change(screen.getByLabelText("暂停原因"), { target: { value: "调整节奏" } });
    fireEvent.click(screen.getByRole("button", { name: "创建目标" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ status: "paused", statusReason: "调整节奏" }), []);
    expect(saved).toHaveBeenCalled();
  });
});
