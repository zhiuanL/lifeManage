import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { GoalDetailPage } from "../../src/pages/GoalDetailPage";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { GoalService } from "../../src/services/planning/GoalService";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import type { Goal } from "../../src/domain/planning/Goal";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(cleanup);
const clock = { now: () => new Date("2026-10-12T08:00:00Z") };
const goal: Goal = { id: "root", title: "年度方向", description: "留出学习时间", domainId: null,
  domainIds: [], parentId: null, status: "active", targetDate: null, sortOrder: 0, priority: "high",
  relations: [{ targetGoalId: "child", type: "support" }],
  completedAt: null, createdAt: "2026-10-12", updatedAt: "2026-10-12" };
const child: Goal = { ...goal, id: "child", title: "季度重点", parentId: "root", relations: [] };
function page(path = "/goals/root", overrides = {}) {
  const value = { lifeNavigationService: { list: vi.fn().mockResolvedValue([]) }, goalService: { list: vi.fn().mockResolvedValue([goal, child]),
    updateSection: vi.fn().mockImplementation(async (_id, _section, draft) => ({ ...goal, ...draft })) },
    actionService: { list: vi.fn().mockResolvedValue([]) },
    lifeDomainService: { list: vi.fn().mockResolvedValue([]) },
    goalProgressItemService: { list: vi.fn().mockResolvedValue([]), replace: vi.fn().mockResolvedValue(undefined) },
    habitService: { list: vi.fn().mockResolvedValue([]), listLogs: vi.fn().mockResolvedValue([]) },
    ...overrides } as unknown as LifeOSContextValue;
  render(createElement(MemoryRouter, { initialEntries: [path] },
    createElement(LifeOSContext.Provider, { value }, createElement(Routes, null,
      createElement(Route, { path: "/goals/:goalId", element: createElement(GoalDetailPage) })))));
  return value;
}

describe("V1 goal full detail and section editing", () => {
  it("reads by ID with no form, and links children, relations and history", async () => {
    page();
    await screen.findByRole("heading", { name: goal.title });
    expect(document.querySelector("form, input, textarea, select")).toBeNull();
    expect(screen.getByText("高")).toBeTruthy();
    expect(screen.getByText("当前进度 暂无可用进度")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: child.title }).every((link) =>
      link.getAttribute("href") === "/goals/child")).toBe(true);
    expect(screen.getByRole("link", { name: "版本历史" }).getAttribute("href")).toBe("/history?type=goal&id=root");
  });
  it("edits one block, retries without losing draft and returns to reading", async () => {
    const value = page();
    vi.mocked(value.goalService.updateSection).mockRejectedValueOnce(new Error("保存失败，请重试"));
    const trigger = await screen.findByRole("button", { name: "编辑基本信息" });
    fireEvent.click(trigger);
    const form = screen.getByRole("form", { name: "编辑基本信息" });
    expect(document.querySelectorAll("form")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "编辑状态" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(within(form).getByLabelText("目标名称"), { target: { value: "新的年度方向" } });
    fireEvent.submit(form);
    expect((await screen.findByRole("alert")).textContent).toContain("保存失败");
    expect((within(form).getByLabelText("目标名称") as HTMLInputElement).value).toBe("新的年度方向");
    fireEvent.submit(form);
    await screen.findByRole("heading", { name: "新的年度方向" });
    expect(document.querySelector("form")).toBeNull();
    expect(value.goalService.updateSection).toHaveBeenLastCalledWith("root", "basics", expect.objectContaining({ title: "新的年度方向" }));
    expect(document.activeElement).toBe(trigger);
  });
  it("cancels on Escape, excludes self and descendants from parent choices", async () => {
    const value = page();
    fireEvent.click(await screen.findByRole("button", { name: "编辑领域与层级" }));
    expect(screen.getByLabelText("上级目标").querySelectorAll("option")).toHaveLength(1);
    fireEvent.keyDown(screen.getByLabelText("上级目标"), { key: "Escape" });
    expect(document.querySelector("form")).toBeNull();
    expect(value.goalService.updateSection).not.toHaveBeenCalled();
  });
  it("saves progress items inline and restores computed progress", async () => {
    const value = page();
    vi.mocked(value.goalProgressItemService.replace).mockResolvedValue([{
      id: "item", goalId: "root", kind: "key_result", title: "阅读章节", currentValue: 2, targetValue: 4,
      weight: 1, sortOrder: 0, createdAt: "2026-10-12", updatedAt: "2026-10-12",
    }]);
    fireEvent.click(await screen.findByRole("button", { name: "编辑进度项" }));
    fireEvent.click(screen.getByRole("button", { name: "添加进度项" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "阅读章节" } });
    fireEvent.change(screen.getByLabelText("当前值"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("目标值"), { target: { value: "4" } });
    fireEvent.submit(screen.getByRole("form", { name: "编辑进度项" }));
    await screen.findByText("当前进度 50%");
    expect(document.querySelector("form")).toBeNull();
    expect(value.goalProgressItemService.replace).toHaveBeenCalledWith("root", expect.arrayContaining([expect.objectContaining({ title: "阅读章节", currentValue: 2 })]));
    expect(value.goalProgressItemService.list).toHaveBeenCalledTimes(1);
  });
  it("navigates directly to a related goal without mutating either object", async () => {
    const value = page();
    await screen.findByRole("heading", { name: goal.title });
    fireEvent.click(screen.getAllByRole("link", { name: child.title })[0]);
    await screen.findByRole("heading", { name: child.title });
    expect(document.querySelector("form")).toBeNull();
    expect(value.goalService.updateSection).not.toHaveBeenCalled();
  });
  it("handles missing goals and read errors without modifying records", async () => {
    page("/goals/missing");
    await screen.findByRole("heading", { name: "目标已不存在" });
    cleanup();
    page("/goals/root", { goalService: { list: vi.fn().mockRejectedValue(new Error("读取失败")) } });
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });
});

 it("SQLite section save preserves newer unrelated facts and records prior history", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const sql = nativeSqliteExecutor(db);
  try {
    await new MigrationRunner(sql, migrations, clock).run();
    let sequence = 0;
    const service = new GoalService(new SqliteGoalRepository(sql), new SqliteLifeDomainRepository(sql),
      clock, { next: () => "section-" + ++sequence });
    const draft = { title: "原名称", description: "原说明", domainId: null, status: "active" as const, targetDate: null };
    const target = await service.create(draft);
    const original = await service.create({ ...draft, relations: [{ targetGoalId: target.id, type: "support" }] });
    await service.update(original.id, { ...original, status: "paused", statusReason: "等待资源", priority: "low" });
    const saved = await service.updateSection(original.id, "basics", { ...original, title: "新名称", priority: "high" });
    expect(saved.status).toBe("paused"); expect(saved.statusReason).toBe("等待资源");
    expect(saved.relations).toHaveLength(1); expect(saved.priority).toBe("high");
    const history = await new VersionHistoryService(new SqliteObjectVersionRepository(sql)).list("goal", original.id);
    expect(history).toHaveLength(2);
    expect(history.some((entry) => entry.snapshot.status_reason === "等待资源")).toBe(true);
    await expect(service.updateSection(original.id, "lifecycle", { ...saved, status: "abandoned", statusReason: "" })).rejects.toThrow("原因");
    expect(await service.findById(original.id)).toEqual(saved);
  } finally { db.close(); }
});
