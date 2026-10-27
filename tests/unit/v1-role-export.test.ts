import { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { buildContextDocument, exportTypes, scenarioPresets, serializeContext, type ExportRecord } from "../../src/domain/export/ContextExport";
import { builtInTemplates, validateTemplate } from "../../src/domain/templates/Template";
import { ContextExportPage } from "../../src/pages/ContextExportPage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteIdentityRoleRepository } from "../../src/repositories/sqlite/SqliteIdentityRoleRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqlitePrivacyRepository } from "../../src/repositories/sqlite/SqlitePrivacyRepository";
import { ContextExportService } from "../../src/services/export/ContextExportService";
import { IdentityRoleService } from "../../src/services/life/IdentityRoleService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(cleanup);
const clock = { now: () => new Date("2026-10-14T08:00:00Z") };
const filter = { from: "", to: "", domainId: null, goalId: null, types: exportTypes, maxPrivacy: "normal" as const };
const fact = (type: ExportRecord["type"], id: string): ExportRecord => ({
  type, id, title: id + "标题", date: "2026-10-14", privacy: "normal",
  domainIds: [], goalId: null, fields: [], links: [],
});

it("reloads independent role privacy, status and version history in SQLite and preview", async () => {
  for (const mode of ["SQLite", "preview"]) {
    const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    try {
      await new MigrationRunner(sql, migrations, clock).run();
      let sequence = 0;
      const ids = { next: () => "role-export-" + ++sequence };
      const domainRepository = new SqliteLifeDomainRepository(sql);
      const goalRepository = new SqliteGoalRepository(sql);
      const domains = new LifeDomainService(domainRepository, clock, ids);
      const roles = new IdentityRoleService(new SqliteIdentityRoleRepository(sql), domainRepository, goalRepository, clock, ids);
      const domain = await domains.create({ name: "健康专项", description: "", focus: "", color: "fern", icon: "heart" });
      const role = await roles.create({ name: "家庭陪伴者专项", description: "保持陪伴", active: true,
        privacyLevel: "private", domainIds: [domain.id], goalIds: [] });
      const empty = { list: async () => [], listPlanChanges: async () => [], listDefinitions: async () => [], listRecords: async () => [], listSatisfactionLinks: async () => [] };
      const args = [new SqlitePrivacyRepository(sql), domains, empty, empty, empty, empty, empty, empty,
        empty, empty, undefined, undefined, roles] as unknown as ConstructorParameters<typeof ContextExportService>;
      const service = new ContextExportService(...args);
      expect((await service.loadRecords()).find(r => r.type === "role")).toMatchObject({
        title: role.name, privacy: "private", domainIds: [domain.id], goalId: null,
        links: [{ type: "domain", id: domain.id, title: domain.name }],
      });
      await service.setPrivacy("role", role.id, "normal");
      expect(await roles.findById(role.id)).toMatchObject({ privacyLevel: "normal", version: 2 });
      expect((await roles.listHistory(role.id))[0].snapshot).toMatchObject({
        privacy_level: "private", domain_ids: [domain.id], version: 1,
      });
      await roles.setArchived(role.id, true);
      await service.setPrivacy("role", role.id, "highly_sensitive");
      expect((await new ContextExportService(...args).loadRecords()).find(r => r.type === "role")).toMatchObject({
        privacy: "highly_sensitive", fields: expect.arrayContaining([{ label: "状态", value: "已归档" }]),
      });
      expect((await roles.listHistory(role.id))[0].snapshot).toMatchObject({ privacy_level: "normal", version: 3 });
      await expect(service.setPrivacy("role", "missing", "normal")).rejects.toThrow("已不存在");
    } finally { db?.close(); }
  }
});

