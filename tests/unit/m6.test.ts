import { SqliteTemplateRepository } from "../../src/repositories/sqlite/SqliteTemplateRepository";
import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { backupTables, inspectBackup, type BackupRow, type LifeOSBackup } from "../../src/domain/backup/Backup";
import { searchEntries, searchTypes, type SearchEntry } from "../../src/domain/search/Search";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import type { SqliteExecutor } from "../../src/repositories/sqlite/SqliteExecutor";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteIssueRepository } from "../../src/repositories/sqlite/SqliteIssueRepository";
import { GoalService } from "../../src/services/planning/GoalService";
import { IssueService } from "../../src/services/issues/IssueService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { TemplateService } from "../../src/services/templates/TemplateService";
const clock = { now: () => new Date("2026-09-28T08:00:00Z") };
let sequence = 0;
const ids = { next: () => `m6-${++sequence}` };

function native(db: DatabaseSync): SqliteExecutor {
  return nativeSqliteExecutor(db);
}
function fixture(db: DatabaseSync): LifeOSBackup {
  return {
    format: "lifeos-backup", schemaVersion: 25, appVersion: "0.1.0",
    exportedAt: "2026-09-28T08:00:00Z",
    data: Object.fromEntries(backupTables.slice(0, 33).map((table) => [
      table, db.prepare(`SELECT * FROM ${table}`).all() as BackupRow[],
    ])) as LifeOSBackup["data"],
  };
}

describe("M6 migration and history on real SQLite", () => {
  it("captures prior versions and linked domains without recording a failed update", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys=ON");
      const sql = native(db);
      await new MigrationRunner(sql, migrations, clock).run();
      const domains = new SqliteLifeDomainRepository(sql);
      const goals = new SqliteGoalRepository(sql);
      const life = new LifeDomainService(domains, clock, ids);
      const goalService = new GoalService(goals, domains, clock, ids);
      const issues = new IssueService(new SqliteIssueRepository(sql), domains, goals, clock, ids);
      const history = new VersionHistoryService(new SqliteObjectVersionRepository(sql));
      const domain = await life.create({ name: "健康", description: "", focus: "",
        color: "fern", icon: "heart" });
      const goal = await goalService.create({
        title: "保持节奏", description: "初版", domainId: domain.id,
        status: "active", targetDate: null,
      });
      await goalService.update(goal.id, { title: "调整节奏", description: "新版",
        domainId: domain.id, status: "active", targetDate: null });
      expect((await history.list("goal", goal.id))[0].snapshot).toMatchObject({
        title: "保持节奏", description: "初版", domain_id: domain.id,
      });
      const issue = await issues.create({ title: "睡眠", description: "记录", firstSeen: "2026-09-28",
        occurrenceCount: 1, causeHypothesis: "", attempts: "", followUp: "",
        status: "open", goalId: goal.id, domainIds: [domain.id] });
      await issues.update(issue.id, { title: "睡眠问题", description: "记录", firstSeen: "2026-09-28",
        occurrenceCount: 1, causeHypothesis: "", attempts: "", followUp: "",
        status: "watching", goalId: goal.id, domainIds: [] });
      expect((await history.list("issue", issue.id))[0].snapshot.domain_ids).toEqual([domain.id]);
      expect(() => db.prepare("UPDATE goals SET title = '' WHERE id = ?").run(goal.id)).toThrow();
      expect(await history.list("goal", goal.id)).toHaveLength(1);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
    } finally { db.close(); }
  });

  it("persists template revisions without changing an existing object or the original preset", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const sql = native(db);
      await new MigrationRunner(sql, migrations, clock).run();
      const service = new TemplateService(new SqliteTemplateRepository(sql), clock, ids);
      const preset = await service.find("default-smart");
      expect(preset?.builtIn).toBe(true);
      const copy = await service.save("goal", "我的目标", preset!.defaults);
      const goals = new SqliteGoalRepository(sql);
      const domains = new SqliteLifeDomainRepository(sql);
      const goal = await new GoalService(goals, domains, clock, ids).create({
        title: "新的方向", description: String(copy.defaults.description),
        status: "active", targetDate: null, domainId: null,
      });
      const next = await service.save("goal", "我的目标", { description: "全新问题" }, copy.id);
      expect(next.version).toBe(2);
      expect((await goals.findById(goal.id))?.description).toBe(copy.defaults.description);
      expect((await service.find("default-smart"))?.defaults).toEqual(preset?.defaults);
      await expect(service.save("goal", "覆盖系统", {}, "default-smart")).rejects.toThrow();
      const habit = await service.find("default-habit");
      expect(habit?.category).toBe("habit");
      expect((await service.save("habit", "早起散步", habit!.defaults)).category).toBe("habit");
    } finally { db.close(); }
  });

  it("preserves existing templates while migrating the category constraint", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const sql = native(db);
      await new MigrationRunner(sql, migrations.slice(0, 15), clock).run();
      await new TemplateService(new SqliteTemplateRepository(sql), clock, ids).save("goal", "原有模板", { description: "继续使用" });
      await new MigrationRunner(sql, migrations, clock).run();
      const rows = db.prepare("SELECT name, defaults_json, version FROM templates").all();
      expect(rows).toMatchObject([{ name: "原有模板",
        defaults_json: '{"description":"继续使用"}', version: 1 }]);
      const habit = await new TemplateService(new SqliteTemplateRepository(sql), clock, ids).save("habit", "散步",
        { frequency: "每周三次" });
      expect(habit.category).toBe("habit");
      expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
    } finally { db.close(); }
  });
});

