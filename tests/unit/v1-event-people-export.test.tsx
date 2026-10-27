import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import {
  buildContextDocument, exportTypes, scenarioPresets, serializeContext,
  type ExportFilter, type ExportRecord, type ExportScenario,
} from "../../src/domain/export/ContextExport";
import { localDate } from "../../src/domain/habits/Habit";
import type { LifeEvent, Person } from "../../src/domain/records/LifeRecords";
import { builtInTemplates, validateTemplate } from "../../src/domain/templates/Template";
import { ContextExportPage } from "../../src/pages/ContextExportPage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteLifeRecordsRepository } from "../../src/repositories/sqlite/SqliteLifeRecordsRepository";
import { SqlitePrivacyRepository } from "../../src/repositories/sqlite/SqlitePrivacyRepository";
import { ContextExportService } from "../../src/services/export/ContextExportService";
import { LifeRecordsService } from "../../src/services/records/LifeRecordsService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(cleanup);
const clock = { now: () => new Date("2026-10-20T08:00:00Z") };
const filter: ExportFilter = {
  from: "", to: "", domainId: null, goalId: null, types: exportTypes, maxPrivacy: "private",
};
const person: Person = {
  id: "person-internal-id", name: "人物导出专项", relationshipType: "朋友", state: "保持联系",
  importantDate: "2026-10-10", lastContact: "2026-10-12", sharedExperiences: "一起参加课程",
  notes: "原始备注", domainIds: ["relationships"], archived: false,
  createdAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-19T23:30:00Z",
};
const event: LifeEvent = {
  id: "event-internal-id", title: "事件导出专项", happenedOn: "2026-10-12",
  description: "已保存的事件说明", personId: person.id, goalId: "goal-internal-id",
  domainIds: ["relationships"], archived: false,
  createdAt: "2026-10-13T08:00:00Z", updatedAt: "2026-10-20T08:00:00Z",
};
const empty = {
  list: async () => [], listPlanChanges: async () => [],
  listDefinitions: async () => [], listRecords: async () => [], listSatisfactionLinks: async () => [],
};
function serviceFor(
  life: Pick<LifeRecordsService, "listPeople" | "listEvents" | "listSkills"> = {
    listPeople: async () => [person], listEvents: async () => [event], listSkills: async () => [],
  },
  levels: ReadonlyMap<string, string> = new Map(),
  contents: readonly string[] = [],
) {
  const args = [
    { list: async () => levels },
    { list: async () => [{ id: "relationships", name: "关系领域", status: "active", createdAt: "2026-10-01" }] },
    { list: async () => [{
      id: event.goalId, title: "关联目标专项", description: "", status: "active",
      targetDate: null, domainIds: ["work"], createdAt: "2026-10-01T08:00:00Z",
    }] },
    empty, empty, { list: async () => contents.map((content, index) => ({
      id: `inbox-${index}`, content, status: "unprocessed", createdAt: "2026-10-20T08:00:00Z",
    })) }, empty, empty, empty, empty, life,
  ] as unknown as ConstructorParameters<typeof ContextExportService>;
  return new ContextExportService(...args);
}
const build = (records: readonly ExportRecord[], scenario: ExportScenario = "goal-analysis",
  options: Partial<ExportFilter> = {}, fields: Parameters<typeof buildContextDocument>[5] = {}) =>
  buildContextDocument(records, scenario, { ...filter, ...options }, scenarioPresets[scenario].sections, "", fields);
const fact = (type: ExportRecord["type"], id: string): ExportRecord => ({
  type, id, title: `${id}独立名称`, date: "2026-10-12", privacy: "private",
  domainIds: ["relationships"], goalId: null, fields: [], links: [],
});

it("loads original event and person fields without inheriting goal domains or changing dates", async () => {
  const records = await serviceFor().loadRecords();
  expect(records.find(r => r.type === "event")).toMatchObject({
    date: event.happenedOn, privacy: "private", domainIds: event.domainIds, goalId: event.goalId,
    fields: expect.arrayContaining([
      { label: "发生日期", value: "2026-10-12" }, { label: "事件说明", value: event.description },
      { label: "记录更新时间", value: event.updatedAt },
    ]),
    links: expect.arrayContaining([{ type: "person", id: person.id, title: person.name },
      { type: "goal", id: event.goalId, title: "关联目标专项" }]),
  });
  expect(records.find(r => r.type === "person")).toMatchObject({
    date: localDate(new Date(person.updatedAt)), domainIds: person.domainIds,
    fields: expect.arrayContaining([
      { label: "重要日期", value: person.importantDate }, { label: "最近联系日期", value: person.lastContact },
      { label: "共同经历", value: person.sharedExperiences }, { label: "记录更新时间", value: person.updatedAt },
    ]),
    links: expect.arrayContaining([{ type: "event", id: event.id, title: event.title }]),
  });
  const scoped = build(records, "goal-analysis", { domainId: "work" });
  expect(scoped.sections.find(s => s.type === "event")?.records).toHaveLength(0);
  expect(scoped.sections.find(s => s.type === "person")?.records).toHaveLength(0);
  expect(build(records, "goal-analysis", { goalId: event.goalId })
    .sections.find(s => s.type === "person")?.records).toHaveLength(1);
});

