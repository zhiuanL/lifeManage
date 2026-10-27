import { SqliteTemplateRepository } from "../../src/repositories/sqlite/SqliteTemplateRepository";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { InboxPage } from "../../src/pages/InboxPage";
import { GoalsPage } from "../../src/pages/GoalsPage";
import { TemplatesPage } from "../../src/pages/TemplatesPage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { TemplateService } from "../../src/services/templates/TemplateService";
import { fieldPresets, scenarioPresets } from "../../src/domain/export/ContextExport";

afterEach(cleanup);
const clock = { now: () => new Date("2026-09-28T08:00:00Z") };

function show(page: typeof TemplatesPage, value: LifeOSContextValue, path: string) {
  return render(createElement(MemoryRouter, { initialEntries: [path] },
    createElement(LifeOSContext.Provider, { value }, createElement(page))));
}

describe("M6 Chinese navigation and template editor", () => {
  it("saves a reordered export template with explicit field selection", async () => {
    const db = new MemorySqliteExecutor();
    await new MigrationRunner(db, migrations, clock).run();
    const service = new TemplateService(new SqliteTemplateRepository(db), clock, { next: () => "custom-export" });
    show(TemplatesPage, { templateService: service } as LifeOSContextValue, "/templates");

    fireEvent.click(screen.getByRole("tab", { name: "上下文导出" }));
    fireEvent.click(await screen.findByRole("button", { name: "复制目标分析" }));
    fireEvent.change(screen.getByRole("textbox", { name: "模板名称" }),
      { target: { value: "我的目标导出" } });
    fireEvent.click(screen.getByRole("button", { name: "上移行动" }));
    const goal = screen.getByText("目标", { selector: ".template-section label" })
      .closest(".template-section");
    expect(goal).not.toBeNull();
    fireEvent.click(within(goal as HTMLElement).getByText("字段"));
    fireEvent.click(within(goal as HTMLElement).getByRole("button", { name: "下移目标的说明" }));
    fireEvent.click(within(goal as HTMLElement).getByRole("checkbox", { name: "目标日期" }));
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));

    await waitFor(() => expect(screen.getByText("我的目标导出")).toBeTruthy());
    const saved = await service.find("custom-export");
    const sections = [...scenarioPresets["goal-analysis"].sections];
    const actionIndex = sections.indexOf("action");
    [sections[actionIndex - 1], sections[actionIndex]] = [sections[actionIndex], sections[actionIndex - 1]];
    expect(saved?.defaults.sections).toEqual(sections);
    const goalFields = [...fieldPresets.goal];
    const descriptionIndex = goalFields.indexOf("说明");
    [goalFields[descriptionIndex], goalFields[descriptionIndex + 1]] =
      [goalFields[descriptionIndex + 1], goalFields[descriptionIndex]];
    expect((saved?.defaults.fields as Record<string, string[]>).goal)
      .toEqual(goalFields.filter(field => field !== "目标日期"));
    expect(saved?.version).toBe(1);
    expect((await service.find("default-export-goal-analysis"))?.defaults.sections)
      .toEqual(scenarioPresets["goal-analysis"].sections);
  });

  it("opens the requested goal template immediately when visiting its link", async () => {
    const value = {
      lifeNavigationService: { list: vi.fn().mockResolvedValue([]) },
      lifeDomainService: { list: vi.fn().mockResolvedValue([]) },
      goalService: { list: vi.fn().mockResolvedValue([]) },
      goalProgressItemService: { list: vi.fn().mockResolvedValue([]) },
      actionService: { list: vi.fn().mockResolvedValue([]) },
      habitService: { list: vi.fn().mockResolvedValue([]), listLogs: vi.fn().mockResolvedValue([]) },
      templateService: { find: vi.fn().mockResolvedValue({
        category: "goal", name: "SMART 目标", defaults: { description: "先定义可观察的结果" },
      }) },
    } as unknown as LifeOSContextValue;
    show(GoalsPage, value, "/goals?template=default-smart");
    expect(await screen.findByRole("dialog")).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("textbox", { name: "目标说明" }) as HTMLTextAreaElement)
      .value).toBe("先定义可观察的结果"));
  });

  it("follows an inbox deep link but lets a person change tabs", async () => {
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      const item = {
        id: "archive-1", content: "一条归档记录", source: "inbox", status: "archived",
        targetType: null, targetId: null, createdAt: clock.now().toISOString(),
        updatedAt: clock.now().toISOString(),
      };
      const value = {
        inboxService: { list: vi.fn().mockResolvedValue([item]) },
        lifeDomainService: { list: vi.fn().mockResolvedValue([]) },
        goalService: { list: vi.fn().mockResolvedValue([]) },
      } as unknown as LifeOSContextValue;
      show(InboxPage, value, "/inbox#inbox-archive-1");
      expect(await screen.findByText("一条归档记录")).toBeTruthy();
      expect(screen.getByRole("tab", { name: /已归档/ }).getAttribute("aria-selected")).toBe("true");
      await waitFor(() => expect(scroll).toHaveBeenCalled());
      fireEvent.click(screen.getByRole("tab", { name: /待整理/ }));
      expect(screen.getByRole("tab", { name: /待整理/ }).getAttribute("aria-selected")).toBe("true");
      expect(screen.queryByText("一条归档记录")).toBeNull();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
