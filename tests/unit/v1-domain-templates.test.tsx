import { SqliteTemplateRepository } from "../../src/repositories/sqlite/SqliteTemplateRepository";
import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { DomainEditorDialog } from "../../src/components/DomainEditorDialog";
import { SetupDomains } from "../../src/components/SetupDomains";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { identityRoleBackupTables, inspectBackup, type BackupRow, type LifeOSBackup } from "../../src/domain/backup/Backup";
import { domainDraftFromDefaults, normalizeDomainTemplateDefaults } from "../../src/domain/life/DomainTemplate";
import { builtInTemplates, cloneTemplateDefaults, validateTemplate, type Template } from "../../src/domain/templates/Template";
import { TemplatesPage } from "../../src/pages/TemplatesPage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import type { SqliteExecutor } from "../../src/repositories/sqlite/SqliteExecutor";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { TemplateService } from "../../src/services/templates/TemplateService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const clock = { now: () => new Date("2026-10-21T08:00:00Z") };
const preset = builtInTemplates.find(template => template.id === "default-domain-heart")!;
function services(sql: SqliteExecutor) {
  let sequence = 0;
  const ids = { next: () => `domain-template-${++sequence}` };
  return {
    lifeDomainService: new LifeDomainService(new SqliteLifeDomainRepository(sql), clock, ids),
    templateService: new TemplateService(new SqliteTemplateRepository(sql), clock, ids),
  };
}
async function setup() {
  const sql = new MemorySqliteExecutor();
  await new MigrationRunner(sql, migrations, clock).run();
  return services(sql);
}
function Location() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output aria-label="当前位置">{location.pathname + location.search + location.hash}</output>
    <button type="button" onClick={() => navigate("/settings?template=default-domain-wallet&keep=1#position")}>
      切换模板请求
    </button></>;
}
function mount(value: ReturnType<typeof services>, content: ReactNode, path = "/settings") {
  return render(<MemoryRouter initialEntries={[path]}>
    <LifeOSContext.Provider value={value as unknown as LifeOSContextValue}>
      {content}<Location />
    </LifeOSContext.Provider>
  </MemoryRouter>);
}

describe("domain template contracts", () => {
  it("provides five recommended contexts without fabricated current facts or shared draft state", () => {
    expect(builtInTemplates.filter(template => template.category === "domain")).toHaveLength(5);
    const before = cloneTemplateDefaults(preset.defaults);
    const draft = domainDraftFromDefaults(preset.defaults);
    expect(draft).toMatchObject({ name: "健康", color: "fern", icon: "heart",
      longTermExpectation: "", currentState: "", status: "active" });
    draft.name = "自己的领域";
    expect(preset.defaults).toEqual(before);
    expect(domainDraftFromDefaults({})).toMatchObject({ name: "", color: "ocean", icon: "heart" });
  });
  it.each([
    { name: "名".repeat(29) }, { description: "字".repeat(281) },
    { focus: "字".repeat(121) }, { longTermExpectation: "字".repeat(501) },
    { name: "😀".repeat(15) }, { color: "unknown" }, { icon: "unknown" },
    { currentState: "自动推断" }, { status: "archived" }, { domainIds: ["domain"] },
    { name: 1 }, { constructor: "not a field" }, { toString: "not a field" },
  ])("rejects invalid or instance-only defaults: %j", defaults => {
    expect(() => validateTemplate("domain", "领域模板", defaults)).toThrow();
  });
  it("accepts empty optional fields and exact limits without mutating input", () => {
    const defaults = { name: "", description: "字".repeat(280), focus: "",
      longTermExpectation: "😀".repeat(250), color: "coral", icon: "users" };
    const copy = { ...defaults };
    expect(normalizeDomainTemplateDefaults(defaults)).toEqual(copy);
    expect(validateTemplate("domain", " 我的领域 ", defaults).name).toBe("我的领域");
    expect(defaults).toEqual(copy);
    expect(() => validateTemplate("goal", "目标", { name: "不适用" })).toThrow();
    expect(() => validateTemplate("habit", "习惯", { constructor: "不适用" })).toThrow();
  });
});