describe("M6 search and backup preflight", () => {
  it("filters status, domain, dates and multi-term text", () => {
    const entries: SearchEntry[] = [
      { type: "issue", id: "one", title: "睡眠问题", content: "工作压力",
        date: "2026-09-28", status: "watching", domainIds: ["health"], href: "/issues#issue-one" },
      { type: "issue", id: "two", title: "睡眠问题", content: "旧记录",
        date: "2026-08-01", status: "resolved", domainIds: ["work"], href: "/issues#issue-two" },
    ];
    expect(searchEntries(entries, { query: "睡眠 压力", from: "2026-09-01",
      to: "2026-09-30", domainId: "health", status: "watching", types: searchTypes }))
      .toEqual([entries[0]]);
  });

  it("rejects missing tables, duplicate identities, broken links and unknown targets", async () => {
    const memory = new MemorySqliteExecutor();
    await new MigrationRunner(memory, migrations, clock).run();
    const db = new DatabaseSync(":memory:");
    try {
      const sql = native(db);
      await new MigrationRunner(sql, migrations, clock).run();
      const backup = fixture(db);
      expect(inspectBackup(backup).total).toBe(0);
      const previousFormat = structuredClone(backup);
      previousFormat.schemaVersion = 15;
      for (const table of backupTables.slice(18)) {
        delete (previousFormat.data as Partial<LifeOSBackup["data"]>)[table];
      }
      expect(inspectBackup(previousFormat).total).toBe(0);
      const missing = structuredClone(backup);
      delete (missing.data as Partial<LifeOSBackup["data"]>).templates;
      expect(() => inspectBackup(missing)).toThrow("数据表");
      const broken = structuredClone(backup);
      broken.data.goals.push({ id: "g1", domain_id: "absent", parent_id: null });
      expect(() => inspectBackup(broken)).toThrow("引用");
      const missingGoalLink = structuredClone(backup);
      missingGoalLink.data.life_domains.push({ id: "health" });
      missingGoalLink.data.goals.push({ id: "g1", domain_id: "health", parent_id: null });
      expect(() => inspectBackup(missingGoalLink)).toThrow("主领域");
      missingGoalLink.data.goal_domain_links.push({ goal_id: "g1", domain_id: "health" });
      expect(inspectBackup(missingGoalLink).counts.goal_domain_links).toBe(1);
      missingGoalLink.data.goal_domain_links.push({ goal_id: "g1", domain_id: "health" });
      expect(() => inspectBackup(missingGoalLink)).toThrow("重复");
      const previousActions = structuredClone(backup);
      previousActions.schemaVersion = 21;
      delete (previousActions.data as Partial<LifeOSBackup["data"]>).action_domain_links;
      delete (previousActions.data as Partial<LifeOSBackup["data"]>).review_domain_links;
      delete (previousActions.data as Partial<LifeOSBackup["data"]>).goal_progress_items;
      previousActions.data.life_domains.push({ id: "health" });
      previousActions.data.actions.push({ id: "a1", domain_id: "health", goal_id: null });
      expect(inspectBackup(previousActions).counts.actions).toBe(1);
      const missingActionLink = structuredClone(backup);
      missingActionLink.data.life_domains.push({ id: "health" });
      missingActionLink.data.actions.push({ id: "a1", domain_id: "health", goal_id: null });
      expect(() => inspectBackup(missingActionLink)).toThrow("主领域");
      missingActionLink.data.action_domain_links.push({ action_id: "a1", domain_id: "health" });
      expect(inspectBackup(missingActionLink).counts.action_domain_links).toBe(1);
      missingActionLink.data.action_domain_links.push({ action_id: "a1", domain_id: "health" });
      expect(() => inspectBackup(missingActionLink)).toThrow("重复");
      const previousReviews = structuredClone(backup);
      previousReviews.schemaVersion = 22;
      delete (previousReviews.data as Partial<LifeOSBackup["data"]>).review_domain_links;
      delete (previousReviews.data as Partial<LifeOSBackup["data"]>).goal_progress_items;
      previousReviews.data.life_domains.push({ id: "health" });
      previousReviews.data.reviews.push({ id: "r1", domain_id: "health" });
      expect(inspectBackup(previousReviews).counts.reviews).toBe(1);
      const missingReviewLink = structuredClone(backup);
      missingReviewLink.data.life_domains.push({ id: "health" });
      missingReviewLink.data.reviews.push({ id: "r1", domain_id: "health" });
      expect(() => inspectBackup(missingReviewLink)).toThrow("主领域");
      missingReviewLink.data.review_domain_links.push({ review_id: "r1", domain_id: "health" });
      expect(inspectBackup(missingReviewLink).counts.review_domain_links).toBe(1);
      missingReviewLink.data.review_domain_links.push({ review_id: "r1", domain_id: "health" });
      expect(() => inspectBackup(missingReviewLink)).toThrow("重复");
      const duplicates = structuredClone(backup);
      duplicates.data.life_domains.push({ id: "a" }, { id: "a" });
      expect(() => inspectBackup(duplicates)).toThrow("重复");
      const target = structuredClone(backup);
      target.data.inbox_items.push({ id: "inbox", status: "organized",
        target_type: "goal", target_id: "gone" });
      expect(() => inspectBackup(target)).toThrow("收集箱");
      const reserved = structuredClone(backup);
      reserved.data.inbox_items.push({ id: "inbox", status: "processing",
        target_type: "goal", target_id: "inbox-inbox" });
      expect(inspectBackup(reserved).counts.inbox_items).toBe(1);
      reserved.data.inbox_items[0].target_type = "unknown";
      expect(() => inspectBackup(reserved)).toThrow("未知");
      expect(inspectBackup(backup).counts.object_versions).toBe(0);
    } finally { db.close(); }
  });
});