it("filters explicit multi-goal links, private target names, dates, fields and old templates", () => {
  const goal = fact("goal", "目标一"), otherGoal = fact("goal", "目标二");
  const domain = { ...fact("domain", "私密领域"), privacy: "highly_sensitive" as const };
  const role = { ...fact("role", "私密角色"), privacy: "private" as const, domainIds: [domain.id],
    fields: [{ label: "说明", value: "角色正文" }, { label: "状态", value: "已停用" }],
    links: [goal, otherGoal, domain].map(r => ({ type: r.type as "goal" | "domain", id: r.id, title: r.title })) };
  goal.links = [{ type: "role", id: role.id, title: role.title }];
  const records = [role, goal, otherGoal, domain, fact("role", "无关角色")];
  const renderDocument = (options: Partial<Parameters<typeof buildContextDocument>[2]> = {},
    fields: Parameters<typeof buildContextDocument>[5] = {}) => buildContextDocument(records, "goal-analysis",
    { ...filter, goalId: goal.id, maxPrivacy: "private", ...options }, scenarioPresets["goal-analysis"].sections, "", fields);
  for (const format of ["markdown", "text", "json"] as const) {
    const output = serializeContext(renderDocument(), format);
    expect(output).toContain(role.title);
    expect(output).toContain("已停用");
    expect(output).not.toContain(domain.title);
    expect(output).not.toContain(otherGoal.title);
    expect(output).not.toContain("无关角色标题");
    for (const option of [{ maxPrivacy: "normal" as const }, { from: "2026-10-15" },
      { types: exportTypes.filter(t => t !== "role") }, { goalId: "missing" }, { domainId: "missing" }]) {
      expect(serializeContext(renderDocument(option), format)).not.toContain(role.title);
    }
    expect(serializeContext(renderDocument({}, { role: ["状态"] }), format)).not.toContain("角色正文");
    expect(serializeContext(renderDocument({ types: ["role"] }), format)).not.toContain(goal.title);
    if (format === "json") expect(output).not.toContain('"id"');
  }
  expect(renderDocument({ goalId: otherGoal.id }).sections.find(s => s.type === "role")?.records).toHaveLength(1);
  for (const scenario of ["goal-analysis", "life-domain", "period-review", "issue-diagnosis", "major-decision"] as const) {
    const template = builtInTemplates.find(t => t.id === "default-export-" + scenario)!;
    expect(() => validateTemplate("export", template.name, template.defaults)).not.toThrow();
    const old = { ...template.defaults, sections: (template.defaults.sections as string[]).filter(t => t !== "role"),
      fields: { goal: ["说明"] } };
    expect(() => validateTemplate("export", template.name, old)).not.toThrow();
    const doc = buildContextDocument(records, scenario, { ...filter, maxPrivacy: "private" },
      old.sections as ExportRecord["type"][], "", old.fields);
    expect(serializeContext(doc, "json")).not.toContain(role.title);
  }
});

it("shows Chinese role export controls and saves privacy through the role service", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  const role = await app.identityRoleService.create({ name: "导出界面角色专项", description: "角色说明专项",
    privacyLevel: "private", active: true, domainIds: [], goalIds: [] });
  render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider,
    { value: app as unknown as LifeOSContextValue }, createElement(ContextExportPage))));
  const privacy = await screen.findByLabelText("身份角色 导出界面角色专项 的隐私等级");
  expect(document.querySelector(".export-preview")?.textContent).not.toContain(role.name);
  fireEvent.change(screen.getByLabelText("允许纳入的最高隐私等级"), { target: { value: "private" } });
  await waitFor(() => expect(document.querySelector(".export-preview")?.textContent).toContain(role.name));
  expect((screen.getByRole("button", { name: "下载" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("我已查看预览，确认包含私密记录"));
  expect((screen.getByRole("button", { name: "下载" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.change(privacy, { target: { value: "normal" } });
  await waitFor(() => expect((screen.getByLabelText("身份角色 导出界面角色专项 的隐私等级") as HTMLSelectElement).value).toBe("normal"));
  expect(await app.identityRoleService.findById(role.id)).toMatchObject({ privacyLevel: "normal", version: 2 });
  expect((await app.identityRoleService.listHistory(role.id))[0].snapshot.privacy_level).toBe("private");
});
