import { SqliteTemplateRepository } from "../../src/repositories/sqlite/SqliteTemplateRepository";
import { DatabaseSync } from "node:sqlite";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { HabitEditorDialog } from "../../src/components/HabitEditorDialog";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { identityRoleBackupTables, inspectBackup, type BackupRow, type LifeOSBackup } from "../../src/domain/backup/Backup";
import { localDate, type HabitDraft } from "../../src/domain/habits/Habit";
import { habitDraftDefaults, normalizeHabitTemplateDefaults } from "../../src/domain/habits/HabitTemplate";
import { builtInTemplates, validateTemplate, type Template } from "../../src/domain/templates/Template";
import { HabitsPage } from "../../src/pages/HabitsPage";
import { TemplatesPage } from "../../src/pages/TemplatesPage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteHabitRepository } from "../../src/repositories/sqlite/SqliteHabitRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import type { SqliteExecutor } from "../../src/repositories/sqlite/SqliteExecutor";
import { HabitService } from "../../src/services/habits/HabitService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { TemplateService } from "../../src/services/templates/TemplateService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const clock = { now: () => new Date() };
const preset = builtInTemplates.find(template => template.id === "default-habit")!;
const template: Template = { ...preset, id: "habit-context", name: "饭后散步",
  builtIn: false, defaults: { intention: "舒展身体", weeklyTarget: 5,
    frequency: "天气允许时", stableContext: "晚饭后", triggerCondition: "放下碗筷",
    obstacle: "下雨", adjustment: "在室内走动" } };
