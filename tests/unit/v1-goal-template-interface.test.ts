import { SqliteTemplateRepository } from "../../src/repositories/sqlite/SqliteTemplateRepository";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSProvider } from "../../src/app/LifeOSProvider";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { GoalEditorDialog } from "../../src/components/GoalEditorDialog";
import { GoalsPage } from "../../src/pages/GoalsPage";
import { TemplatesPage } from "../../src/pages/TemplatesPage";
import { ContextExportPage } from "../../src/pages/ContextExportPage";
import { builtInTemplates, cloneTemplateDefaults } from "../../src/domain/templates/Template";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { TemplateService } from "../../src/services/templates/TemplateService";

vi.mock("../../src/app/applicationDependencies", () => ({ createApplicationDependencies: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

async function dependencies() {
  const actual = await vi.importActual<typeof import("../../src/app/applicationDependencies")>(
    "../../src/app/applicationDependencies");
  const value = actual.createApplicationDependencies();
  await value.bootstrapApplicationService.bootstrap();
  vi.mocked(createApplicationDependencies).mockReturnValue(value);
  return value;
}

function show(path: string) {
  return render(createElement(LifeOSProvider, { children: createElement(MemoryRouter,
    { initialEntries: [path] }, createElement(GoalsPage)) }));
}

describe("V1 Chinese goal template workflow", () => {
  it.each(["default-smart", "default-okr"])("edits %s progress at creation and retains drafts after failure", async (id) => {
    const value = await dependencies();
    const before = await value.goalService.list();
    const domains = await value.lifeDomainService.list();
    const title = `初始进度-${id}`;
    show(`/goals?template=${id}&domain=${domains[0].id}`);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getAllByRole("group", { name: /进度项 \d/ })).toHaveLength(2));
    const first = within(dialog).getByRole("group", { name: "进度项 1" });
    expect(within(first).getByRole("combobox", { name: "类型" })).toHaveProperty("value",
      id === "default-smart" ? "milestone" : "key_result");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "目标名称" }), { target: { value: title } });
    fireEvent.change(within(first).getByRole("textbox", { name: "名称" }), { target: { value: "可观察的结果" } });
    fireEvent.change(within(first).getByRole("spinbutton", { name: "当前值" }), { target: { value: "4" } });
    fireEvent.change(within(first).getByRole("spinbutton", { name: "目标值" }), { target: { value: "10" } });
    fireEvent.change(within(first).getByRole("spinbutton", { name: "权重" }), { target: { value: "3" } });
    const second = within(dialog).getByRole("group", { name: "进度项 2" });
    fireEvent.change(within(second).getByRole("spinbutton", { name: "当前值" }), { target: { value: "1" } });
    vi.spyOn(value.goalService, "create").mockRejectedValueOnce(new Error("创建失败，请重试。"));
    fireEvent.click(within(dialog).getByRole("button", { name: "创建目标" }));
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "保存失败，请重试。");
    expect(await value.goalService.list()).toEqual(before);
    expect(within(first).getByRole("spinbutton", { name: "权重" })).toHaveProperty("value", "3");
    fireEvent.click(within(dialog).getByRole("button", { name: "创建目标" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("progressbar", { name: `${title}关联事项进展` })).toHaveProperty("value", 55);
    const goal = (await value.goalService.list()).find((item) => item.title === title)!;
    expect(goal.domainIds).toEqual([domains[0].id]);
    expect((await value.goalProgressItemService.list()).filter((item) => item.goalId === goal.id)).toHaveLength(2);
    expect(await value.versionHistoryService.list("goal", goal.id)).toHaveLength(0);
  });

  it("waits for a valid template read before opening the editor and offers sanitized retry", async () => {
    const value = await dependencies();
    let reject!: (reason: Error) => void;
    vi.spyOn(value.templateService, "find").mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const create = vi.spyOn(value.goalService, "create");
    show("/goals?template=default-okr");
    await screen.findByText("正在读取目标模板");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(create).not.toHaveBeenCalled();
    reject(new Error("模板读取失败。"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "目标模板读取或校验失败，请重试或重新选择。");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试读取模板" }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "创建目标" });
    await waitFor(() => expect(submit).toHaveProperty("disabled", false));
    expect(within(dialog).getByRole("textbox", { name: "目标名称" })).toHaveProperty("value", "");
    expect(within(dialog).getAllByRole("group", { name: /进度项 \d/ })).toHaveLength(2);
  });

  it.each(["missing-template", "default-review"])("rejects unavailable or wrong-category templates: %s", async (id) => {
    await dependencies();
    show(`/goals?template=${id}`);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "目标模板已不存在或类型不符，请重新选择。");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("copies and edits initial items in the template center without changing the system preset", async () => {
    vi.stubGlobal("structuredClone", undefined);
    const sql = new MemorySqliteExecutor();
    const clock = { now: () => new Date("2026-10-08T08:00:00Z") };
    await new MigrationRunner(sql, migrations, clock).run();
    const service = new TemplateService(new SqliteTemplateRepository(sql), clock, { next: () => "ui-smart-copy" });
    render(createElement(MemoryRouter, null, createElement(LifeOSContext.Provider,
      { value: { templateService: service } as LifeOSContextValue }, createElement(TemplatesPage))));
    await screen.findByRole("combobox", { name: "新建目标" });
    const copy = await screen.findByRole("button", { name: "复制SMART 目标" });
    await waitFor(() => expect(copy.matches(":disabled")).toBe(false));
    fireEvent.click(copy);
    const editor = await screen.findByRole("region", { name: "编辑模板" });
    fireEvent.click(within(editor).getByText("初始进度项", { selector: "summary" }));
    fireEvent.change(within(editor).getByRole("textbox", { name: "模板名称" }), { target: { value: "自己的目标模板" } });
    const first = within(editor).getByRole("group", { name: "进度项 1" });
    fireEvent.change(within(first).getByRole("spinbutton", { name: "权重" }), { target: { value: "4" } });
    fireEvent.click(within(editor).getByRole("button", { name: "移除进度项 2" }));
    fireEvent.click(within(editor).getByRole("button", { name: "保存模板" }));
    expect(await screen.findByText("自己的目标模板", { selector: "strong" })).toBeTruthy();
    expect((await service.find("ui-smart-copy"))?.defaults.progressItems).toEqual([
      { kind: "milestone", title: "阶段里程碑", currentValue: 0, targetValue: 1, weight: 4 },
    ]);
    expect((await service.find("default-smart"))?.defaults.progressItems).toHaveLength(2);
    const row = screen.getByText("自己的目标模板", { selector: "strong" }).closest("li")!;
    expect(within(row).getByRole("link", { name: "使用" }).getAttribute("href"))
      .toBe("/goals?template=ui-smart-copy");
  });

  it("editing an existing goal never applies a template or replaces its items", async () => {
    const value = await dependencies();
    const goal = await value.goalService.create({ title: "原有目标编辑", description: "原文",
      domainId: null, status: "active", targetDate: null }, [
      { kind: "outcome", title: "原有结果", currentValue: 2, targetValue: 10, weight: 1 },
    ]);
    const before = (await value.goalProgressItemService.list()).filter((item) => item.goalId === goal.id);
    const find = vi.spyOn(value.templateService, "find");
    const onSaved = vi.fn();
    render(createElement(LifeOSProvider, { children: createElement(MemoryRouter,
      { initialEntries: ["/goals?template=default-smart"] }, createElement(GoalEditorDialog, {
        goal, goals: [goal], domains: [], onClose: vi.fn(), onSaved,
      })) }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "目标说明" })).toHaveProperty("value", "原文");
    expect(within(dialog).queryByText("初始进度项")).toBeNull();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "目标名称" }), { target: { value: "只修改名称" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(find).not.toHaveBeenCalled();
    expect((await value.goalProgressItemService.list()).filter((item) => item.goalId === goal.id)).toEqual(before);
  });

  it("applies export template fields without structuredClone or shared preset arrays", async () => {
    vi.stubGlobal("structuredClone", undefined);
    const value = await dependencies();
    const preset = builtInTemplates.find((item) => item.id === "default-export-goal-analysis")!;
    const original = JSON.stringify(preset.defaults);
    const template = await value.templateService.save("export", "兼容性测试模板", {
      ...cloneTemplateDefaults(preset.defaults), question: "仅从这个模板带入的问题",
    });
    const records = await value.contextExportService.loadRecords();
    vi.spyOn(value.contextExportService, "loadRecords").mockResolvedValue(records);
    let resolveTemplate!: (result: typeof template) => void;
    const find = vi.spyOn(value.templateService, "find").mockImplementationOnce(() =>
      new Promise((resolve) => { resolveTemplate = resolve; }));
    render(createElement(LifeOSProvider, { children: createElement(MemoryRouter,
      { initialEntries: [`/export?template=${template.id}`] },
      createElement(ContextExportPage)) }));
    await waitFor(() => expect(find).toHaveBeenCalledWith(template.id));
    await act(async () => resolveTemplate(template));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "希望讨论的问题" }))
      .toHaveProperty("value", "仅从这个模板带入的问题"));
    const first = (preset.defaults.fields as Record<string, string[]>).goal[0];
    const remove = await screen.findByRole("button", { name: `移除目标的${first}`, exact: true });
    await waitFor(() => expect(remove.matches(":disabled")).toBe(false));
    fireEvent.click(remove);
    expect(screen.queryByRole("button", { name: `移除目标的${first}`, exact: true })).toBeNull();
    expect(JSON.stringify(preset.defaults)).toBe(original);
    expect((await value.templateService.find(template.id))?.defaults).toEqual(template.defaults);
    expect(screen.queryByText("structuredClone is not defined")).toBeNull();
    expect(value.environment).toBe("browser-preview");
  });
});
