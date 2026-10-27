import { SqliteTemplateRepository } from "../../src/repositories/sqlite/SqliteTemplateRepository";
import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { GoalEditorDialog } from "../../src/components/GoalEditorDialog";
import { TemplatesPage } from "../../src/pages/TemplatesPage";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { calculateGoalProgress } from "../../src/domain/progress/GoalProgress";
import { normalizeGoalDraft } from "../../src/domain/planning/Goal";
import type { Goal } from "../../src/domain/planning/Goal";
import type { Action } from "../../src/domain/planning/Action";
import { builtInTemplates, validateTemplate } from "../../src/domain/templates/Template";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteGoalProgressItemRepository } from "../../src/repositories/sqlite/SqliteGoalProgressItemRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { GoalService } from "../../src/services/planning/GoalService";
import { GoalProgressItemService } from "../../src/services/planning/GoalProgressItemService";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { TemplateService } from "../../src/services/templates/TemplateService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const clock = { now: () => new Date("2026-10-09T08:00:00Z") };
const draft = { title: "探索新的方向", description: "", domainId: null,
  status: "active" as const, targetDate: null };
const item = { kind: "exploration" as const, title: "小尝试", targetValue: 10, currentValue: 3, weight: 2 };

describe("V1 exploration progress", () => {
  it("hides action-based progress and never treats missing exploration facts as zero", () => {
    const goal: Goal = { ...draft, id: "goal", parentId: null, domainIds: [], sortOrder: 0,
      completedAt: null, createdAt: "", updatedAt: "", progressMode: "exploration" };
    const action: Action = { id: "action", title: "小尝试", notes: "", goalId: goal.id,
      domainId: null, domainIds: [], status: "completed", scheduledFor: null,
      sortOrder: 0, completedAt: clock.now().toISOString(), createdAt: "", updatedAt: "" };
    expect(calculateGoalProgress([goal], [action]).get(goal.id)?.percent).toBeNull();
    const shown = { ...goal, progressMode: "exploration_percent" as const };
    expect(calculateGoalProgress([shown], [action]).get(goal.id)?.percent).toBe(100);
    expect(calculateGoalProgress([shown], []).get(goal.id)?.percent).toBeNull();
  });

  for (const mode of ["SQLite", "preview"] as const) {
    it(`${mode} preserves facts when switching modes and keeps old-call edits compatible`, async () => {
      const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
      db?.exec("PRAGMA foreign_keys = ON");
      const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
      try {
        await new MigrationRunner(sql, migrations, clock).run();
        let seq = 0;
        const ids = { next: () => `explore-${++seq}` };
        const repo = new SqliteGoalRepository(sql);
        const goals = new GoalService(repo, new SqliteLifeDomainRepository(sql), clock, ids);
        const progress = new GoalProgressItemService(new SqliteGoalProgressItemRepository(sql), repo, clock, ids);
        const history = new VersionHistoryService(new SqliteObjectVersionRepository(sql));
        const goal = await goals.create({ ...draft, progressMode: "exploration" }, [item]);
        expect((await goals.findById(goal.id))?.progressMode).toBe("exploration");
        const facts = await progress.list();
        expect(calculateGoalProgress([goal], [], facts).get(goal.id)?.percent).toBeNull();
        const shown = await goals.update(goal.id, { ...goal, progressMode: "exploration_percent" });
        expect(calculateGoalProgress([shown], [], facts).get(goal.id)?.percent).toBe(30);
        expect((await history.list("goal", goal.id))[0].snapshot.progress_mode).toBe("exploration");
        const edited = await goals.update(goal.id, { ...draft, title: "只改名称" });
        expect(edited.progressMode).toBe("exploration_percent");
        await progress.replace(goal.id, [{ ...item, currentValue: 4 }]);
        expect((await history.list("goal", goal.id))[0].snapshot.progress_mode).toBe("exploration_percent");
        const hidden = await goals.update(goal.id, { ...edited, progressMode: "exploration", status: "completed" });
        expect(hidden.completedAt).not.toBeNull();
        expect(calculateGoalProgress([hidden], [], await progress.list()).get(goal.id)?.percent).toBeNull();
        const parent = await goals.create(draft);
        const child = await goals.update(goal.id, { ...hidden, parentId: parent.id });
        expect(calculateGoalProgress([parent, child], []).get(parent.id)?.percent).toBeNull();
        expect((await progress.list())[0].currentValue).toBe(4);
        await expect(goals.create({ ...draft, progressMode: "invalid" as never })).rejects.toThrow("进度方式");
      } finally { db?.close(); }
    });
  }

  it("migrates V26 without modifying facts and validates V27 while accepting V26 backups", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, 26), clock).run();
      db.exec(`INSERT INTO goals (id, title, status, sort_order, created_at, updated_at)
        VALUES ('old', '已有目标', 'active', 0, '2026-10-08', '2026-10-08');
        INSERT INTO goal_progress_items VALUES ('item', 'old', 'exploration', '已有节点', 10, 3, 2, 0, '2026-10-08', '2026-10-08')`);
      const old = db.prepare("SELECT * FROM goals").get();
      const facts = db.prepare("SELECT * FROM goal_progress_items").all();
      const versions = db.prepare("SELECT * FROM object_versions").all();
      await new MigrationRunner(sql, migrations, clock).run();
      expect(db.prepare("SELECT * FROM goals").get()).toEqual({ ...old, progress_mode: "automatic", progress_weight: 1, priority: "medium", horizon: null, direction_id: null });
      expect(db.prepare("SELECT * FROM goal_progress_items").all()).toEqual(facts);
      expect(db.prepare("SELECT * FROM object_versions").all()).toEqual(versions);
      expect(() => db.exec("UPDATE goals SET progress_mode = 'invalid' WHERE id = 'old'")).toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      const backup = { format: "lifeos-backup", schemaVersion: 27, appVersion: "0.1.0", exportedAt: clock.now().toISOString(),
        data: Object.fromEntries(backupTables.slice(0, 33).map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()])) };
      expect(inspectBackup(backup).counts.goals).toBe(1);
      const bad = structuredClone(backup);
      bad.data.goals[0].progress_mode = "invalid";
      expect(() => inspectBackup(bad)).toThrow("进度方式");
      const legacy = structuredClone(backup);
      legacy.schemaVersion = 26;
      delete legacy.data.goals[0].progress_mode;
      expect(inspectBackup(legacy).counts.goals).toBe(1);
    } finally { db.close(); }
  });

  it("validates goal-only template modes and preserves defaults for old templates", () => {
    expect(validateTemplate("goal", "探索", { progressMode: "exploration" }).defaults.progressMode).toBe("exploration");
    expect(() => validateTemplate("goal", "无效", { progressMode: "invalid" })).toThrow("进度方式");
    expect(() => validateTemplate("review", "无效", { progressMode: "exploration" })).toThrow("字段");
    expect(normalizeGoalDraft(draft).progressMode).toBe("automatic");
    expect(builtInTemplates.find((template) => template.id === "default-exploration")?.defaults.progressMode).toBe("exploration");
  });

  it("applies the exploration template and submits the Chinese percentage toggle", async () => {
    const create = vi.fn().mockResolvedValue({ ...draft, id: "goal" });
    const preset = builtInTemplates.find((template) => template.id === "default-exploration")!;
    const find = vi.fn().mockResolvedValue(preset);
    render(createElement(MemoryRouter, { initialEntries: ["/goals?template=default-exploration"] },
      createElement(LifeOSContext.Provider, { value: { lifeNavigationService: { list: vi.fn().mockResolvedValue([]) }, goalService: { create }, templateService: { find } } as unknown as LifeOSContextValue },
        createElement(GoalEditorDialog, { goals: [], domains: [], onClose: vi.fn(), onSaved: vi.fn() }))));
    await waitFor(() => expect(screen.getByLabelText("进度方式")).toHaveProperty("value", "exploration"));
    fireEvent.click(screen.getByText("进度设置", { selector: "summary" }));
    const toggle = screen.getByRole("checkbox", { name: "显示进度百分比" });
    expect(toggle).toHaveProperty("checked", false);
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText("目标名称"), { target: { value: draft.title } });
    fireEvent.click(screen.getByRole("button", { name: "创建目标" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ progressMode: "exploration_percent" }), []));
  });

  it("copies template progress settings without rewriting the built-in or existing goals", async () => {
    const sql = new MemorySqliteExecutor();
    await new MigrationRunner(sql, migrations, clock).run();
    const templates = new TemplateService(new SqliteTemplateRepository(sql), clock, { next: () => "copy" });
    const repo = new SqliteGoalRepository(sql);
    const goals = new GoalService(repo, new SqliteLifeDomainRepository(sql), clock, { next: () => "existing" });
    const existing = await goals.create({ ...draft, progressMode: "exploration" });
    render(createElement(MemoryRouter, null, createElement(LifeOSContext.Provider,
      { value: { templateService: templates } as LifeOSContextValue }, createElement(TemplatesPage))));
    const copy = await screen.findByRole("button", { name: "复制探索型目标" });
    await screen.findByRole("combobox", { name: "新建目标" });
    await waitFor(() => expect(copy.matches(":disabled")).toBe(false));
    fireEvent.click(copy);
    fireEvent.click(screen.getByText("进度设置", { selector: "summary" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "显示进度百分比" }));
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));
    await screen.findByText("探索型目标（副本）", { selector: "strong" });
    expect((await templates.find("copy"))?.defaults.progressMode).toBe("exploration_percent");
    expect((await templates.find("default-exploration"))?.defaults.progressMode).toBe("exploration");
    expect(await goals.findById(existing.id)).toEqual(existing);
  });
});