it("exports explicit birthdays and named dates only within selected person fields and privacy", async () => {
  const datedPerson: Person = { ...person, dates: [
    { kind: "birthday", label: "生日", date: "1990-02-28" },
    { kind: "important", label: "第一次合作", date: "2024-02-29" },
    { kind: "important", label: "毕业", date: "2025-06-01" },
  ] };
  const life = { listPeople: async () => [datedPerson], listEvents: async () => [],
    listSkills: async () => [] };
  const records = await serviceFor(life).loadRecords();
  expect(records.find(record => record.type === "person")).toMatchObject({
    date: localDate(new Date(person.updatedAt)), fields: expect.arrayContaining([
      { label: "重要日期", value: person.importantDate },
      { label: "生日", value: "1990-02-28" },
      { label: "其他重要日期", value: "第一次合作：2024-02-29\n毕业：2025-06-01" },
    ]),
  });
  for (const format of ["markdown", "text", "json"] as const) {
    const output = serializeContext(build(records, "life-domain"), format);
    expect(output).toContain("1990-02-28");
    expect(output).toContain("第一次合作");
    expect(output).toContain("2024-02-29");
    const selected = serializeContext(build(records, "life-domain", {},
      { person: ["重要日期"] }), format);
    expect(selected).toContain(person.importantDate);
    expect(selected).not.toContain("1990-02-28");
    expect(selected).not.toContain("第一次合作");
    for (const options of [
      { maxPrivacy: "normal" as const }, { types: ["event"] as const },
      { domainId: "work" }, { to: "2026-10-01" },
      { from: "1990-02-28", to: "1990-02-28" },
    ]) {
      const document = build(records, "life-domain", options);
      expect(document.sections.find(section => section.type === "person")?.records ?? []).toHaveLength(0);
      const excluded = serializeContext(document, format);
      expect(excluded).not.toContain(person.name);
      if (!("from" in options)) expect(excluded).not.toContain("1990-02-28");
      expect(excluded).not.toContain("第一次合作");
    }
  }
  const sensitive = await serviceFor(life,
    new Map([["person:" + person.id, "highly_sensitive"]])).loadRecords();
  expect(serializeContext(build(sensitive, "life-domain"), "text")).not.toContain("1990-02-28");
  const legacy = (await serviceFor().loadRecords()).find(record => record.type === "person")!;
  expect(legacy.fields.some(field => field.label === "生日")).toBe(false);
});

it("exports events independently of withheld parent facts without serializing internal IDs", async () => {
  const levels = new Map([["event:" + event.id, "normal"],
    ["goal:" + event.goalId, "highly_sensitive"], ["person:" + person.id, "highly_sensitive"]]);
  const records = await serviceFor(undefined, levels).loadRecords();
  for (const options of [
    { maxPrivacy: "normal" as const }, { types: ["event"] as const },
    { from: "2026-10-12", to: "2026-10-12" },
  ]) {
    for (const format of ["markdown", "text", "json"] as const) {
      const output = serializeContext(build(records, "goal-analysis", options), format);
      expect(output).toContain(event.title);
      expect(output).toContain(event.description);
      expect(output).not.toContain(person.name);
      expect(output).not.toContain("关联目标专项");
      for (const id of [event.id, person.id, event.goalId!]) expect(output).not.toContain(id);
      if (format === "json") expect(output).not.toContain('"id"');
    }
  }
  levels.set("event:" + event.id, "highly_sensitive");
  expect(serializeContext(build(await serviceFor(undefined, levels).loadRecords()), "text"))
    .not.toContain(event.title);
});

