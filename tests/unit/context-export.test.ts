import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { m5PrivacyMigration } from "../../src/db/migrations/0008-m5-privacy";
import { m5MetricPrivacyMigration } from "../../src/db/migrations/0013-m5-metric-privacy";
import {
  buildContextDocument, exportTypes, fieldPresets, scenarioPresets, serializeContext,
  type ExportFilter, type ExportRecord, type ExportScenario,
} from "../../src/domain/export/ContextExport";
import { normalizeActionDetails, actionDetailFields } from "../../src/domain/planning/ActionDetails";
import { builtInTemplates, validateTemplate } from "../../src/domain/templates/Template";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { ContextExportPage } from "../../src/pages/ContextExportPage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqlitePrivacyRepository } from "../../src/repositories/sqlite/SqlitePrivacyRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteDomainMetricRepository } from "../../src/repositories/sqlite/SqliteDomainMetricRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteActionRepository } from "../../src/repositories/sqlite/SqliteActionRepository";
import { SqliteReviewRepository } from "../../src/repositories/sqlite/SqliteReviewRepository";
import { SqliteInboxRepository } from "../../src/repositories/sqlite/SqliteInboxRepository";
import { SqliteIssueRepository } from "../../src/repositories/sqlite/SqliteIssueRepository";
import { SqliteDecisionRepository } from "../../src/repositories/sqlite/SqliteDecisionRepository";
import type { SqliteExecutor } from "../../src/repositories/sqlite/SqliteExecutor";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
import { ContextExportService } from "../../src/services/export/ContextExportService";
import { LifeNavigationService } from "../../src/services/life/LifeNavigationService";
import { SqliteLifeNavigationRepository } from "../../src/repositories/sqlite/SqliteLifeNavigationRepository";
import { SearchService } from "../../src/services/search/SearchService";
import { searchEntries, searchTypes } from "../../src/domain/search/Search";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { DomainMetricService } from "../../src/services/life/DomainMetricService";
import { buildDomainMetricTrends } from "../../src/domain/analytics/DomainMetricTrend";
import { GoalService } from "../../src/services/planning/GoalService";
import { ActionService } from "../../src/services/planning/ActionService";
import { ReviewService } from "../../src/services/reviews/ReviewService";
import { InboxService } from "../../src/services/inbox/InboxService";
import { IssueService } from "../../src/services/issues/IssueService";
import { DecisionService } from "../../src/services/decisions/DecisionService";
import { SqliteLifeRecordsRepository } from "../../src/repositories/sqlite/SqliteLifeRecordsRepository";
import { LifeRecordsService } from "../../src/services/records/LifeRecordsService";

afterEach(cleanup);
const clock = { now: () => new Date("2026-09-23T08:00:00.000Z") };
let nextId = 0;
const ids = { next: () => `export-${++nextId}` };
const filter: ExportFilter = {
  from: "", to: "", domainId: null, goalId: null,
  types: [...exportTypes], maxPrivacy: "normal",
};
const record = (type: ExportRecord["type"], id: string, title: string,
  overrides: Partial<ExportRecord> = {}): ExportRecord => ({
  type, id, title, date: "2026-09-23", domainIds: [], goalId: null,
  privacy: "normal", fields: [{ label: "说明", value: title }],
  links: [], ...overrides,
});
const build = (records: readonly ExportRecord[], scenario: ExportScenario,
  options: ExportFilter = filter) =>
  buildContextDocument(records, scenario, options, scenarioPresets[scenario].sections, "");

function setup(executor: SqliteExecutor) {
  const domains = new SqliteLifeDomainRepository(executor);
  const goals = new SqliteGoalRepository(executor);
  const actions = new SqliteActionRepository(executor);
  const reviews = new SqliteReviewRepository(executor);
  const issues = new SqliteIssueRepository(executor);
  const decisions = new SqliteDecisionRepository(executor);
  const domainService = new LifeDomainService(domains, clock, ids);
  const metricService = new DomainMetricService(
    new SqliteDomainMetricRepository(executor), domains, clock, ids);
  const goalService = new GoalService(goals, domains, clock, ids);
  const actionService = new ActionService(actions, goals, domains, clock, ids);
  const reviewService = new ReviewService(reviews, domains, clock, ids);
  const issueService = new IssueService(issues, domains, goals, clock, ids);
  const decisionService = new DecisionService(decisions, domains, goals, clock, ids);
  const inboxService = new InboxService(new SqliteInboxRepository(executor),
    domainService, goalService, actionService, reviewService, issueService,
    decisionService, clock, ids,
    new LifeRecordsService(new SqliteLifeRecordsRepository(executor), domains, goals, clock, ids));
  const privacy = new SqlitePrivacyRepository(executor);
  const exportService = new ContextExportService(privacy, domainService, goalService,
    actionService, reviewService, inboxService, issueService, decisionService, metricService,
    new LifeNavigationService(new SqliteLifeNavigationRepository(executor), clock, ids));
  const searchService = new SearchService(domainService, metricService, goalService, actionService,
    reviewService, issueService, decisionService, inboxService);
  return { domainService, goalService, actionService, reviewService, issueService,
    decisionService, inboxService, metricService, privacy, exportService, searchService };
}

