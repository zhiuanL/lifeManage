import { expect, it } from "vitest";
import { buildContextDocument, exportTypes, scenarioPresets, serializeContext, type ExportRecord } from "../../src/domain/export/ContextExport";
import { ContextExportService } from "../../src/services/export/ContextExportService";

const filter = { from: "", to: "", domainId: "d", goalId: null, types: [...exportTypes], maxPrivacy: "private" as const };
const record = (type: ExportRecord["type"], id: string): ExportRecord => ({
  type, id, title: id + "正文", date: "2026-10-12", privacy: "private", domainIds: ["d"], goalId: null, fields: [], links: [],
});
const resource = { ...record("resource", "资源缺口"), links: [{ type: "person" as const, id: "人物", title: "人物正文" }] };
const decision = { ...record("decision", "决策"), fields: [{ label: "重要程度", value: "重大" }],
  links: [{ type: "resource" as const, id: resource.id, title: resource.title }, { type: "resource" as const, id: resource.id, title: resource.title }] };

it("exports only explicitly referenced resources and visible people in all formats", () => {
  const person = record("person", "人物");
  for (const change of [{}, { maxPrivacy: "normal" as const }, { types: exportTypes.filter(t => t !== "resource") },
    { types: exportTypes.filter(t => t !== "decision") }, { domainId: "other" }, { goalId: "other" }, { from: "2026-10-13" }]) {
    const document = buildContextDocument([decision, resource, person, record("resource", "无关资源")], "major-decision",
      { ...filter, ...change }, scenarioPresets["major-decision"].sections, "");
    expect(document.sections.find(s => s.type === "resource")?.records.length).toBe(Object.keys(change).length ? 0 : 1);
    for (const format of ["markdown", "text", "json"] as const) {
      const output = serializeContext(document, format);
      expect(output.includes(resource.title)).toBe(!Object.keys(change).length);
      expect(output.includes(person.title)).toBe(!Object.keys(change).length);
      expect(output).not.toContain("无关资源正文");
      if (format === "json") expect(output).not.toContain(String.fromCharCode(34) + "id" + String.fromCharCode(34));
    }
  }
});

it("does not admit resources from hidden owners or leak withheld references", () => {
  for (const hidden of ["decision", "resource", "person"] as const) {
    const records = [decision, resource, record("person", "人物")].map(r => r.type === hidden ? { ...r, privacy: "highly_sensitive" as const } : r);
    const document = buildContextDocument(records, "major-decision", filter, scenarioPresets["major-decision"].sections, "", { resource: ["具备情况"] });
    for (const format of ["markdown", "text", "json"] as const) {
      const output = serializeContext(document, format);
      expect(output).not.toContain("人物正文");
      if (hidden !== "person") expect(output).not.toContain(resource.title);
    }
  }
});

it("loads independent privacy, goal and decision ownership, references and live resource facts", async () => {
  const empty = { list: async () => [], listPlanChanges: async () => [], listDefinitions: async () => [], listRecords: async () => [], listSatisfactionLinks: async () => [] };
  const goal = { id: "g", title: "目标", createdAt: "2026-10-12", domainIds: ["d"], status: "active", description: "", targetDate: null };
  const choice = { id: "c", title: "选择", decidedOn: "2026-10-12", domainIds: ["d"], goalId: null, importance: "major", reversibility: "unknown", resourceNeedIds: ["n"] };
  const need = { id: "n", goalId: "g", decisionId: null, description: "每周两小时", kind: "time", met: false, updatedAt: "2026-10-12" };
  const owned = { ...need, id: "own", goalId: null, decisionId: "c" };
  const levels = new Map([["goal:g", "private"], ["decision:c", "normal"], ["resource:own", "normal"]]);
  const args = [{ list: async () => levels }, empty, { list: async () => [goal] }, empty, empty, empty, empty,
    { list: async () => [choice] }, empty, empty, undefined, { list: async () => [need, owned] }] as unknown as ConstructorParameters<typeof ContextExportService>;
  const service = new ContextExportService(...args);
  let records = await service.loadRecords();
  expect(records.find(r => r.id === "n")).toMatchObject({ privacy: "private", goalId: "g", fields: expect.arrayContaining([{ label: "具备情况", value: "待补齐" }]) });
  expect(records.find(r => r.id === "own")).toMatchObject({ privacy: "normal", goalId: null });
  expect(records.find(r => r.id === "c")?.links.filter(l => l.type === "resource")).toHaveLength(2);
  need.met = true;
  levels.set("goal:g", "highly_sensitive");
  records = await service.loadRecords();
  expect(records.find(r => r.id === "n")?.privacy).toBe("private");
  levels.set("resource:n", "highly_sensitive");
  records = await service.loadRecords();
  expect(records.find(r => r.id === "n")).toMatchObject({ privacy: "highly_sensitive", fields: expect.arrayContaining([{ label: "具备情况", value: "已具备" }]) });
  const document = buildContextDocument(records, "major-decision", filter, scenarioPresets["major-decision"].sections, "");
  expect(document.sections.find(s => s.type === "resource")?.records.map(r => r.id)).toEqual(["own"]);
  expect(() => buildContextDocument(records, "goal-analysis", filter, ["goal", "action"], "")).not.toThrow();
});