const baseDraft = (): HabitDraft => ({
  title: "散步", intention: "", weeklyTarget: 3, stableContext: "", triggerCondition: "",
  obstacle: "", adjustment: "", startOn: localDate(clock.now()), domainIds: [],
});
function services(sql: SqliteExecutor) {
  let next = 0;
  const ids = { next: () => `habit-template-${++next}` };
  const domains = new SqliteLifeDomainRepository(sql);
  return {
    templateService: new TemplateService(new SqliteTemplateRepository(sql), clock, ids),
    lifeDomainService: new LifeDomainService(domains, clock, ids),
    habitService: new HabitService(new SqliteHabitRepository(sql), domains, clock, ids),
  };
}
async function setup() {
  const sql = new MemorySqliteExecutor();
  await new MigrationRunner(sql, migrations, clock).run();
  return services(sql);
}
function Host({ children }: { children?: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  return <><output aria-label="当前位置">{location.pathname + location.search + location.hash}</output>
    <button onClick={() => navigate("/habits?template=default-habit&keep=1#position")}>切换模板请求</button>
    <button onClick={() => setRevision(value => value + 1)}>刷新页面</button>
    {children ?? <HabitsPage key={revision} />}</>;
}
function mount(value: ReturnType<typeof services>, path = "/habits", children?: ReactNode) {
  return render(<MemoryRouter initialEntries={[path]}>
    <LifeOSContext.Provider value={value as unknown as LifeOSContextValue}>
      <Host>{children}</Host>
    </LifeOSContext.Provider>
  </MemoryRouter>);
}
function locationParams() {
  const path = screen.getByLabelText("当前位置").textContent ?? "";
  return new URL(path, "http://localhost").searchParams;
}
function textValue(label: string) {
  return (screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement).value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("habit template default contracts", () => {
  it("applies explicit numeric and contextual defaults, not legacy prose or instance facts", () => {
    expect(habitDraftDefaults(template.defaults)).toEqual({
      intention: "舒展身体", weeklyTarget: 5, stableContext: "晚饭后",
      triggerCondition: "放下碗筷", obstacle: "下雨", adjustment: "在室内走动",
    });
    expect(habitDraftDefaults({ frequency: "每天一次，每周七次" })).toEqual({});
    expect(habitDraftDefaults({})).toEqual({});
    expect(habitDraftDefaults(preset.defaults).weeklyTarget).toBe(3);
    const defaults = { ...template.defaults };
    const patch = habitDraftDefaults(defaults);
    patch.intention = "自己的意图";
    expect(defaults).toEqual(template.defaults);
  });
  it.each([
    { weeklyTarget: 0 }, { weeklyTarget: 8 }, { weeklyTarget: 1.5 },
    { weeklyTarget: NaN }, { weeklyTarget: Infinity }, { weeklyTarget: "3" },
    { weeklyTarget: null }, { stableContext: "字".repeat(501) },
    { triggerCondition: "😀".repeat(251) }, { frequency: "字".repeat(2001) },
    { intention: [] }, { startOn: "2026-10-21" }, { archived: true },
    { domainIds: ["domain"] }, { title: "不得自动取名" },
    { constructor: "not a field" }, JSON.parse('{"__proto__":"not a field"}'),
  ])("rejects invalid default fields: %j", defaults => {
    expect(() => validateTemplate("habit", "习惯模板", defaults)).toThrow();
  });
  it("keeps historical text within its old limit but does not truncate it into a new habit", () => {
    const legacy = { intention: "字".repeat(2000), frequency: "自由节奏" };
    expect(normalizeHabitTemplateDefaults(legacy)).toEqual(legacy);
    expect(() => habitDraftDefaults(legacy)).toThrow("模板中心");
    expect(validateTemplate("habit", "边界", {
      weeklyTarget: 7, triggerCondition: "😀".repeat(250), stableContext: "",
    }).defaults.weeklyTarget).toBe(7);
    expect(() => validateTemplate("goal", "目标", { weeklyTarget: 3 })).toThrow();
  });
});

describe("habit template persistence", () => {
  it("rereads numeric JSON and context without changing existing habits or logs after template revisions", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys=ON");
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations, clock).run();
      const value = services(sql);
      const old = await value.templateService.save("habit", "旧节奏", { frequency: "每天" });
      const savedTemplate = await value.templateService.save("habit", template.name, template.defaults);
      const habit = await value.habitService.create({ ...baseDraft(),
        ...habitDraftDefaults(savedTemplate.defaults) });
      const log = await value.habitService.saveLog(habit.id, habit.startOn, true, "天气热", "稍晚出门");
      await value.templateService.save("habit", template.name, {
        ...template.defaults, weeklyTarget: 2, stableContext: "早晨",
      }, savedTemplate.id);
      const reloaded = services(sql);
      expect((await reloaded.templateService.find(savedTemplate.id))?.defaults.weeklyTarget).toBe(2);
      expect((await reloaded.templateService.find(old.id))?.defaults).toEqual({ frequency: "每天" });
      expect(await reloaded.habitService.list()).toEqual([habit]);
      expect(await reloaded.habitService.listLogs()).toEqual([log]);
      const data = Object.fromEntries(identityRoleBackupTables.map(table => [
        table, db.prepare(`SELECT * FROM ${table}`).all() as BackupRow[],
      ])) as LifeOSBackup["data"];
      const backup: LifeOSBackup = { format: "lifeos-backup", schemaVersion: 47,
        appVersion: "0.1.0", exportedAt: clock.now().toISOString(), data };
      const checked = inspectBackup(JSON.parse(JSON.stringify(backup)));
      const row = checked.backup.data.templates?.find(row => row.id === savedTemplate.id);
      expect(JSON.parse(String(row?.defaults_json))).toMatchObject({ weeklyTarget: 2, stableContext: "早晨" });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });
});

