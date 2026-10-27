import { SqliteTemplateRepository } from "../../src/repositories/sqlite/SqliteTemplateRepository";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { localDate } from "../../src/domain/habits/Habit";
import { HabitsPage } from "../../src/pages/HabitsPage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteHabitRepository } from "../../src/repositories/sqlite/SqliteHabitRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { HabitService } from "../../src/services/habits/HabitService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { TemplateService } from "../../src/services/templates/TemplateService";

afterEach(cleanup);
let next = 0;
const ids = { next: () => `ui-habit-${++next}` };
const clock = { now: () => new Date() };

async function show(path = "/habits") {
  const sql = new MemorySqliteExecutor();
  await new MigrationRunner(sql, migrations, clock).run();
  const repo = new SqliteLifeDomainRepository(sql);
  const life = new LifeDomainService(repo, clock, ids);
  const health = await life.create({ name: "健康", description: "", focus: "", color: "fern", icon: "heart" });
  const habits = new HabitService(new SqliteHabitRepository(sql), repo, clock, ids);
  const value = { habitService: habits, lifeDomainService: life,
    templateService: new TemplateService(new SqliteTemplateRepository(sql), clock, ids) } as LifeOSContextValue;
  render(createElement(MemoryRouter, { initialEntries: [path] },
    createElement(LifeOSContext.Provider, { value }, createElement(HabitsPage))));
  return { health, habits };
}

describe("M7 Chinese habit workflow", () => {
  it("creates from domain context, checks in, reverses, archives and restores", async () => {
    const { health, habits } = await show();
    fireEvent.change(await screen.findByRole("combobox", { name: "按生活领域筛选" }),
      { target: { value: health.id } });
    fireEvent.click(screen.getByRole("button", { name: "建立习惯" }));
    fireEvent.change(screen.getByRole("textbox", { name: "习惯名称" }),
      { target: { value: "晚间散步" } });
    expect((screen.getByRole("checkbox", { name: "健康" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "保存习惯" }));
    expect(await screen.findByRole("heading", { name: "晚间散步" })).toBeTruthy();
    expect((await habits.list())[0].domainIds).toEqual([health.id]);
    const today = localDate(new Date());
    fireEvent.click(screen.getByRole("button", { name: `${today}未完成，点击打卡` }));
    await waitFor(() => expect(screen.getByRole("button", { name: `${today}已完成，点击撤销` }))
      .toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: `${today}已完成，点击撤销` }));
    await waitFor(async () => expect((await habits.listLogs())[0].completed).toBe(false));
    fireEvent.click(screen.getByText("记录与调整"));
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "已完成" }) as HTMLInputElement)
      .checked).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "归档习惯：晚间散步" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "晚间散步" })).toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: "已归档" }));
    expect(await screen.findByRole("heading", { name: "晚间散步" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "恢复习惯：晚间散步" }));
    await waitFor(async () => expect((await habits.list())[0].archived).toBe(false));
  });

  it("loads a habit template when following its use link", async () => {
    await show("/habits?template=default-habit");
    expect(await screen.findByRole("dialog")).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("textbox", { name: "养成意图" }) as HTMLTextAreaElement)
      .value).toBe("希望保留的日常节奏："));
  });
});
