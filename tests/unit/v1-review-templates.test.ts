import { SqliteTemplateRepository } from "../../src/repositories/sqlite/SqliteTemplateRepository";
import { DatabaseSync } from "node:sqlite";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { supportedBackupTables, inspectBackup } from "../../src/domain/backup/Backup";
import { TemplateService } from "../../src/services/templates/TemplateService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext } from "../../src/app/LifeOSContext";
import { ReviewEditorDialog } from "../../src/components/ReviewEditorDialog";
import { TemplatesPage } from "../../src/pages/TemplatesPage";
import { builtInTemplates, cloneTemplateDefaults, reviewStructureFromTemplate, reviewTemplateDefaults, validateTemplate } from "../../src/domain/templates/Template";
import { reviewPeriod, reviewTypes } from "../../src/domain/reviews/ReviewStructure";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function setup() {
  const value = createApplicationDependencies();
  await value.bootstrapApplicationService.bootstrap();
  return value;
}
function mount(value: Awaited<ReturnType<typeof setup>>, component: React.ReactNode, path = "/templates") {
  return render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(LifeOSContext.Provider, { value }, component)));
}
const anchor = "2024-02-29";
describe("cycle review templates", () => {
  it("roundtrips five-cycle custom definitions through real SQLite and backup JSON", async () => {
    const db = new DatabaseSync(":memory:");
    const clock = { now: () => new Date("2026-10-13T08:00:00Z") };
    let id = 0;
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations, clock).run();
      const service = new TemplateService(new SqliteTemplateRepository(sql), clock, { next: () => "review-copy-" + (++id) });
      for (const type of reviewTypes) {
        const saved = await service.save("review", type, reviewTemplateDefaults(type));
        const reloaded = await new TemplateService(new SqliteTemplateRepository(sql), clock, { next: () => "unused" }).find(saved.id);
        expect(reloaded?.defaults).toEqual(saved.defaults);
        expect(reviewStructureFromTemplate(reloaded!, anchor).type).toBe(type);
      }
      const backup = { format: "lifeos-backup", schemaVersion: 44, appVersion: "0.1.0", exportedAt: clock.now().toISOString(),
        data: Object.fromEntries(supportedBackupTables.map(table => [table, db.prepare("SELECT * FROM " + table).all()])) };
      expect(inspectBackup(backup).counts.templates).toBe(5);
      const rows = JSON.parse(JSON.stringify(backup.data.templates)) as { defaults_json: string }[];
      expect(rows.map(row => JSON.parse(row.defaults_json).reviewType)).toEqual([...reviewTypes]);
    } finally { db.close(); }
  });
  it.each(reviewTypes)("offers an independent %s preset and applies its exact period", type => {
    const template = builtInTemplates.find(item => item.id === "default-review-" + type)!;
    const structure = reviewStructureFromTemplate(template, anchor);
    expect(structure).toMatchObject(reviewPeriod(type, anchor));
    const copy = cloneTemplateDefaults(template.defaults);
    (copy.reviewFields as { label: string }[])[0].label = "changed";
    expect(structure.template.fields[0].label).not.toBe("changed");
    expect(template.defaults).not.toEqual(copy);
  });
  it("rejects incomplete, mixed, corrupt and duplicate field definitions", () => {
    const values = reviewTemplateDefaults("weekly");
    for (const invalid of [
      { reviewType: "wrong", reviewFields: [] }, { reviewType: "weekly" },
      { ...values, reflection: "legacy" }, { ...values, reviewFields: [] },
      { ...values, reviewFields: [{ key: "constructor", label: "字段", defaultValue: "" }] },
      { ...values, reviewFields: [{ key: "x", label: "", defaultValue: "" }] },
      { ...values, reviewFields: [{ key: "x", label: "字段", defaultValue: "" }, { key: "x", label: "字段2", defaultValue: "" }] },
    ]) expect(() => validateTemplate("review", "模板", invalid)).toThrow();
    expect(() => validateTemplate("goal", "模板", values)).toThrow();
  });
  it("retains legacy three-field templates", () => {
    const structure = reviewStructureFromTemplate(builtInTemplates.find(item => item.id === "default-review")!, anchor);
    expect(Object.keys(structure.answers)).toEqual(["reflection", "insight", "nextFocus"]);
    expect(structure.answers.reflection).toBe("这段时间发生了什么？");
  });
  it("persists versions without modifying previously saved review snapshots", async () => {
    const value = await setup();
    const first = await value.templateService.save("review", "月度模板", { reviewType: "monthly", reviewFields: [{ key: "facts", label: "原事实", defaultValue: "初始" }] });
    const structure = reviewStructureFromTemplate(first, anchor);
    const saved = await value.reviewService.create({ title: "旧复盘", reflection: "", insight: "", nextFocus: "", reviewedOn: anchor, domainId: null, structure });
    const second = await value.templateService.save("review", "新模板", { reviewType: "annual", reviewFields: [{ key: "newFacts", label: "新事实", defaultValue: "新内容" }] }, first.id);
    expect(second.version).toBe(2);
    expect(reviewStructureFromTemplate(second, anchor)).toMatchObject({ type: "annual", template: { version: 2 } });
    expect((await value.reviewService.list()).find(item => item.id === saved.id)?.structure).toEqual(structure);
  });
  it("edits, reorders, adds and removes fields through the Chinese template center", async () => {
    const value = await setup();
    mount(value, createElement(TemplatesPage));
    await screen.findByText("SMART 目标");
    await screen.findByRole("combobox", { name: "新建目标" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "回顾" }).matches(":disabled")).toBe(false));
    fireEvent.click(screen.getByRole("tab", { name: "回顾" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "复制月复盘" }).matches(":disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "复制月复盘" }));
    fireEvent.change(screen.getByRole("textbox", { name: "模板名称" }), { target: { value: "个人月度" } });
    fireEvent.change(screen.getByRole("textbox", { name: "字段 1 名称" }), { target: { value: "本月事实" } });
    fireEvent.change(screen.getByRole("textbox", { name: "字段 1 默认内容" }), { target: { value: "待补充" } });
    fireEvent.click(screen.getByRole("button", { name: "下移字段 1" }));
    expect(screen.getByRole("textbox", { name: "字段 2 名称" })).toHaveProperty("value", "本月事实");
    fireEvent.click(screen.getByRole("button", { name: "添加字段" }));
    fireEvent.click(screen.getByRole("button", { name: "删除字段 7" }));
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "模板名称" })).toBeNull());
    const saved = (await value.templateService.list()).find(item => item.name === "个人月度")!;
    expect(saved.defaults.reviewType).toBe("monthly");
    expect((saved.defaults.reviewFields as { label: string }[])[1].label).toBe("本月事实");
  });
  it("keeps the draft on save failure and blocks closing during persistence", async () => {
    const value = await setup();
    let fail!: (reason: Error) => void;
    vi.spyOn(value.templateService, "save").mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    mount(value, createElement(TemplatesPage));
    await screen.findByText("SMART 目标");
    await screen.findByRole("combobox", { name: "新建目标" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "回顾" }).matches(":disabled")).toBe(false));
    fireEvent.click(screen.getByRole("tab", { name: "回顾" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "新建模板" }).matches(":disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "新建模板" }));
    fireEvent.change(screen.getByRole("textbox", { name: "模板名称" }), { target: { value: "重试模板" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "取消" }).matches(":disabled")).toBe(true));
    expect(screen.getByRole("button", { name: "关闭编辑" }).matches(":disabled")).toBe(true);
    expect(screen.getByRole("combobox", { name: "模板复盘周期" }).matches(":disabled")).toBe(true);
    expect(screen.getByRole("textbox", { name: "字段 1 名称" }).matches(":disabled")).toBe(true);
    fail(new Error("测试保存失败"));
    await screen.findByText("保存模板失败，请重试。");
    expect(screen.getByRole("textbox", { name: "模板名称" })).toHaveProperty("value", "重试模板");
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "模板名称" })).toBeNull());
    expect((await value.templateService.list()).some(item => item.name === "重试模板")).toBe(true);
  });
  it.each(reviewTypes)("loads %s from template-center links in the review editor", async type => {
    const value = await setup();
    const onSaved = vi.fn();
    mount(value, createElement(ReviewEditorDialog, { domains: [], onClose: vi.fn(), onSaved }), "/reviews?template=default-review-" + type);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "复盘周期" })).toHaveProperty("value", type));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "标题" }).matches(":disabled")).toBe(false));
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "模板复盘" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "保存回顾" }).matches(":disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "保存回顾" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved.mock.calls[0][0].structure).toMatchObject({ type, template: { id: "default-review-" + type, version: 1 } });
  });
});