describe("domain template persistence and backup", () => {
  it("rolls back a failed schema extension without removing original templates", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, 46), clock).run();
      await services(sql).templateService.save("goal", "原模板", { description: "保留原文" });
      const before = db.prepare("SELECT * FROM templates").all();
      const last = migrations[46];
      const broken = [...migrations.slice(0, 46), { ...last,
        statements: [...last.statements, "INSERT INTO missing_template_table VALUES (1)"] }];
      await expect(new MigrationRunner(sql, broken, clock).run()).rejects.toThrow();
      expect(db.prepare("SELECT * FROM templates").all()).toEqual(before);
      expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get())
        .toMatchObject({ version: "0046-v1-inbox-record-targets" });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'templates_v47'").all()).toEqual([]);
      await new MigrationRunner(sql, migrations, clock).run();
      expect(db.prepare("SELECT * FROM templates").all()).toEqual(before);
    } finally { db.close(); }
  });
  it("migrates old templates verbatim and never applies later revisions to saved domains", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys=ON");
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, 46), clock).run();
      const value = services(sql);
      const old = await value.templateService.save("habit", "旧节奏", { frequency: "每周三次" });
      await value.templateService.save("habit", "旧节奏", { frequency: "允许间断" }, old.id);
      const before = db.prepare("SELECT * FROM templates ORDER BY id").all();
      await new MigrationRunner(sql, migrations, clock).run();
      expect(db.prepare("SELECT * FROM templates ORDER BY id").all()).toEqual(before);
      const copy = await value.templateService.save("domain", "健康副本", { ...preset.defaults,
        name: "体能", longTermExpectation: "舒适地活动" });
      const saved = await value.lifeDomainService.create(domainDraftFromDefaults(copy.defaults));
      await value.templateService.save("domain", "健康副本", { ...copy.defaults,
        name: "改版名称", longTermExpectation: "新版期待" }, copy.id);
      const reloaded = services(sql);
      expect((await reloaded.templateService.find(copy.id))?.version).toBe(2);
      expect(await reloaded.lifeDomainService.findById(saved.id)).toEqual(saved);
      await expect(value.templateService.save("domain", "覆盖", {}, preset.id)).rejects.toThrow();
      expect((await value.templateService.find(preset.id))?.defaults).toEqual(preset.defaults);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });
  it("preflights version 47 and rejects corrupt or disguised domain templates without changing data", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations, clock).run();
      const value = services(sql);
      await value.templateService.save("domain", "自定义领域", preset.defaults);
      const data = Object.fromEntries(identityRoleBackupTables.map(table => [
        table, db.prepare(`SELECT * FROM ${table}`).all() as BackupRow[],
      ])) as LifeOSBackup["data"];
      const backup: LifeOSBackup = { format: "lifeos-backup", schemaVersion: 47,
        appVersion: "0.1.0", exportedAt: clock.now().toISOString(), data };
      expect(inspectBackup(backup).counts.templates).toBe(1);
      expect(inspectBackup(backup).backup.schemaVersion).toBe(47);
      for (const version of [45, 46] as const) {
        expect(() => inspectBackup({ ...backup, schemaVersion: version })).toThrow("领域模板");
      }
      for (const defaults of ["invalid", "[]", '{"icon":"unknown"}', '{"currentState":"guess"}',
        JSON.stringify({ longTermExpectation: "😀".repeat(251) })]) {
        const broken = JSON.parse(JSON.stringify(backup)) as LifeOSBackup;
        broken.data.templates![0].defaults_json = defaults;
        expect(() => inspectBackup(broken)).toThrow("领域模板");
      }
      const legacy = JSON.parse(JSON.stringify(backup)) as LifeOSBackup;
      legacy.schemaVersion = 46;
      legacy.data.templates![0].category = "habit";
      legacy.data.templates![0].defaults_json = '{"frequency":"原节奏"}';
      expect(inspectBackup(legacy).counts.templates).toBe(1);
      expect(await value.templateService.list()).toContainEqual(expect.objectContaining({ name: "自定义领域" }));
    } finally { db.close(); }
  });
});