it("admits only explicit referenced people in goal and decision exports", () => {
  const referenced = { ...fact("person", "referenced"), domainIds: ["elsewhere"] };
  const unrelated = fact("person", "unrelated");
  const recorded = { ...fact("event", "recorded"), goalId: "g",
    links: [{ type: "person" as const, id: referenced.id, title: referenced.title }] };
  for (const options of [
    {}, { types: exportTypes.filter(t => t !== "event") }, { from: "2026-10-13" },
    { domainId: "missing" }, { goalId: "another" },
  ]) {
    const output = serializeContext(build([recorded, referenced, unrelated], "goal-analysis", options), "text");
    expect(output.includes(referenced.title)).toBe(Object.keys(options).length === 0);
    expect(output).not.toContain(unrelated.title);
  }
  const hidden = { ...recorded, privacy: "highly_sensitive" as const };
  expect(serializeContext(build([hidden, referenced, unrelated]), "text")).not.toContain(referenced.title);
  expect(serializeContext(build([recorded, referenced, unrelated], "major-decision"), "text"))
    .not.toContain(referenced.title);
});

it("filters direct people summaries and event backlinks by scenario, dates, types and privacy", () => {
  const recorded = fact("event", "dated-event");
  const direct = { ...fact("person", "direct-person"),
    links: [{ type: "event" as const, id: recorded.id, title: recorded.title }] };
  for (const scenario of ["inbox-triage", "life-domain", "period-review"] as const) {
    expect(build([direct], scenario).sections.find(s => s.type === "person")?.records).toHaveLength(1);
    for (const options of [
      { from: "2026-10-13" }, { to: "2026-10-11" }, { domainId: "elsewhere" },
      { goalId: "unrelated" }, { types: exportTypes.filter(t => t !== "person") },
    ]) {
      expect(serializeContext(build([direct], scenario, options), "text")).not.toContain(direct.title);
    }
    expect(serializeContext(build([{ ...direct, privacy: "highly_sensitive" }], scenario), "text"))
      .not.toContain(direct.title);
  }
  expect(serializeContext(build([direct, recorded], "life-domain"), "text")).toContain("关联事件");
  for (const candidate of [
    { ...recorded, privacy: "highly_sensitive" as const },
    { ...recorded, date: "2026-10-11" },
    { ...recorded, domainIds: ["elsewhere"] },
  ]) {
    const output = serializeContext(build([direct, candidate], "life-domain",
      { from: "2026-10-12", domainId: "relationships" }), "text");
    expect(output).toContain(direct.title);
    expect(output).not.toContain(candidate.title);
    expect(output).not.toContain("关联事件");
  }
  expect(serializeContext(build([direct, recorded], "life-domain", { types: ["person"] }), "json"))
    .not.toContain(recorded.title);
});

it("preserves explicit old templates and supports event/person field omission and ordering", async () => {
  const records = await serviceFor().loadRecords();
  for (const scenario of ["goal-analysis", "period-review", "life-domain", "issue-diagnosis"] as const) {
    const template = builtInTemplates.find(t => t.id === `default-export-${scenario}`)!;
    expect(() => validateTemplate("export", template.name, template.defaults)).not.toThrow();
    const sections = scenarioPresets[scenario].sections.filter(t => t !== "event");
    const fields = { person: ["关系类型", "关系状态", "备注", "状态"] };
    const old = validateTemplate("export", template.name, { ...template.defaults, sections, fields });
    expect(old.defaults.sections).toEqual(sections);
    expect(old.defaults.fields).toEqual(fields);
    const document = buildContextDocument(records, scenario, filter, sections, "", fields);
    expect(serializeContext(document, "text")).not.toContain(event.title);
    expect(serializeContext(document, "text")).not.toContain(person.sharedExperiences);
    const current = build(records, scenario, {}, { event: ["事件说明", "发生日期"], person: ["共同经历"] });
    expect(current.sections.find(s => s.type === "event")?.records[0].fields).toEqual([
      { label: "事件说明", value: event.description }, { label: "发生日期", value: event.happenedOn },
    ]);
  }
});

it("exports Chinese inbox classifications for all seven targets and leaves unknown facts blank", async () => {
  const records = await serviceFor(undefined, new Map(), [
    "希望完成目标", "记得去做", "回顾这一周", "遇到问题", "要不要选择", "发生了重要事件", "认识了新朋友", "随手一笔",
  ]).loadRecords();
  expect(records.filter(r => r.type === "inbox").map(r =>
    r.fields.find(f => f.label === "规则建议分类")?.value))
    .toEqual(["目标", "行动", "回顾", "问题", "决策", "事件", "人物", ""]);
});

it("reports recoverable Chinese read failures instead of silently omitting life records", async () => {
  for (const [method, label] of [
    ["listPeople", "人物"], ["listSkills", "能力"], ["listEvents", "事件"],
  ] as const) {
    const life = { listPeople: async () => [person], listSkills: async () => [],
      listEvents: async () => [event],
      [method]: async () => { throw new Error("C:\\private\\lifeos.db SELECT"); } };
    await expect(serviceFor(life).loadRecords()).rejects.toThrow(`无法读取${label}记录，请重新读取后再试。`);
  }
});

