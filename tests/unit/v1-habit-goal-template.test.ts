import { SqliteTemplateRepository } from "../../src/repositories/sqlite/SqliteTemplateRepository";
import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { GoalEditorDialog } from "../../src/components/GoalEditorDialog";
import { TemplatesPage } from "../../src/pages/TemplatesPage";
import { builtInTemplates, cloneTemplateDefaults, validateTemplate } from "../../src/domain/templates/Template";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { backupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { TemplateService } from "../../src/services/templates/TemplateService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
import type { Habit } from "../../src/domain/habits/Habit";
import { GoalValidationError } from "../../src/domain/planning/Goal";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const clock = { now: () => new Date("2026-10-10T08:00:00Z") };
const preset = builtInTemplates.find((item) => item.id === "default-habit-goal")!;
const habit = { id: "walk", title: "散步", archived: false, startOn: "2026-09-28", weeklyTarget: 2 } as Habit;

it("applies a copied habit template, requires explicit links and retains settings after failure", async () => {
  const create = vi.fn().mockRejectedValueOnce(new GoalValidationError("请关联至少一个习惯。"))
    .mockRejectedValueOnce(new Error("保存失败，请重试。"))
    .mockResolvedValue({ id: "saved" });
  const onSaved = vi.fn();
  const find = vi.fn().mockResolvedValue({ ...preset, id: "custom-habit", builtIn: false });
  render(createElement(MemoryRouter, { initialEntries: ["/goals?template=custom-habit"] },
    createElement(LifeOSContext.Provider, { value: { lifeNavigationService: { list: vi.fn().mockResolvedValue([]) }, goalService: { create }, templateService: { find } } as unknown as LifeOSContextValue },
      createElement(GoalEditorDialog, { goals: [], domains: [], habits: [habit], onClose: vi.fn(), onSaved }))));
  await waitFor(() => expect(screen.getByLabelText("进度方式")).toHaveProperty("value", "habit"));
  expect(screen.getByText("进度设置", { selector: "summary" }).parentElement).toHaveProperty("open", true);
  expect(screen.queryByLabelText("统计开始")).toBeNull();
  fireEvent.change(screen.getByLabelText("目标名称"), { target: { value: "散步方向" } });
  fireEvent.click(screen.getByRole("button", { name: "创建目标" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "请关联至少一个习惯。");
  fireEvent.click(screen.getByRole("button", { name: "关联习惯" }));
  fireEvent.change(screen.getByLabelText("统计结束"), { target: { value: "2026-10-04" } });
  fireEvent.change(screen.getByLabelText("权重"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "创建目标" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "保存失败，请重试。");
  expect(screen.getByLabelText("权重")).toHaveProperty("value", "3");
  fireEvent.click(screen.getByRole("button", { name: "创建目标" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: "saved" }));
  expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ progressMode: "automatic",
    habitProgress: [{ habitId: "walk", startOn: "2026-09-28", endOn: "2026-10-04", weeklyTarget: 2, weight: 3 }] }), []);
});

it("copies and switches Chinese template algorithms without modifying the preset", async () => {
  const save = vi.fn().mockResolvedValue({ id: "copy" });
  render(createElement(MemoryRouter, null, createElement(LifeOSContext.Provider,
    { value: { templateService: { list: vi.fn().mockResolvedValue([preset]),
      getDefaultTemplate: vi.fn().mockResolvedValue(null), save } } as unknown as LifeOSContextValue },
    createElement(TemplatesPage))));
  await screen.findByRole("combobox", { name: "新建目标" });
  const copy = await screen.findByRole("button", { name: "复制习惯型目标" });
  await waitFor(() => expect(copy.matches(":disabled")).toBe(false));
  fireEvent.click(copy);
  const editor = await screen.findByRole("region", { name: "编辑模板" });
  fireEvent.click(within(editor).getByText("进度设置", { selector: "summary" }));
  expect(within(editor).getByLabelText("进度方式")).toHaveProperty("value", "habit");
  fireEvent.change(within(editor).getByLabelText("进度方式"), { target: { value: "exploration" } });
  fireEvent.click(within(editor).getByRole("checkbox", { name: "显示进度百分比" }));
  fireEvent.change(within(editor).getByLabelText("进度方式"), { target: { value: "habit" } });
  fireEvent.click(within(editor).getByRole("button", { name: "保存模板" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("goal", "习惯型目标（副本）",
    expect.objectContaining({ progressAlgorithm: "habit", progressMode: "automatic" }), undefined));
  expect(preset.defaults.progressMode).toBeUndefined();
});

it("validates goal-only default algorithms without binding habits or changing legacy templates", () => {
  expect(preset.defaults.progressAlgorithm).toBe("habit");
  expect(validateTemplate("goal", "旧模板", { description: "旧说明" }).defaults).toEqual({ description: "旧说明" });
  expect(validateTemplate("goal", "习惯", cloneTemplateDefaults(preset.defaults)).defaults).toEqual(preset.defaults);
  expect(() => validateTemplate("goal", "无效", { progressAlgorithm: "invalid" })).toThrow("默认计算方式");
  expect(() => validateTemplate("review", "无效", { progressAlgorithm: "habit" })).toThrow("字段");
  expect(() => validateTemplate("goal", "无效", { progressAlgorithm: "habit", progressMode: "exploration" })).toThrow("不能同时");
  expect(() => validateTemplate("goal", "无效", { habitProgress: [{ habitId: "walk" }] })).toThrow("字段");
});

it("roundtrips copied algorithms in SQLite and the existing backup format", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const sql = nativeSqliteExecutor(db);
    await new MigrationRunner(sql, migrations, clock).run();
    const service = new TemplateService(new SqliteTemplateRepository(sql), clock, { next: () => "habit-copy" });
    const copy = await service.save("goal", "我的习惯模板", cloneTemplateDefaults(preset.defaults));
    expect((await new TemplateService(new SqliteTemplateRepository(sql), clock, { next: () => "unused" }).find(copy.id))?.defaults).toEqual(preset.defaults);
    const backup = { format: "lifeos-backup", schemaVersion: 28, appVersion: "0.1.0", exportedAt: clock.now().toISOString(),
      data: Object.fromEntries(backupTables.slice(0, 34).map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()])) };
    expect(inspectBackup(backup).counts.templates).toBe(1);
    const rows = JSON.parse(JSON.stringify(backup.data.templates)) as { defaults_json: string }[];
    expect(JSON.parse(rows[0].defaults_json).progressAlgorithm).toBe("habit");
    await service.save("goal", "我的习惯模板", { ...copy.defaults, progressAlgorithm: "automatic", progressMode: "exploration" }, copy.id);
    expect((await service.find(copy.id))?.version).toBe(2);
    expect((await service.find("default-habit-goal"))?.defaults).toEqual(preset.defaults);
  } finally { db.close(); }
});
