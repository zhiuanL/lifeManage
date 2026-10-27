import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { buildContextDocument, exportTypes, scenarioPresets, serializeContext, type ExportRecord } from "../../src/domain/export/ContextExport";
import { builtInTemplates, validateTemplate } from "../../src/domain/templates/Template";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteLifeRecordsRepository } from "../../src/repositories/sqlite/SqliteLifeRecordsRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqlitePrivacyRepository } from "../../src/repositories/sqlite/SqlitePrivacyRepository";
import { LifeRecordsService } from "../../src/services/records/LifeRecordsService";
import { ContextExportService } from "../../src/services/export/ContextExportService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const clock = { now: () => new Date("2026-10-12T08:00:00Z") };
const filter = { from: "", to: "", domainId: "d", goalId: null, types: exportTypes, maxPrivacy: "private" as const };
const fact = (type: ExportRecord["type"], id: string): ExportRecord => ({
  type, id, title: id + " title", date: "2026-10-12", privacy: "private", domainIds: ["d"], goalId: null, fields: [], links: [],
});

it("scopes referenced skills without exposing withheld names or IDs in any format", () => {
  const skill = { ...fact("skill", "required-skill"), domainIds: ["other"] };
  const resource = { ...fact("resource", "need"), links: [{ type: "skill" as const, id: skill.id, title: skill.title }] };
  const decision = { ...fact("decision", "choice"), fields: [{ label: "重要程度", value: "重大" }],
    links: [{ type: "resource" as const, id: resource.id, title: resource.title }] };
  for (const hidden of [null, "skill", "resource", "decision"] as const) {
    const records = [skill, resource, decision, fact("skill", "unrelated")].map(r =>
      r.type === hidden ? { ...r, privacy: "highly_sensitive" as const } : r);
    for (const change of [{}, { types: exportTypes.filter(t => t !== "skill") }, { domainId: "missing" }, { from: "2026-10-13" }]) {
      const document = buildContextDocument(records, "major-decision", { ...filter, ...change }, scenarioPresets["major-decision"].sections, "");
      for (const format of ["markdown", "text", "json"] as const) {
        const output = serializeContext(document, format);
        expect(output.includes(skill.title)).toBe(hidden === null && Object.keys(change).length === 0);
        expect(output).not.toContain("unrelated title");
        if (format === "json") expect(output).not.toContain("\"id\"");
      }
    }
  }
});

it("supports direct goal, domain and period facts, archive state and old field selections", () => {
  const skill = { ...fact("skill", "direct"), goalId: "g", fields: [{ label: "状态", value: "已归档" }] };
  for (const scenario of ["goal-analysis", "life-domain", "period-review"] as const) {
    const document = buildContextDocument([skill, { ...skill, id: "outside", domainIds: ["other"], goalId: "other" }],
      scenario, { ...filter, goalId: "g" }, scenarioPresets[scenario].sections, "", { skill: ["状态"] });
    expect(document.sections.find(s => s.type === "skill")?.records).toHaveLength(1);
    expect(serializeContext(document, "text")).toContain("已归档");
    const template = builtInTemplates.find(t => t.id === "default-export-" + scenario)!;
    expect(() => validateTemplate("export", template.name, template.defaults)).not.toThrow();
    const old = { ...template.defaults, sections: (template.defaults.sections as string[]).filter(t => t !== "skill"), fields: {} };
    expect(() => validateTemplate("export", template.name, old)).not.toThrow();
  }
});