describe("event/person export persisted privacy", () => {
  for (const mode of ["SQLite", "preview"]) it(mode + " preserves independent privacy across edits and archives", async () => {
    const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
    const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
    try {
      if (db) db.exec("PRAGMA foreign_keys=ON");
      await new MigrationRunner(sql, migrations, clock).run();
      let sequence = 0;
      const life = new LifeRecordsService(new SqliteLifeRecordsRepository(sql), new SqliteLifeDomainRepository(sql),
        new SqliteGoalRepository(sql), clock, { next: () => `life-${++sequence}` });
      const savedPerson = await life.savePerson({ ...person, domainIds: [] });
      const savedEvent = await life.saveEvent({ ...event, personId: savedPerson.id, goalId: null, domainIds: [] });
      const args = [new SqlitePrivacyRepository(sql), empty, empty, empty, empty, empty, empty, empty,
        empty, empty, life] as unknown as ConstructorParameters<typeof ContextExportService>;
      const service = new ContextExportService(...args);
      expect((await service.loadRecords()).every(r => r.privacy === "private")).toBe(true);
      await service.setPrivacy("event", savedEvent.id, "normal");
      await service.setPrivacy("person", savedPerson.id, "highly_sensitive");
      await life.saveEvent({ ...savedEvent, description: "修改后的事件说明" }, savedEvent.id);
      await life.savePerson({ ...savedPerson, sharedExperiences: "修改后的共同经历" }, savedPerson.id);
      await life.setArchived("life_events", savedEvent.id, true);
      await life.setArchived("people", savedPerson.id, true);
      const records = await new ContextExportService(...args).loadRecords();
      expect(records.find(r => r.type === "event")).toMatchObject({
        privacy: "normal", date: event.happenedOn, fields: expect.arrayContaining([
          { label: "事件说明", value: "修改后的事件说明" }, { label: "状态", value: "已归档" },
        ]),
      });
      expect(records.find(r => r.type === "person")?.privacy).toBe("highly_sensitive");
      expect(serializeContext(build(records, "life-domain", { maxPrivacy: "normal" }), "text"))
        .not.toContain(person.name);
      await life.setArchived("life_events", savedEvent.id, false);
      expect((await service.loadRecords()).find(r => r.type === "event")?.privacy).toBe("normal");
      await expect(service.setPrivacy("event", "missing", "normal")).rejects.toThrow("已不存在");
      if (db) {
        expect(db.prepare("SELECT privacy_level FROM life_events WHERE id = ?").get(savedEvent.id))
          .toEqual({ privacy_level: "normal" });
        expect(() => db.prepare("UPDATE life_events SET privacy_level = 'invalid' WHERE id = ?")
          .run(savedEvent.id)).toThrow();
      }
    } finally { db?.close(); }
  });
});

it("provides Chinese event privacy/type and person field controls with preview-bound confirmation", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  const savedPerson = await app.lifeRecordsService.savePerson({ ...person, domainIds: [] });
  await app.lifeRecordsService.saveEvent({ ...event, personId: savedPerson.id, goalId: null, domainIds: [] });
  render(<MemoryRouter><LifeOSContext.Provider value={app as unknown as LifeOSContextValue}>
    <ContextExportPage />
  </LifeOSContext.Provider></MemoryRouter>);
  await screen.findByLabelText(`重要事件 ${event.title} 的隐私等级`);
  const preview = () => document.querySelector(".export-preview")?.textContent ?? "";
  expect(preview()).not.toContain(event.title);
  expect(screen.getByLabelText("重要事件")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("允许纳入的最高隐私等级"), { target: { value: "private" } });
  await waitFor(() => expect(preview()).toContain(person.sharedExperiences));
  expect(preview()).toContain(event.happenedOn);
  expect((screen.getByRole("button", { name: "下载" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("我已查看预览，确认包含私密记录"));
  expect((screen.getByRole("button", { name: "下载" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByLabelText("移除关联人物的共同经历"));
  expect(preview()).not.toContain(person.sharedExperiences);
  expect((screen.getByRole("button", { name: "下载" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("重要事件"));
  expect(preview()).not.toContain(event.title);
  expect(preview()).not.toContain(person.name);
  fireEvent.click(screen.getByLabelText("重要事件"));
  fireEvent.change(screen.getByLabelText(`重要事件 ${event.title} 的隐私等级`),
    { target: { value: "highly_sensitive" } });
  await waitFor(() => expect((screen.getByLabelText(`重要事件 ${event.title} 的隐私等级`) as HTMLSelectElement)
    .value).toBe("highly_sensitive"));
  expect(preview()).not.toContain(event.title);
  expect(preview()).not.toContain(person.name);
});