describe("M5 context export", () => {
  it("exports only explicitly selected satisfaction with safe privacy links and exact dated facts", async () => {
    const sql = new MemorySqliteExecutor();
    await new MigrationRunner(sql, migrations, clock).run();
    const { domainService, metricService, exportService } = setup(sql);
    const domain = await domainService.create({
      name: "公开领域", description: "", focus: "", color: "fern", icon: "heart",
    });
    const metric = await metricService.createDefinition("私密满意度指标", "个人量纲", [domain.id]);
    const old = await metricService.saveRecord(metric.id, "2026-09-20", 9876, "范围外记录");
    const zero = await metricService.saveRecord(metric.id, "2026-09-23", 0, "范围内零值");
    await exportService.setPrivacy("domain", domain.id, "normal");
    const ordinary = await exportService.loadRecords();
    expect(ordinary.find(item => item.type === "domain")!.links).toEqual([]);
    await metricService.setSatisfactionMetric(domain.id, metric.id);
    const selected = await exportService.loadRecords();
    expect(selected.find(item => item.type === "domain")!.fields
      .some(field => field.value.includes(metric.name) || field.value.includes("9876"))).toBe(false);
    for (const format of ["markdown", "text", "json"] as const) {
      const normal = serializeContext(build(selected, "life-domain", { ...filter, domainId: domain.id }), format);
      expect(normal).toContain(domain.name);
      expect(normal).not.toContain(metric.name);
      expect(normal).not.toContain("9876");
      expect(normal).not.toContain("满意度指标");
    }
    const scoped = build(selected, "life-domain", {
      ...filter, maxPrivacy: "private", domainId: domain.id, from: "2026-09-23", to: "2026-09-23",
    });
    expect(scoped.sections.find(section => section.type === "metric-record")!.records.map(item => item.id))
      .toEqual([zero.id]);
    expect(scoped.sections.find(section => section.type === "domain")!.records[0].fields)
      .toContainEqual({ label: "满意度指标", value: metric.name });
    expect(scoped.sections.find(section => section.type === "metric")!.records[0].fields)
      .toContainEqual({ label: "满意度所属领域", value: domain.name });
    for (const format of ["markdown", "text", "json"] as const) {
      const text = serializeContext(scoped, format);
      expect(text).toContain("范围内零值");
      expect(text).not.toContain("范围外记录");
      expect(text).not.toContain("9876");
      expect(text).not.toContain(old.id);
    }
    const domainOnly = build(selected, "life-domain", { ...filter, maxPrivacy: "private", types: ["domain"] });
    expect(domainOnly.sections.find(section => section.type === "domain")!.records[0].fields
      .some(field => field.label === "满意度指标")).toBe(false);
    await exportService.setPrivacy("metric", metric.id, "normal");
    await exportService.setPrivacy("domain", domain.id, "highly_sensitive");
    const hiddenDomain = serializeContext(build(await exportService.loadRecords(), "life-domain"), "json");
    expect(hiddenDomain).toContain(metric.name);
    expect(hiddenDomain).not.toContain(domain.name);
    expect(hiddenDomain).not.toContain("满意度所属领域");
  });

  it.each(["preview", "sqlite"] as const)(
    "preserves standalone daily metric facts, global sources and privacy across rereads in %s",
    async (adapter) => {
      const db = adapter === "sqlite" ? new DatabaseSync(":memory:") : null;
      try {
        db?.exec("PRAGMA foreign_keys = ON");
        const executor = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
        await new MigrationRunner(executor, migrations, clock).run();
        const { metricService } = setup(executor);
        const metric = await metricService.createDefinition("独立每日状态", "分", []);
        const first = await metricService.saveRecord(metric.id, "2026-09-21", 1, "更正前");
        const last = await metricService.saveRecord(metric.id, "2026-09-23", 2, "最后记录");
        await metricService.saveRecord(metric.id, "2026-09-21", 0, "明确零值", first.id);
        await metricService.setArchived(metric.id, true);
        await expect(metricService.saveRecord(metric.id, "2026-09-24", 3, ""))
          .rejects.toThrow("归档");

        const services = setup(executor);
        const definitions = await services.metricService.listDefinitions();
        const daily = await services.metricService.listRecords();
        expect(definitions).toEqual([{ ...metric, archived: true }]);
        expect(daily.map(item => item.id)).toEqual([last.id, first.id]);
        expect(daily.find(item => item.id === first.id)).toMatchObject({
          value: 0, note: "明确零值", createdAt: first.createdAt,
        });
        expect(daily.some(item => item.recordedOn === "2026-09-22")).toBe(false);
        expect(buildDomainMetricTrends(definitions, daily, null, null, "2026-09-20", "2026-09-23"))
          .toEqual([{ definition: definitions[0], records: [daily[1], daily[0]] }]);

        const domain = await services.domainService.create({
          name: "领域", description: "", focus: "", color: "fern", icon: "heart",
        });
        const goal = await services.goalService.create({ title: "目标", description: "",
          domainId: domain.id, status: "active", targetDate: null });
        expect(buildDomainMetricTrends(definitions, daily, domain.id, null, "2026-09-20", "2026-09-23"))
          .toEqual([]);
        expect(buildDomainMetricTrends(definitions, daily, null, goal.id, "2026-09-20", "2026-09-23"))
          .toEqual([]);
        const search = (await services.searchService.list()).find(item => item.id === metric.id)!;
        expect(search).toMatchObject({ type: "metric", status: "archived", domainIds: [],
          href: `/metrics#metric-${encodeURIComponent(metric.id)}` });

        const exported = await services.exportService.loadRecords();
        expect(exported.filter(item => item.type === "metric-record")).toHaveLength(2);
        expect(exported.filter(item => item.type === "metric" || item.type === "metric-record")
          .every(item => item.privacy === "private" && item.domainIds.length === 0 && item.goalId === null))
          .toBe(true);
        for (const format of ["markdown", "text", "json"] as const) {
          expect(serializeContext(build(exported, "period-review"), format)).not.toContain("独立每日状态");
          const visible = { ...filter, types: ["metric-record"] as ExportFilter["types"], maxPrivacy: "private" as const };
          const global = serializeContext(build(exported, "period-review", visible), format);
          expect(global).toContain("独立每日状态");
          expect(global).toContain("明确零值");
          expect(global).toContain("最后记录");
          expect(serializeContext(build(exported, "period-review", { ...visible, domainId: domain.id }), format))
            .not.toContain("独立每日状态");
          expect(serializeContext(build(exported, "period-review", { ...visible, goalId: goal.id }), format))
            .not.toContain("独立每日状态");
        }
        await services.exportService.setPrivacy("metric", metric.id, "highly_sensitive");
        expect(serializeContext(build(await services.exportService.loadRecords(), "period-review",
          { ...filter, maxPrivacy: "private" }), "json")).not.toContain("独立每日状态");
        await services.metricService.setArchived(metric.id, false);
        expect((await services.metricService.listDefinitions())[0]).toEqual(metric);
        expect(await services.metricService.listRecords()).toHaveLength(2);
        if (db) expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        db?.close();
      }
    },
  );

  it("exports lifecycle reasons under the goal privacy level and searches by new states", async () => {
    const memory = new MemorySqliteExecutor();
    await new MigrationRunner(memory, migrations, clock).run();
    const { goalService, exportService, searchService } = setup(memory);
    const goal = await goalService.create({ title: "调整方向", description: "", domainId: null,
      status: "abandoned", statusReason: "私密的现实约束", targetDate: null });
    const records = await exportService.loadRecords();
    const exported = records.find((item) => item.type === "goal" && item.id === goal.id)!;
    expect(exported.privacy).toBe("private");
    expect(exported.fields).toEqual(expect.arrayContaining([
      { label: "状态", value: "放弃" }, { label: "状态原因", value: "私密的现实约束" },
    ]));
    expect(JSON.stringify(build(records, "goal-analysis"))).not.toContain("私密的现实约束");
    expect(searchEntries(await searchService.list(), { query: "现实约束", status: "abandoned",
      domainId: "", from: "", to: "", types: ["goal"] }).map((item) => item.id)).toEqual([goal.id]);
  });
  it("finds reviews and actions through every directly linked domain", async () => {
    const memory = new MemorySqliteExecutor();
    await new MigrationRunner(memory, migrations, clock).run();
    const { domainService, actionService, reviewService, searchService } = setup(memory);
    const health = await domainService.create({
      name: "健康", description: "", focus: "", color: "fern", icon: "heart",
    });
    const work = await domainService.create({
      name: "事业", description: "", focus: "", color: "ocean", icon: "home",
    });
    const review = await reviewService.create({
      title: "一周回顾", reflection: "", insight: "", nextFocus: "",
      domainId: health.id, domainIds: [health.id, work.id], reviewedOn: "2026-09-23",
    });
    const action = await actionService.create({
      title: "留出时间", notes: "", domainId: health.id, domainIds: [health.id, work.id],
      goalId: null, scheduledFor: null,
    });
    const entries = await searchService.list();
    const inDomain = (domainId: string) => searchEntries(entries, {
      query: "", status: "", domainId, from: "", to: "", types: ["review", "action"],
    }).map((entry) => entry.id);
    expect(inDomain(health.id)).toEqual(expect.arrayContaining([review.id, action.id]));
    expect(inDomain(work.id)).toEqual(expect.arrayContaining([review.id, action.id]));
  });

for (const native of [true, false]) it("exports current action feedback with privacy and legacy fields; SQLite=" + native, async () => {
  const db = native ? new DatabaseSync(":memory:") : null;
  const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
  try {
    db?.exec("PRAGMA foreign_keys=ON");
    await new MigrationRunner(sql, migrations, clock).run();
    const { actionService, exportService, domainService, goalService } = setup(sql);
    const domain = await domainService.create({ name: "反馈领域", description: "", focus: "", color: "fern", icon: "heart" });
    const goal = await goalService.create({ title: "反馈目标", description: "", domainId: domain.id, status: "active", targetDate: null });
    const draft = { title: "反馈行动", notes: "当前备注", domainId: null, goalId: goal.id, scheduledFor: "2026-09-23" };
    const details = normalizeActionDetails(Object.fromEntries([...actionDetailFields.map(([key]) => [key, "反馈-" + key]), ["actualMinutes", 0]]));
    const action = await actionService.create({ ...draft, details });
    let records = await exportService.loadRecords();
    const fact = records.find(r => r.type === "action" && r.id === action.id)!;
    expect(fact).toMatchObject({ privacy: "private", date: "2026-09-23", domainIds: [domain.id], goalId: goal.id });
    expect(fact.fields).toContainEqual({ label: "投入时间（分钟）", value: "0" });
    for (const [, label] of actionDetailFields) expect(fieldPresets.action).toContain(label);
    for (const scenario of ["goal-analysis", "period-review", "life-domain", "issue-diagnosis", "major-decision"] as const) {
      const preset = builtInTemplates.find(t => t.id === "default-export-" + scenario)!;
      expect(() => validateTemplate("export", preset.name, preset.defaults)).not.toThrow();
      const selected = { ...filter, maxPrivacy: "private" as const, domainId: domain.id, goalId: goal.id, from: "2026-09-23", to: "2026-09-23" };
      const document = buildContextDocument(records, scenario, selected, scenarioPresets[scenario].sections, "", { action: fieldPresets.action });
      for (const format of ["markdown", "text", "json"] as const) {
        const output = serializeContext(document, format);
        for (const [key] of actionDetailFields) expect(output).toContain(details[key]);
        for (const change of [{ maxPrivacy: "normal" as const }, { domainId: "other" }, { goalId: "other" }, { from: "2026-09-24", to: "" }, { types: exportTypes.filter(t => t !== "action") }]) {
          expect(serializeContext(build(records, scenario, { ...selected, ...change }), format)).not.toContain(details.actualResult);
        }
        const old = buildContextDocument(records, scenario, selected, scenarioPresets[scenario].sections, "", { action: ["备注", "状态"] });
        expect(serializeContext(old, format)).toContain("当前备注");
        expect(serializeContext(old, format)).not.toContain(details.actualResult);
      }
      expect(() => validateTemplate("export", preset.name, { ...preset.defaults, fields: { action: ["备注", "状态"] } })).not.toThrow();
    }
    await exportService.setPrivacy("action", action.id, "highly_sensitive");
    records = await exportService.loadRecords();
    expect(serializeContext(build(records, "period-review", { ...filter, maxPrivacy: "private" }), "text")).not.toContain(details.actualResult);
    await actionService.update(action.id, { ...draft, details: {} });
    expect(await new VersionHistoryService(new SqliteObjectVersionRepository(sql)).list("action", action.id)).toHaveLength(1);
    records = await exportService.loadRecords();
    expect(records.find(r => r.id === action.id)?.fields).toContainEqual({ label: "投入时间（分钟）", value: "" });
    for (const format of ["markdown", "text", "json"] as const) expect(serializeContext(build(records, "period-review", { ...filter, maxPrivacy: "highly_sensitive" }), format)).not.toContain(details.actualResult);
  } finally { db?.close(); }
});

  it("finds inactive domain context and exports new fields only when privacy allows it", async () => {
    const memory = new MemorySqliteExecutor();
    await new MigrationRunner(memory, migrations, clock).run();
    const { domainService, exportService, searchService } = setup(memory);
    const publicDomain = await domainService.create({
      name: "休息", description: "旧说明", focus: "减轻负担",
      currentState: "正在调整", longTermExpectation: "每周能从容休息",
      status: "paused", color: "fern", icon: "heart",
    });
    const secret = await domainService.create({
      name: "私密领域", description: "", focus: "",
      currentState: "不公开的现状", longTermExpectation: "不公开的期待",
      status: "archived", color: "ocean", icon: "home",
    });
    await exportService.setPrivacy("domain", publicDomain.id, "normal");
    const entries = await searchService.list();
    for (const [query, status, id] of [
      ["正在调整", "paused", publicDomain.id],
      ["从容休息", "paused", publicDomain.id],
      ["不公开的期待", "archived", secret.id],
    ]) {
      expect(searchEntries(entries, {
        query, status, domainId: "", from: "", to: "", types: searchTypes,
      }).map((entry) => entry.id)).toEqual([id]);
    }
    const records = await exportService.loadRecords();
    expect(records.filter((item) => item.type === "domain")).toMatchObject([
      { id: publicDomain.id, privacy: "normal" },
      { id: secret.id, privacy: "private" },
    ]);
    for (const format of ["markdown", "text", "json"] as const) {
      const output = serializeContext(build(records, "life-domain",
        { ...filter, types: ["domain"] }), format);
      expect(output).toContain("正在调整");
      expect(output).toContain("每周能从容休息");
      expect(output).toContain("已暂停");
      expect(output).not.toContain("不公开的现状");
      expect(output).not.toContain("不公开的期待");
      const authorized = serializeContext(build(records, "life-domain",
        { ...filter, types: ["domain"], domainId: secret.id, maxPrivacy: "private" }), format);
      expect(authorized).toContain("不公开的现状");
      expect(authorized).toContain("不公开的期待");
      expect(authorized).toContain("已归档");
    }
    const selected = buildContextDocument(records, "life-domain",
      { ...filter, types: ["domain"] }, ["domain"], "",
      { domain: ["长期期待", "当前状态"] });
    expect(selected.sections[0].records[0].fields).toEqual([
      { label: "长期期待", value: "每周能从容休息" },
      { label: "当前状态", value: "正在调整" },
    ]);
  });

  it("adds constrained privacy defaults without changing any old record or its links in real SQLite", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      for (const migration of migrations.slice(0, migrations.indexOf(m5PrivacyMigration))) {
        for (const sql of migration.statements) db.exec(sql);
      }
      db.exec(`INSERT INTO life_domains
        (id, name, description, focus, color_key, icon_key, sort_order, created_at, updated_at)
        VALUES ('d', '健康', '已有内容', '', 'fern', 'heart', 0, '2026-09-20', '2026-09-20');
        INSERT INTO goals (id, title, domain_id, status, sort_order, created_at, updated_at)
        VALUES ('g', '历史目标', 'd', 'active', 0, '2026-09-20', '2026-09-20');
        INSERT INTO actions (id, title, goal_id, status, sort_order, created_at, updated_at)
        VALUES ('a', '原行动', 'g', 'open', 0, '2026-09-20', '2026-09-20');
        INSERT INTO reviews (id, title, reviewed_on, created_at, updated_at)
        VALUES ('r', '回顾', '2026-09-20', '2026-09-20', '2026-09-20');
        INSERT INTO inbox_items (id, content, source, status, created_at, updated_at)
        VALUES ('i', '私密文字', 'inbox', 'unprocessed', '2026-09-20', '2026-09-20');
        INSERT INTO issues (id, title, first_seen, status, created_at, updated_at)
        VALUES ('s', '问题', '2026-09-20', 'open', '2026-09-20', '2026-09-20');
        INSERT INTO issue_domain_links (issue_id, domain_id) VALUES ('s', 'd');
        INSERT INTO decisions (id, title, decided_on, importance, status,
          reversibility, goal_id, created_at, updated_at)
        VALUES ('c', '选择', '2026-09-20', 'major', 'considering',
          'unknown', 'g', '2026-09-20', '2026-09-20');
        INSERT INTO decision_domain_links (decision_id, domain_id) VALUES ('c', 'd');`);
      for (const migration of migrations.slice(migrations.indexOf(m5PrivacyMigration))) {
        for (const sql of migration.statements) db.exec(sql);
      }
      for (const [table, id] of [
        ["life_domains", "d"], ["goals", "g"], ["actions", "a"], ["reviews", "r"],
        ["inbox_items", "i"], ["issues", "s"], ["decisions", "c"],
      ]) {
        expect(db.prepare(`SELECT privacy_level FROM ${table} WHERE id = ?`).get(id))
          .toEqual({ privacy_level: "private" });
      }
      expect(db.prepare("SELECT description FROM life_domains WHERE id = 'd'").get())
        .toEqual({ description: "已有内容" });
      expect(db.prepare("SELECT domain_id FROM issue_domain_links WHERE issue_id = 's'").all())
        .toEqual([{ domain_id: "d" }]);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(() => db.exec("UPDATE goals SET privacy_level = 'invalid' WHERE id = 'g'")).toThrow();
      db.exec(`INSERT INTO goals (id, title, status, sort_order, created_at, updated_at)
        VALUES ('new', '迁移后新增', 'active', 1, '2026-09-23', '2026-09-23')`);
      expect(db.prepare("SELECT privacy_level FROM goals WHERE id = 'new'").get())
        .toEqual({ privacy_level: "private" });
      db.exec(`UPDATE issue_writes SET title = '问题已编辑',
        domain_ids_json = '["d"]' WHERE id = 's'`);
      expect(db.prepare("SELECT privacy_level, title FROM issues WHERE id = 's'").get())
        .toEqual({ privacy_level: "private", title: "问题已编辑" });

      const executor = nativeSqliteExecutor(db);
      const services = setup(executor);
      expect((await services.exportService.loadRecords()).map((item) => item.privacy))
        .toEqual(Array(8).fill("private"));
      await services.exportService.setPrivacy("goal", "g", "highly_sensitive");
      expect((await services.goalService.findById("g"))?.title).toBe("历史目标");
      expect((await services.privacy.list()).get("goal:g")).toBe("highly_sensitive");
      await expect(services.exportService.setPrivacy("goal", "missing", "normal"))
        .rejects.toThrow("不存在");
      await expect(services.exportService.setPrivacy("goal", "g", "wrong" as "normal"))
        .rejects.toThrow("无效");
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("migrates existing metric facts forward and defaults old and new definitions to private", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      for (const migration of migrations.slice(0, migrations.indexOf(m5MetricPrivacyMigration))) {
        for (const sql of migration.statements) db.exec(sql);
      }
      db.exec(`INSERT INTO life_domains
        (id, name, color_key, icon_key, sort_order, created_at, updated_at)
        VALUES ('d', '隐私领域', 'fern', 'heart', 0, '2026-09-20', '2026-09-20');
        INSERT INTO metric_definitions (id, name, unit, created_at)
        VALUES ('old', '历史指标', '小时', '2026-09-20');
        INSERT INTO metric_domain_links (metric_id, domain_id) VALUES ('old', 'd');
        INSERT INTO metric_records (id, metric_id, recorded_on, value, note, created_at, updated_at)
        VALUES ('r', 'old', '2026-09-22', 7.5, '历史说明', '2026-09-22', '2026-09-22');`);
      for (const sql of m5MetricPrivacyMigration.statements) db.exec(sql);
      expect(db.prepare("SELECT name, unit, privacy_level FROM metric_definitions WHERE id = 'old'")
        .get()).toEqual({ name: "历史指标", unit: "小时", privacy_level: "private" });
      expect(db.prepare("SELECT metric_id, recorded_on, value, note FROM metric_records WHERE id = 'r'")
        .get()).toEqual({ metric_id: "old", recorded_on: "2026-09-22", value: 7.5,
        note: "历史说明" });
      expect(db.prepare("SELECT domain_id FROM metric_domain_links WHERE metric_id = 'old'")
        .all()).toEqual([{ domain_id: "d" }]);
      expect(() => db.exec("UPDATE metric_definitions SET privacy_level = 'invalid' WHERE id = 'old'"))
        .toThrow();
      db.exec(`INSERT INTO metric_definitions (id, name, unit, created_at)
        VALUES ('new', '新指标', '次', '2026-09-23')`);
      expect(db.prepare("SELECT privacy_level FROM metric_definitions WHERE id = 'new'").get())
        .toEqual({ privacy_level: "private" });
      for (const migration of migrations.slice(migrations.indexOf(m5MetricPrivacyMigration) + 1)) {
        for (const sql of migration.statements) db.exec(sql);
      }
      const executor = nativeSqliteExecutor(db);
      const { exportService } = setup(executor);
      const records = await exportService.loadRecords();
      expect(records.filter((item) => item.type === "metric" || item.type === "metric-record"))
        .toMatchObject([
          { title: "历史指标", privacy: "private" },
          { title: "新指标", privacy: "private" },
          { title: "历史指标", privacy: "private", date: "2026-09-22" },
        ]);
      const scope: ExportFilter = { ...filter, from: "2026-09-22", to: "2026-09-22",
        domainId: "d", types: ["metric-record"] };
      for (const format of ["markdown", "text", "json"] as const) {
        const hidden = serializeContext(build(records, "life-domain", scope), format);
        expect(hidden).not.toContain("历史指标");
        const included = serializeContext(build(records, "life-domain",
          { ...scope, maxPrivacy: "private" }), format);
        expect(included).toContain("历史说明");
        expect(included).not.toContain("隐私领域");
        expect(included).not.toContain("新指标");
      }
      await exportService.setPrivacy("metric", "old", "normal");
      const updated = await exportService.loadRecords();
      expect(updated.filter((item) => item.type === "metric-record"))
        .toMatchObject([{ privacy: "normal" }]);
      for (const format of ["markdown", "text", "json"] as const) {
        const text = serializeContext(build(updated, "life-domain", scope), format);
        expect(text).toContain("历史说明");
        expect(text).not.toContain("隐私领域");
      }
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("exports actual metric dates without exposing withheld metrics or domain names", async () => {
    const memory = new MemorySqliteExecutor();
    await new MigrationRunner(memory, migrations, clock).run();
    const { domainService, goalService, metricService, exportService } = setup(memory);
    const health = await domainService.create({
      name: "隐私领域名称", description: "", focus: "", color: "fern", icon: "heart",
    });
    const work = await domainService.create({
      name: "工作", description: "", focus: "", color: "ocean", icon: "briefcase",
    });
    const goal = await goalService.create({
      title: "普通目标", description: "", domainId: health.id, status: "active", targetDate: null,
    });
    const metric = await metricService.createDefinition("睡眠时长", "小时", [health.id, work.id]);
    const secret = await metricService.createDefinition("高度敏感指标", "分", [health.id]);
    await metricService.saveRecord(metric.id, "2026-09-21", 7, "较早记录");
    await metricService.saveRecord(metric.id, "2026-09-23", 8.5, "当日说明");
    await metricService.saveRecord(secret.id, "2026-09-23", 1, "敏感说明");
    await exportService.setPrivacy("metric", secret.id, "highly_sensitive");
    const records = await exportService.loadRecords();
    expect(records.find((item) => item.type === "metric-record" && item.title === "睡眠时长"))
      .toMatchObject({ privacy: "private", domainIds: [health.id, work.id], goalId: null });
    const narrow: ExportFilter = { ...filter, from: "2026-09-23", to: "2026-09-23",
      domainId: work.id, types: ["metric-record"] };
    for (const format of ["markdown", "text", "json"] as const) {
      const output = serializeContext(build(records, "period-review",
        { ...narrow, maxPrivacy: "private" }), format);
      expect(output).toContain("睡眠时长");
      expect(output).toContain("8.5");
      expect(output).toContain("当日说明");
      expect(output).not.toContain("较早记录");
      expect(output).not.toContain("高度敏感指标");
      expect(output).not.toContain("隐私领域名称");
      expect(output).not.toContain("工作");
      expect(serializeContext(build(records, "life-domain", narrow), format))
        .not.toContain("睡眠时长");
      expect(serializeContext(build(records, "period-review",
        { ...narrow, goalId: goal.id, maxPrivacy: "private" }), format))
        .not.toContain("睡眠时长");
    }
    await exportService.setPrivacy("metric", metric.id, "normal");
    expect(serializeContext(build(await exportService.loadRecords(), "life-domain",
      { ...narrow, domainId: health.id }), "text")).toContain("当日说明");
    const definitions = serializeContext(build(await exportService.loadRecords(),
      "life-domain", { ...filter, types: ["metric"] }), "text");
    expect(definitions).toContain("睡眠时长");
    expect(definitions).not.toContain("高度敏感指标");
    await exportService.setPrivacy("metric", metric.id, "private");
    for (const format of ["markdown", "text", "json"] as const) {
      const output = serializeContext(build(await exportService.loadRecords(),
        "life-domain"), format);
      expect(output).not.toContain("睡眠时长");
      expect(output).not.toContain("当日说明");
    }
    await expect(exportService.setPrivacy("metric-record" as "metric", "missing", "normal"))
      .rejects.toThrow("无效");
  });

  it("persists classifications in the browser adapter and applies fail-closed defaults", async () => {
    const memory = new MemorySqliteExecutor();
    await new MigrationRunner(memory, migrations, clock).run();
    const { domainService, goalService, actionService, exportService } = setup(memory);
    const domain = await domainService.create({
      name: "事业", description: "", focus: "", color: "ocean", icon: "briefcase",
    });
    const goal = await goalService.create({
      title: "准备转型", description: "秘密描述", domainId: domain.id,
      status: "active", targetDate: null,
    });
    expect((await exportService.loadRecords()).map((item) => item.privacy))
      .toEqual(["private", "private"]);
    await exportService.setPrivacy("goal", goal.id, "normal");
    await exportService.setPrivacy("domain", domain.id, "highly_sensitive");
    const records = await exportService.loadRecords();
    expect(records.map((item) => item.privacy)).toEqual(["highly_sensitive", "normal"]);
    const text = serializeContext(build(records, "goal-analysis"), "markdown");
    expect(text).toContain("准备转型");
    expect(text).not.toContain("事业");
    const action = await actionService.create({
      title: "梳理方向", notes: "", domainId: null, goalId: goal.id, scheduledFor: null,
    });
    await exportService.setPrivacy("action", action.id, "normal");
    const scoped = build(await exportService.loadRecords(), "goal-analysis",
      { ...filter, domainId: domain.id });
    const scopedText = serializeContext(scoped, "text");
    expect(scopedText).toContain("梳理方向");
    expect(scopedText).not.toContain("事业");
  });

  it("uses distinct scenarios and filters private and highly sensitive text and related titles in all formats", () => {
    const records = [
      record("domain", "secret-domain", "领域秘密", { privacy: "highly_sensitive" }),
      record("goal", "secret-goal", "目标秘密", { privacy: "private" }),
      record("goal", "unrecognized", "异常等级内容", { privacy: "unexpected" as "normal" }),
      record("action", "a", "今日行动", { goalId: "secret-goal",
        domainIds: ["secret-domain"],
        links: [{ type: "goal", id: "secret-goal", title: "目标秘密" },
          { type: "domain", id: "secret-domain", title: "领域秘密" }] }),
      record("review", "r", "回顾进展"),
      record("issue", "i", "阻碍情况"),
      record("decision", "d", "重要选择", { fields: [
        { label: "重要程度", value: "重大" }, { label: "风险", value: "较高" },
      ] }),
      record("inbox", "x", "待整理灵感", { fields: [{ label: "状态", value: "待整理" }] }),
      record("inbox", "done", "已整理内容", { fields: [{ label: "状态", value: "已处理" }] }),
    ];
    const goal = build(records, "goal-analysis");
    const decision = build(records, "major-decision");
    const inbox = build(records, "inbox-triage");
    expect(goal.sections.map((item) => item.type)).toEqual([
      "goal", "progress-item", "action", "plan-change", "habit", "habit-log", "issue", "review",
      "event", "navigation", "resource", "person", "skill", "role",
    ]);
    expect(decision.sections.map((item) => item.type)).toEqual([
      "decision", "navigation", "goal", "progress-item", "issue", "action", "resource", "person", "skill", "role",
    ]);
    expect(inbox.sections.find((item) => item.type === "inbox")?.records.map((item) => item.title))
      .toEqual(["待整理灵感"]);
    for (const document of [goal, decision, inbox]) {
      for (const format of ["markdown", "text", "json"] as const) {
        const output = serializeContext(document, format);
        expect(output).not.toContain("目标秘密");
        expect(output).not.toContain("领域秘密");
        expect(output).not.toContain("已整理内容");
        expect(output).not.toContain("异常等级内容");
      }
    }
    const withPrivate = serializeContext(build(records, "goal-analysis",
      { ...filter, maxPrivacy: "private" }), "text");
    expect(withPrivate).toContain("目标秘密");
    expect(withPrivate).not.toContain("领域秘密");
    const withSensitive = serializeContext(build(records, "inbox-triage",
      { ...filter, maxPrivacy: "highly_sensitive" }), "text");
    expect(withSensitive).toContain("领域秘密");
  });

  it("scopes dates, domains, goals and object types and honors field selection and ordering", () => {
    const records = [
      record("goal", "g", "公开目标", { domainIds: ["d"] }),
      record("goal", "other", "无关目标", { domainIds: ["other"] }),
      record("action", "a", "当前行动", { domainIds: ["d"], goalId: "g",
        fields: [{ label: "状态", value: "已完成" }, { label: "备注", value: "行动备注" }] }),
      record("action", "old", "旧行动", { date: "2026-08-10", domainIds: ["d"], goalId: "g" }),
      record("review", "r", "领域回顾", { domainIds: ["d"] }),
    ];
    const narrow: ExportFilter = { ...filter, from: "2026-09-01", to: "2026-09-30",
      domainId: "d", goalId: "g", types: ["goal", "action", "review"] };
    const document = buildContextDocument(records, "goal-analysis", narrow,
      ["action", "goal"], "下一步？", { action: ["备注", "状态"] });
    const text = serializeContext(document, "text");
    expect(text).toContain("当前行动");
    expect(text).toContain("公开目标");
    expect(text).not.toContain("旧行动");
    expect(text).not.toContain("无关目标");
    expect(text).not.toContain("领域回顾");
    expect(text.indexOf("行动备注")).toBeLessThan(text.indexOf("已完成"));
    expect(JSON.parse(serializeContext(document, "json"))).toMatchObject({
      format: "lifeos-context-v1", question: "下一步？",
      sections: [{ type: "action" }, { type: "goal" }],
    });
    const omitted = buildContextDocument(records, "goal-analysis", narrow,
      ["action"], "", { action: [] });
    expect(omitted.sections[0].records[0].fields).toEqual([]);
    expect(() => build(records, "goal-analysis",
      { ...filter, from: "2026-09-30", to: "2026-09-01" })).toThrow("时间范围");
  });

  it("does not reveal related titles excluded by the scenario, selected sections, type or date", () => {
    const records = [
      record("goal", "g", "未导出的目标", { date: "2026-08-01" }),
      record("domain", "d", "未导出的领域"),
      record("action", "a", "公开行动", { goalId: "g", domainIds: ["d"],
        links: [{ type: "goal", id: "g", title: "未导出的目标" },
          { type: "domain", id: "d", title: "未导出的领域" }] }),
    ];
    for (const options of [
      { ...filter, types: ["action"] as const },
      { ...filter, from: "2026-09-01" },
      filter,
    ]) {
      const document = buildContextDocument(records, "goal-analysis", options,
        ["action"], "", { action: ["关联目标", "关联领域"] });
      for (const format of ["markdown", "text", "json"] as const) {
        const text = serializeContext(document, format);
        expect(text).toContain("公开行动");
        expect(text).not.toContain("未导出的目标");
        expect(text).not.toContain("未导出的领域");
      }
    }
  });

  it("exports dated adjustments independently while inheriting the action's privacy", async () => {
    const memory = new MemorySqliteExecutor();
    await new MigrationRunner(memory, migrations, clock).run();
    const services = setup(memory);
    const domain = await services.domainService.create({
      name: "健康", description: "", focus: "", color: "fern", icon: "heart",
    });
    const goal = await services.goalService.create({
      title: "私密目标", description: "", domainId: domain.id, status: "active", targetDate: null,
    });
    const draft = {
      title: "复查身体", notes: "私密备注", domainId: null, goalId: goal.id,
      scheduledFor: "2026-10-01",
    };
    const action = await services.actionService.create(draft);
    await services.actionService.update(action.id, { ...draft, scheduledFor: "2026-10-04" },
      { reason: "external", note: "调整说明" });
    await services.exportService.setPrivacy("action", action.id, "normal");
    const records = await services.exportService.loadRecords();
    expect(records.find((item) => item.type === "plan-change")).toMatchObject({
      date: "2026-09-23", privacy: "normal", goalId: goal.id, domainIds: [domain.id],
    });
    const scoped = {
      ...filter, from: "2026-09-23", to: "2026-09-23",
      domainId: domain.id, goalId: goal.id, types: ["plan-change"] as const,
    };
    const document = build(records, "goal-analysis", scoped);
    for (const format of ["markdown", "text", "json"] as const) {
      const output = serializeContext(document, format);
      expect(output).toContain("复查身体");
      expect(output).toContain("调整说明");
      expect(output).not.toContain("私密目标");
      expect(output).not.toContain("私密备注");
    }
    expect(document.sections.find((section) => section.type === "plan-change")?.records)
      .toHaveLength(1);
    expect(build(records, "goal-analysis", { ...scoped, from: "2026-09-24", to: "" })
      .sections.find((section) => section.type === "plan-change")?.records).toHaveLength(0);
    expect(build(records, "goal-analysis", { ...scoped, goalId: "other" })
      .sections.find((section) => section.type === "plan-change")?.records).toHaveLength(0);
    const withAction = build(records, "goal-analysis",
      { ...scoped, types: ["action", "plan-change"] });
    expect(withAction.sections.find((section) => section.type === "action")?.records)
      .toHaveLength(0);
    expect(withAction.sections.find((section) => section.type === "plan-change")?.records)
      .toHaveLength(1);
    await services.exportService.setPrivacy("action", action.id, "private");
    const hidden = serializeContext(build(await services.exportService.loadRecords(),
      "goal-analysis", scoped), "text");
    expect(hidden).not.toContain("调整说明");
    expect(hidden).not.toContain("复查身体");
    await expect(services.exportService.setPrivacy("plan-change" as "action", "1", "normal"))
      .rejects.toThrow("无效");
  });

  it("reads a reasoned change from real SQLite and never backfills an older action", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      for (const migration of migrations) {
        for (const sql of migration.statements) db.exec(sql);
      }
      db.exec(`INSERT INTO actions (id, title, status, scheduled_for, sort_order,
        created_at, updated_at) VALUES
        ('action', '查看排期', 'open', '2026-10-01', 0,
          '2026-09-22T08:00:00.000Z', '2026-09-22T08:00:00.000Z')`);
      const executor = nativeSqliteExecutor(db);
      const services = setup(executor);
      const existing = (await services.actionService.findById("action"))!;
      await services.actionService.update(existing.id, { ...existing, scheduledFor: "2026-10-03" },
        { reason: "conflict", note: "改到周末" });
      expect((await services.exportService.loadRecords()).filter((entry) =>
        entry.type === "plan-change")).toMatchObject([{
        privacy: "private", fields: expect.arrayContaining([
          { label: "补充说明", value: "改到周末" },
        ]),
      }]);
      await services.exportService.setPrivacy("action", "action", "normal");
      const text = serializeContext(build(await services.exportService.loadRecords(),
        "period-review", { ...filter, types: ["plan-change"] }), "text");
      expect(text).toContain("改到周末");
      expect(text).not.toContain("首次安排");
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("keeps old custom templates usable when adding navigation fields", async () => {
    const navigation = record("navigation", "n", "私密方向", { privacy: "private",
      fields: [{ label: "内容", value: "导航正文" }] });
    const value = {
      environment: "browser-preview",
      contextExportService: { loadRecords: vi.fn().mockResolvedValue([navigation]) },
      templateService: { find: vi.fn().mockResolvedValue({ category: "export", name: "旧导出模板", defaults: {
        scenario: "goal-analysis", sections: ["goal"], fields: { goal: ["说明"] }, question: "旧模板问题",
      } }) },
    } as unknown as LifeOSContextValue;
    const view = render(createElement(MemoryRouter, { initialEntries: ["/export?template=old"] },
      createElement(LifeOSContext.Provider, { value }, createElement(ContextExportPage))));
    await screen.findByRole("heading", { name: "导出预览" });
    await waitFor(() => expect((screen.getByLabelText("希望讨论的问题") as HTMLTextAreaElement).value).toBe("旧模板问题"));
    await waitFor(() => expect(screen.getByLabelText("分析场景").matches(":disabled")).toBe(false));
    fireEvent.change(screen.getByLabelText("分析场景"), { target: { value: "major-decision" } });
    expect(screen.getByRole("button", { name: "移除人生导航的内容" })).toBeTruthy();
    const downloadButton = screen.getByRole("button", { name: "下载" });
    const preview = () => view.container.querySelector("pre")!.textContent;
    expect(preview()).not.toContain("私密方向");
    fireEvent.change(screen.getByLabelText("允许纳入的最高隐私等级"), { target: { value: "private" } });
    expect(preview()).toContain("导航正文");
    expect(downloadButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByLabelText(/我已查看预览/));
    expect(downloadButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "移除人生导航的内容" }));
    expect(preview()).not.toContain("导航正文");
    expect(downloadButton.hasAttribute("disabled")).toBe(true);
  });

  it("previews before enabling export and requires a fresh confirmation for private records", async () => {
    const records = [record("goal", "g", "私密目标", { privacy: "private" })];
    const exportService = {
      loadRecords: vi.fn().mockResolvedValue(records),
      setPrivacy: vi.fn().mockImplementation(async () => { records[0].privacy = "normal"; }),
    };
    const value = {
      environment: "browser-preview", contextExportService: exportService,
    } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, null, createElement(LifeOSContext.Provider,
      { value }, createElement(ContextExportPage))));
    expect(await screen.findByRole("heading", { name: "导出预览" })).toBeTruthy();
    const copyButton = screen.getByRole("button", { name: "复制" });
    expect(copyButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByText(/管理记录的隐私等级/));
    fireEvent.change(screen.getByLabelText("目标 私密目标 的隐私等级"), {
      target: { value: "normal" },
    });
    await waitFor(() => expect(screen.getByText(/# 目标分析/).textContent).toContain("私密目标"));
    expect(copyButton.hasAttribute("disabled")).toBe(false);
    fireEvent.change(screen.getByLabelText("允许纳入的最高隐私等级"),
      { target: { value: "private" } });
    expect(copyButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByLabelText(/我已查看预览/));
    expect(copyButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    const json = JSON.parse(screen.getByText(/"lifeos-context-v1"/).textContent ?? "");
    expect(json.sections[0].records[0].title).toBe("私密目标");
    expect(copyButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByLabelText(/我已查看预览/));
    expect(copyButton.hasAttribute("disabled")).toBe(false);
    fireEvent.change(screen.getByLabelText("希望讨论的问题"),
      { target: { value: "现在该怎么办？" } });
    expect(copyButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByLabelText(/我已查看预览/));
    expect(copyButton.hasAttribute("disabled")).toBe(false);
  });

  it("lets the Chinese export view classify one metric and refreshes its derived record", async () => {
    let level: ExportRecord["privacy"] = "private";
    const definition = record("metric", "m", "睡眠时长", {
      fields: [{ label: "计量单位", value: "小时" }],
    });
    const reading = record("metric-record", "r", "睡眠时长", {
      fields: [{ label: "数值", value: "8.5" }, { label: "计量单位", value: "小时" },
        { label: "记录说明", value: "晨间记录" }],
    });
    const exportService = {
      loadRecords: vi.fn().mockImplementation(async () => [
        { ...definition, privacy: level }, { ...reading, privacy: level },
      ]),
      setPrivacy: vi.fn().mockImplementation(async (type: string, id: string,
        next: typeof level) => {
        expect([type, id]).toEqual(["metric", "m"]);
        level = next;
      }),
    };
    const value = {
      environment: "browser-preview", contextExportService: exportService,
    } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, null, createElement(LifeOSContext.Provider,
      { value }, createElement(ContextExportPage))));
    expect(await screen.findByRole("heading", { name: "导出预览" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "分析场景" }),
      { target: { value: "life-domain" } });
    expect(screen.getByText(/管理记录的隐私等级（1）/)).toBeTruthy();
    expect(screen.getByText(/# 人生领域/).textContent).not.toContain("晨间记录");
    fireEvent.click(screen.getByText(/管理记录的隐私等级/));
    expect(screen.queryByLabelText("指标记录 睡眠时长 的隐私等级")).toBeNull();
    fireEvent.change(screen.getByLabelText("领域指标 睡眠时长 的隐私等级"),
      { target: { value: "normal" } });
    await waitFor(() => expect(screen.getByText(/# 人生领域/).textContent)
      .toContain("晨间记录"));
    expect(screen.getByText("2 条记录 · MARKDOWN")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("领域指标 睡眠时长 的隐私等级"),
      { target: { value: "highly_sensitive" } });
    await waitFor(() => expect(screen.getByText(/# 人生领域/).textContent)
      .not.toContain("晨间记录"));
    fireEvent.change(screen.getByRole("combobox", { name: "允许纳入的最高隐私等级" }),
      { target: { value: "highly_sensitive" } });
    expect(screen.getByText(/# 人生领域/).textContent).toContain("晨间记录");
    expect(screen.getByRole("button", { name: "复制" }).hasAttribute("disabled")).toBe(true);
  });

  it("refreshes derived change privacy when the source action's classification changes", async () => {
    let privacy: ExportRecord["privacy"] = "normal";
    const action = record("action", "a", "公开行动");
    const event = record("plan-change", "7", "公开行动", {
      fields: [{ label: "补充说明", value: "调整说明" }],
    });
    const exportService = {
      loadRecords: vi.fn().mockImplementation(async () => [
        { ...action, privacy }, { ...event, privacy },
      ]),
      setPrivacy: vi.fn().mockImplementation(async (_type: string, _id: string, level: typeof privacy) => {
        privacy = level;
      }),
    };
    const value = {
      environment: "browser-preview", contextExportService: exportService,
    } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, null, createElement(LifeOSContext.Provider,
      { value }, createElement(ContextExportPage))));
    expect(await screen.findByRole("heading", { name: "导出预览" })).toBeTruthy();
    expect(screen.getByText(/管理记录的隐私等级（1）/)).toBeTruthy();
    expect(screen.getByText(/# 目标分析/).textContent).toContain("调整说明");
    fireEvent.click(screen.getByText(/管理记录的隐私等级/));
    fireEvent.change(screen.getByLabelText("行动 公开行动 的隐私等级"),
      { target: { value: "private" } });
    await waitFor(() => expect(screen.getByText(/# 目标分析/).textContent)
      .not.toContain("调整说明"));
    fireEvent.change(screen.getByLabelText("行动 公开行动 的隐私等级"),
      { target: { value: "normal" } });
    await waitFor(() => expect(screen.getByText(/# 目标分析/).textContent)
      .toContain("调整说明"));
  });

  it("never expands a missing domain link into an all-domains export", async () => {
    const exportService = {
      loadRecords: vi.fn().mockResolvedValue([record("goal", "g", "公开目标")]),
      setPrivacy: vi.fn(),
    };
    const value = {
      environment: "browser-preview", contextExportService: exportService,
    } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, { initialEntries: ["/export?domain=missing"] },
      createElement(LifeOSContext.Provider, { value }, createElement(ContextExportPage))));
    expect(await screen.findByRole("heading", { name: "导出预览" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/# 目标分析/).textContent).not.toContain("公开目标");
    fireEvent.change(screen.getByRole("combobox", { name: "生活领域" }),
      { target: { value: "" } });
    expect(screen.getByText(/# 目标分析/).textContent).toContain("公开目标");
    expect(screen.getByRole("button", { name: "复制" }).hasAttribute("disabled")).toBe(false);
  });
});
