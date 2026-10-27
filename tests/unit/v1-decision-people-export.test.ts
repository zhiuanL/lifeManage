import { expect, it } from "vitest";
import { buildContextDocument, exportTypes, scenarioPresets, serializeContext, type ExportRecord } from "../../src/domain/export/ContextExport";
const person: ExportRecord = { type: "person", id: "secret-person-id", title: "私密人物甲", date: "2026-10-12", privacy: "private", domainIds: [], goalId: null, fields: [{label: "备注", value: "私密备注"}], links: [] };
const decision: ExportRecord = { type: "decision", id: "decision-id", title: "选择", date: "2026-10-12", privacy: "normal", domainIds: ["d"], goalId: "g", fields: [{label: "重要程度", value: "重大"}], links: [{type: "person", id: person.id, title: person.title}] };
const filter = { from: "", to: "", domainId: "d", goalId: null, types: [...exportTypes], maxPrivacy: "private" as const };
it("includes only people linked to included decisions and strips excluded names and IDs in all formats", () => {
  const unrelated = { ...person, id: "unrelated", title: "无关人物" };
  for (const change of [{}, {maxPrivacy: "normal" as const}, {types: exportTypes.filter(t => t !== "person")}, {types: exportTypes.filter(t => t !== "decision")}, {domainId: "other"}, {goalId: "other"}, {from: "2026-10-13"}]) {
    const doc = buildContextDocument([person, decision, unrelated], "major-decision", {...filter, ...change}, scenarioPresets["major-decision"].sections, "");
    for (const format of ["markdown", "text", "json"] as const) {
      const output = serializeContext(doc, format);
      expect(output.includes(person.title)).toBe(Object.keys(change).length === 0);
      expect(output).not.toContain(person.id); expect(output).not.toContain(unrelated.title);
      expect(output.includes("私密备注")).toBe(Object.keys(change).length === 0);
    }
  }
  for (const records of [[{...person, privacy: "highly_sensitive" as const}, decision], [person, {...decision, privacy: "highly_sensitive" as const}], [{...person, date: "2026-10-01"}, decision]]) {
    const doc = buildContextDocument(records, "major-decision", {...filter, from: "2026-10-12"}, scenarioPresets["major-decision"].sections, "");
    expect(serializeContext(doc, "json")).not.toContain(person.title);
  }
});