describe("Chinese domain template workflow", () => {
  it("copies, edits and links a domain template from its dedicated category", async () => {
    const value = await setup();
    mount(value, <TemplatesPage />, "/templates?category=domain");
    const tab = screen.getByRole("tab", { name: "领域" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(await screen.findByRole("button", { name: "复制健康领域" }));
    const editor = screen.getByRole("region", { name: "编辑模板" });
    fireEvent.change(within(editor).getByRole("textbox", { name: "模板名称" }),
      { target: { value: "自己的健康" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "领域名称" }),
      { target: { value: "运动" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "长期期待" }),
      { target: { value: "自在地活动" } });
    fireEvent.click(within(editor).getByRole("button", { name: "选择珊瑚" }));
    fireEvent.click(within(editor).getByRole("button", { name: "选择新芽图标" }));
    fireEvent.click(within(editor).getByRole("button", { name: "保存模板" }));
    const label = await screen.findByText("自己的健康");
    const row = label.closest("li")!;
    const copy = (await value.templateService.list()).find(template => template.name === "自己的健康")!;
    expect(copy.defaults).toMatchObject({ name: "运动", longTermExpectation: "自在地活动",
      color: "coral", icon: "sprout" });
    expect(within(row).getByRole("link", { name: "使用" }).getAttribute("href"))
      .toBe(`/settings?template=${copy.id}`);
    expect(await value.lifeDomainService.list()).toEqual([]);
  });
  it("opens only after template load, consumes the request once, and preserves failed-save drafts", async () => {
    const value = await setup();
    let resolve!: (template: Template) => void;
    const find = vi.spyOn(value.templateService, "find").mockImplementationOnce(
      () => new Promise(done => { resolve = done; }));
    mount(value, <SetupDomains />, "/settings?template=default-domain-heart&keep=1#position");
    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("当前位置").textContent).toContain("template=default-domain-heart");
    resolve(preset);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getByLabelText("当前位置").textContent).toBe("/settings?keep=1#position"));
    expect(within(dialog).getByRole("textbox", { name: "领域名称" })).toHaveProperty("value", "健康");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "长期期待" }),
      { target: { value: "身体轻松" } });
    vi.spyOn(value.lifeDomainService, "create").mockRejectedValueOnce(new Error("暂时无法保存"));
    fireEvent.click(within(dialog).getByRole("button", { name: "创建领域" }));
    await screen.findByText("保存领域失败，请重试。");
    expect(within(dialog).getByRole("textbox", { name: "长期期待" })).toHaveProperty("value", "身体轻松");
    fireEvent.click(within(dialog).getByRole("button", { name: "创建领域" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await value.lifeDomainService.list()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "添加领域" }));
    expect(within(screen.getByRole("dialog")).getByRole("textbox", { name: "领域名称" }))
      .toHaveProperty("value", "");
    expect(find).toHaveBeenCalledTimes(1);
  });
  it.each(["missing", "default-smart"])("retains invalid request %s until explicit cancellation", async id => {
    const value = await setup();
    mount(value, <SetupDomains />, `/settings?template=${id}&keep=1#position`);
    expect((await screen.findByRole("alert")).textContent).toContain("领域模板已不存在");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("当前位置").textContent).toContain(`template=${id}`);
    fireEvent.click(screen.getByRole("button", { name: "取消模板请求" }));
    await waitFor(() => expect(screen.getByLabelText("当前位置").textContent).toBe("/settings?keep=1#position"));
    expect(await value.lifeDomainService.list()).toEqual([]);
  });
  it("retries sanitized read failures and waits for an existing draft before opening another request", async () => {
    const value = await setup();
    vi.spyOn(value.templateService, "find").mockRejectedValueOnce(new Error("C:/private/path.sqlite"));
    mount(value, <SetupDomains />, "/settings?template=default-domain-heart");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("private");
    fireEvent.click(screen.getByRole("button", { name: "重试读取模板" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "领域名称" }),
      { target: { value: "保留草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "切换模板请求" }));
    expect(within(dialog).getByRole("textbox", { name: "领域名称" })).toHaveProperty("value", "保留草稿");
    expect(screen.getByLabelText("当前位置").textContent).toContain("template=default-domain-wallet");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(within(screen.getByRole("dialog"))
      .getByRole("textbox", { name: "领域名称" })).toHaveProperty("value", "财务"));
  });
  it("ignores templates when editing an existing domain", async () => {
    const value = await setup();
    const domain = await value.lifeDomainService.create({ name: "原领域", description: "原文",
      focus: "原关注", longTermExpectation: "原期待", currentState: "实际情况",
      color: "gold", icon: "wallet", status: "paused" });
    const onSaved = vi.fn();
    mount(value, <DomainEditorDialog domain={domain} template={preset} onClose={vi.fn()} onSaved={onSaved} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "领域名称" })).toHaveProperty("value", "原领域");
    expect(within(dialog).getByRole("textbox", { name: "当前状态" })).toHaveProperty("value", "实际情况");
    fireEvent.click(within(dialog).getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(await value.lifeDomainService.findById(domain.id)).toMatchObject(domain);
  });
  it("does not submit twice or dismiss a pending domain save", async () => {
    const value = await setup();
    let resolve!: (domain: Awaited<ReturnType<LifeDomainService["create"]>>) => void;
    const saved = await value.lifeDomainService.create({ name: "健康", description: "", focus: "",
      longTermExpectation: "身体轻松", color: "fern", icon: "heart" });
    const create = vi.spyOn(value.lifeDomainService, "create").mockImplementationOnce(
      () => new Promise(done => { resolve = done; }));
    const onClose = vi.fn();
    const onSaved = vi.fn();
    mount(value, <DomainEditorDialog template={preset} onClose={onClose} onSaved={onSaved} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "长期期待" }),
      { target: { value: "身体轻松" } });
    fireEvent.submit(dialog.querySelector("form")!);
    fireEvent.submit(dialog.querySelector("form")!);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(create).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    resolve(saved);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
  });
  it("drops late template reads after leaving settings", async () => {
    const value = await setup();
    let resolve!: (template: Template) => void;
    const find = vi.spyOn(value.templateService, "find").mockImplementationOnce(
      () => new Promise(done => { resolve = done; }));
    const view = mount(value, <SetupDomains />, "/settings?template=default-domain-heart");
    await waitFor(() => expect(find).toHaveBeenCalled());
    view.unmount();
    resolve(preset);
    await Promise.resolve();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await value.lifeDomainService.list()).toEqual([]);
  });
});