describe("Chinese habit template workflow", () => {
  it("copies and edits a real numeric control and optional context fields in template center", async () => {
    const value = await setup();
    mount(value, "/templates?category=habit", <TemplatesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "复制轻量习惯" }));
    expect(screen.getByRole("spinbutton", { name: "每周期望次数" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("模板名称"), { target: { value: "自己的习惯" } });
    fireEvent.change(screen.getByLabelText("每周期望次数"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("稳定情境"), { target: { value: "饭后" } });
    fireEvent.change(screen.getByLabelText("触发条件"), { target: { value: "收拾桌子" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));
    await screen.findByText("自己的习惯");
    const saved = (await value.templateService.list()).find(item => item.name === "自己的习惯")!;
    expect(saved.defaults).toMatchObject({ weeklyTarget: 6, stableContext: "饭后", triggerCondition: "收拾桌子" });
    fireEvent.click(screen.getByRole("button", { name: "编辑自己的习惯" }));
    fireEvent.change(screen.getByLabelText("每周期望次数"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));
    await waitFor(async () => expect((await value.templateService.find(saved.id))?.defaults)
      .not.toHaveProperty("weeklyTarget"));
  });
  it("waits for a valid template, then consumes only its mounted request and saves the confirmed fields", async () => {
    const value = await setup();
    const reading = deferred<Template | null>();
    vi.spyOn(value.templateService, "find").mockReturnValue(reading.promise);
    mount(value, "/habits?template=habit-context&create=habit&tag=one&tag=two#source");
    await screen.findByText("正在读取习惯模板");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(locationParams().get("template")).toBe(template.id);
    await act(async () => { reading.resolve(template); });
    await screen.findByRole("dialog");
    expect(textValue("每周期望次数")).toBe("5");
    fireEvent.click(screen.getByText("情境与调整"));
    expect(textValue("稳定情境")).toBe("晚饭后");
    expect(textValue("触发条件")).toBe("放下碗筷");
    expect(screen.getByText("期望节奏：天气允许时")).toBeTruthy();
    await waitFor(() => expect(locationParams().has("template")).toBe(false));
    expect(locationParams().has("create")).toBe(false);
    expect(locationParams().getAll("tag")).toEqual(["one", "two"]);
    expect(screen.getByLabelText("当前位置").textContent).toContain("#source");
    fireEvent.change(screen.getByLabelText("习惯名称"), { target: { value: "自己的散步" } });
    fireEvent.click(screen.getByRole("button", { name: "保存习惯" }));
    await screen.findByRole("heading", { name: "自己的散步" });
    expect((await value.habitService.list())[0]).toMatchObject({
      weeklyTarget: 5, stableContext: "晚饭后", triggerCondition: "放下碗筷",
    });
    fireEvent.click(screen.getByRole("button", { name: "建立习惯" }));
    expect(textValue("每周期望次数")).toBe("3");
    expect(textValue("养成意图")).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByText("刷新页面"));
    await screen.findByRole("heading", { name: "习惯" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("does not derive a weekly target from a historical free-text frequency", async () => {
    const value = await setup();
    const legacy = await value.templateService.save("habit", "旧模板", { frequency: "每天一次" });
    mount(value, `/habits?template=${legacy.id}`);
    await screen.findByRole("dialog");
    expect(textValue("每周期望次数")).toBe("3");
    expect(screen.getByText("期望节奏：每天一次")).toBeTruthy();
  });
  it("retains a failed request with sanitized retry and never permits premature creation", async () => {
    const value = await setup();
    vi.spyOn(value.templateService, "find")
      .mockRejectedValueOnce(new Error("C:\\private\\data.db SELECT secret"))
      .mockResolvedValueOnce(template);
    mount(value, "/habits?template=habit-context&keep=1#source");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("重试");
    expect(alert.textContent).not.toContain("private");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((screen.getByRole("button", { name: "建立习惯" }) as HTMLButtonElement).disabled).toBe(true);
    expect(locationParams().get("template")).toBe(template.id);
    fireEvent.click(screen.getByRole("button", { name: "重试读取模板" }));
    await screen.findByRole("dialog");
    expect(textValue("每周期望次数")).toBe("5");
    expect(await value.habitService.list()).toEqual([]);
  });
  it.each([null, { ...template, category: "goal" as const },
    { ...template, defaults: { weeklyTarget: 9 } },
    { ...template, defaults: { intention: "字".repeat(501) } }])(
    "keeps missing, wrong-category and unusable defaults until explicit cancellation", async result => {
      const value = await setup();
      vi.spyOn(value.templateService, "find").mockResolvedValue(result);
      mount(value, "/habits?template=habit-context&create=habit&keep=1#source");
      await screen.findByRole("alert");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(locationParams().get("template")).toBe(template.id);
      fireEvent.click(screen.getByRole("button", { name: "取消模板请求" }));
      await waitFor(() => expect(locationParams().has("template")).toBe(false));
      expect(locationParams().has("create")).toBe(false);
      expect(locationParams().get("keep")).toBe("1");
      expect(screen.getByLabelText("当前位置").textContent).toContain("#source");
      expect(await value.habitService.list()).toEqual([]);
    });
  it("keeps the current draft when a same-page template arrives and opens it only after close", async () => {
    const value = await setup();
    mount(value);
    fireEvent.click(await screen.findByRole("button", { name: "建立习惯" }));
    fireEvent.change(screen.getByLabelText("养成意图"), { target: { value: "未保存草稿" } });
    fireEvent.click(screen.getByText("切换模板请求"));
    expect(textValue("养成意图")).toBe("未保存草稿");
    expect(locationParams().get("template")).toBe("default-habit");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(textValue("养成意图")).toBe("希望保留的日常节奏："));
    await waitFor(() => expect(locationParams().has("template")).toBe(false));
    expect(locationParams().get("keep")).toBe("1");
  });
  it("drops obsolete reads when a new request replaces them", async () => {
    const value = await setup();
    const old = deferred<Template | null>();
    vi.spyOn(value.templateService, "find").mockImplementation(id =>
      id === template.id ? old.promise : Promise.resolve(preset));
    mount(value, "/habits?template=habit-context");
    await screen.findByText("正在读取习惯模板");
    fireEvent.click(screen.getByText("切换模板请求"));
    await screen.findByRole("dialog");
    await act(async () => { old.resolve(template); });
    expect(textValue("养成意图")).toBe("希望保留的日常节奏：");
    expect(textValue("每周期望次数")).toBe("3");
  });
  it("ignores template props when editing an existing habit", async () => {
    const value = await setup();
    const habit = await value.habitService.create({ ...baseDraft(), title: "旧习惯",
      weeklyTarget: 2, stableContext: "早晨", intention: "原意图" });
    mount(value, "/habits?template=habit-context", <HabitEditorDialog habit={habit} template={template}
      domains={[]} defaultDomainId="" onClose={() => {}} onSaved={() => {}} />);
    expect(textValue("每周期望次数")).toBe("2");
    expect(textValue("养成意图")).toBe("原意图");
    expect(screen.queryByText("期望节奏：天气允许时")).toBeNull();
    fireEvent.click(screen.getByText("情境与调整"));
    expect(textValue("稳定情境")).toBe("早晨");
  });
  it("keeps failed save drafts and blocks duplicate submission or dismissal while saving", async () => {
    const value = await setup();
    const saving = deferred<Awaited<ReturnType<HabitService["create"]>>>();
    const create = vi.spyOn(value.habitService, "create")
      .mockRejectedValueOnce(new Error("保存失败"))
      .mockReturnValueOnce(saving.promise);
    const close = vi.fn();
    const saved = vi.fn();
    mount(value, "/habits", <HabitEditorDialog template={template} domains={[]}
      defaultDomainId="" onClose={close} onSaved={saved} />);
    fireEvent.change(screen.getByLabelText("习惯名称"), { target: { value: "保留草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存习惯" }));
    await screen.findByRole("alert");
    expect(textValue("习惯名称")).toBe("保留草稿");
    expect(textValue("每周期望次数")).toBe("5");
    const form = screen.getByRole("dialog").querySelector("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(create).toHaveBeenCalledTimes(2);
    expect(close).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "关闭" }) as HTMLButtonElement).disabled).toBe(true);
    const fields = within(screen.getByRole("dialog")).getByLabelText("习惯名称");
    expect(fields.closest("fieldset")?.disabled).toBe(true);
    await act(async () => { saving.resolve({ ...baseDraft(), ...habitDraftDefaults(template.defaults),
      title: "保留草稿", id: "saved", archived: false, createdAt: "", updatedAt: "" }); });
    expect(saved).toHaveBeenCalledTimes(1);
  });
  it("does not open a late-read editor after the page unmounts", async () => {
    const value = await setup();
    const reading = deferred<Template | null>();
    vi.spyOn(value.templateService, "find").mockReturnValue(reading.promise);
    const view = mount(value, "/habits?template=habit-context");
    await screen.findByText("正在读取习惯模板");
    view.unmount();
    await act(async () => { reading.resolve(template); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await value.habitService.list()).toEqual([]);
  });
});