it("loads resource skill references, goal-derived domains and independent privacy", async () => {
  const empty = { list: async () => [], listPlanChanges: async () => [], listDefinitions: async () => [], listRecords: async () => [], listSatisfactionLinks: async () => [] };
  const goal = { id: "g", title: "目标", createdAt: "2026-10-12", domainIds: ["d"], status: "active", description: "", targetDate: null };
  const skill = { id: "s", name: "写作能力", updatedAt: "2026-10-12", domainIds: [], goalId: "g", currentLevel: 2, targetLevel: 4, archived: false };
  const need = { id: "n", goalId: "g", decisionId: null, skillId: "s", description: "写作支持", kind: "skill", met: false, updatedAt: "2026-10-12" };
  const levels = new Map([["goal:g", "normal"], ["resource:n", "normal"], ["skill:s", "normal"]]);
  const args = [{ list: async () => levels }, empty, { list: async () => [goal] }, empty, empty, empty, empty, empty, empty, empty,
    { listPeople: async () => [], listSkills: async () => [skill], listEvents: async () => [] },
    { list: async () => [need] }] as unknown as ConstructorParameters<typeof ContextExportService>;
  const service = new ContextExportService(...args);
  let records = await service.loadRecords();
  expect(records.find(r => r.type === "resource")?.links).toContainEqual({ type: "skill", id: "s", title: "写作能力" });
  expect(records.find(r => r.type === "skill")).toMatchObject({ domainIds: ["d"], privacy: "normal", goalId: "g" });
  const render = (facts: readonly ExportRecord[]) => serializeContext(buildContextDocument(facts, "goal-analysis",
    { ...filter, goalId: "g", maxPrivacy: "normal" }, scenarioPresets["goal-analysis"].sections, ""), "text");
  expect(render(records)).toContain("写作能力");
  levels.set("skill:s", "highly_sensitive");
  records = await service.loadRecords();
  expect(records.find(r => r.type === "resource")?.privacy).toBe("normal");
  expect(render(records)).not.toContain("写作能力");
  levels.set("skill:s", "normal");
  skill.goalId = "missing";
  need.skillId = "missing";
  records = await service.loadRecords();
  expect(records.find(r => r.type === "resource")?.links.some(l => l.type === "skill")).toBe(false);
  expect(render(records)).not.toContain("写作能力");
});

describe("skill export persisted privacy", () => {
  for (const mode of ["SQLite", "preview"]) it(mode + " preserves privacy across edits, archives and service rereads", async () => {
    const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    try {
      if (db) db.exec("PRAGMA foreign_keys=ON");
      await new MigrationRunner(sql, migrations, clock).run();
      const life = new LifeRecordsService(new SqliteLifeRecordsRepository(sql), new SqliteLifeDomainRepository(sql),
        new SqliteGoalRepository(sql), clock, { next: () => "skill-1" });
      const skill = await life.saveSkill({ name: "写作", currentLevel: 2, targetLevel: 4, learningPath: "每周练习",
        practice: "完成文章", reflection: "检查结构", goalId: null, domainIds: [] });
      const empty = { list: async () => [], listPlanChanges: async () => [], listDefinitions: async () => [], listRecords: async () => [], listSatisfactionLinks: async () => [] };
      const deps = [new SqlitePrivacyRepository(sql), empty, empty, empty, empty, empty, empty, empty, empty, empty, life] as unknown as ConstructorParameters<typeof ContextExportService>;
      const service = new ContextExportService(...deps);
      expect((await service.loadRecords()).find(r => r.type === "skill")).toMatchObject({ privacy: "private" });
      await service.setPrivacy("skill", skill.id, "highly_sensitive");
      await life.saveSkill({ ...skill, currentLevel: 3 }, skill.id);
      await life.setArchived("skills", skill.id, true);
      const reread = (await new ContextExportService(...deps).loadRecords()).find(r => r.type === "skill");
      expect(reread).toMatchObject({ privacy: "highly_sensitive", fields: expect.arrayContaining([
        { label: "当前水平", value: "3" }, { label: "目标水平", value: "4" }, { label: "学习路径", value: "每周练习" },
        { label: "练习或成果", value: "完成文章" }, { label: "复盘", value: "检查结构" }, { label: "状态", value: "已归档" },
      ]) });
      await expect(service.setPrivacy("skill", "missing", "normal")).rejects.toThrow("不存在");
      await service.setPrivacy("skill", skill.id, "normal");
      expect((await service.loadRecords()).find(r => r.type === "skill")?.privacy).toBe("normal");
    } finally { db?.close(); }
  });
});
