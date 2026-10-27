import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { m4IssuesMigration } from "../../src/db/migrations/0006-m4-issues";
import { normalizeIssueDraft, type IssueDraft } from "../../src/domain/issues/Issue";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteIssueRepository } from "../../src/repositories/sqlite/SqliteIssueRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { IssueService } from "../../src/services/issues/IssueService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { GoalService } from "../../src/services/planning/GoalService";

const clock = { now: () => new Date("2026-09-23T08:00:00.000Z") };

function draft(overrides: Partial<IssueDraft> = {}): IssueDraft {
  return {
    title: "工作中断睡眠",
    description: "最近几周反复出现",
    firstSeen: "2026-09-20",
    occurrenceCount: 1,
    causeHypothesis: "",
    attempts: "",
    followUp: "",
    status: "open",
    goalId: null,
    domainIds: [],
    ...overrides,
  };
}

describe("M4 issue tracking", () => {
  it("validates dates, count, status, and normalizes duplicate domain links", () => {
    expect(normalizeIssueDraft(draft({
      title: "  睡眠问题 ", domainIds: ["health", "health", "work"],
    }))).toMatchObject({ title: "睡眠问题", domainIds: ["health", "work"] });
    expect(() => normalizeIssueDraft(draft({ firstSeen: "2026-02-30" }))).toThrow("日期");
    expect(() => normalizeIssueDraft(draft({ occurrenceCount: 0 }))).toThrow("出现次数");
    expect(() => normalizeIssueDraft(draft({ occurrenceCount: 1.5 }))).toThrow("出现次数");
    expect(() => normalizeIssueDraft(draft({ status: "invalid" as IssueDraft["status"] })))
      .toThrow("状态");
  });

  it("persists global issues across two domains, supports edits and reopens recurrence", async () => {
    const executor = new MemorySqliteExecutor();
    let sequence = 0;
    const ids = { next: () => `new-${++sequence}` };
    const domains = new SqliteLifeDomainRepository(executor);
    const goals = new SqliteGoalRepository(executor);
    const service = new IssueService(new SqliteIssueRepository(executor), domains, goals, clock, ids);
    const domainService = new LifeDomainService(domains, clock, ids);
    const goalService = new GoalService(goals, domains, clock, ids);
    await new MigrationRunner(executor, migrations, clock).run();

    const health = await domainService.create({
      name: "健康", description: "", focus: "", color: "fern", icon: "heart",
    });
    const work = await domainService.create({
      name: "事业", description: "", focus: "", color: "ocean", icon: "briefcase",
    });
    const goal = await goalService.create({
      title: "更规律地休息", description: "", domainId: null, status: "active", targetDate: null,
    });
    const record = await service.create(draft({
      domainIds: [work.id, health.id, work.id], goalId: goal.id,
    }));
    expect(record.domainIds).toEqual([work.id, health.id]);
    expect(await service.findById(record.id)).toMatchObject({
      goalId: goal.id, domainIds: [health.id, work.id].sort(),
    });

    await service.update(record.id, draft({
      status: "resolved", domainIds: [health.id],
      causeHypothesis: "晚间通知", attempts: "关闭通知", followUp: "一周后再看",
    }));
    expect(await service.recordRecurrence(record.id)).toMatchObject({
      occurrenceCount: 2, status: "open", domainIds: [health.id],
      causeHypothesis: "晚间通知", attempts: "关闭通知", followUp: "一周后再看",
    });
    expect(await service.list()).toHaveLength(1);
    await expect(service.update(record.id, draft({ domainIds: ["missing"] })))
      .rejects.toThrow("生活领域");
    await expect(service.create(draft({ goalId: "missing" }))).rejects.toThrow("目标");
    expect(await service.findById(record.id)).toMatchObject({ domainIds: [health.id], occurrenceCount: 2 });
    await service.update(record.id, draft({ occurrenceCount: 999999 }));
    await expect(service.recordRecurrence(record.id)).rejects.toThrow("上限");
  });

  it("migrates existing inbox rows without changing their fields and writes links atomically", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      for (const migration of migrations.slice(0, 5)) {
        for (const statement of migration.statements) db.exec(statement);
      }
      db.prepare(`INSERT INTO life_domains
        (id, name, description, focus, color_key, icon_key, sort_order, created_at, updated_at)
        VALUES ('health', '健康', '', '', 'fern', 'heart', 0, '2026-09-22', '2026-09-22')`).run();
      const addInbox = db.prepare(`INSERT INTO inbox_items
        (id, content, source, status, target_type, target_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      addInbox.run("captured", "一段旧想法", "quick-capture", "unprocessed", null, null, "t1", "t2");
      addInbox.run("reserved", "待完成整理", "inbox", "processing", "action", "inbox-reserved", "t3", "t4");
      addInbox.run("organized", "已整理文本", "inbox", "organized", "review", "inbox-organized", "t5", "t6");
      addInbox.run("archived", "已归档文本", "quick-capture", "archived", null, null, "t7", "t8");
      const before = db.prepare("SELECT * FROM inbox_items ORDER BY id").all();
      for (const statement of m4IssuesMigration.statements) db.exec(statement);
      expect(db.prepare("SELECT * FROM inbox_items ORDER BY id").all()).toEqual(before);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

      const insert = db.prepare(`INSERT INTO issue_writes
        (id, title, description, first_seen, occurrence_count, cause_hypothesis,
         attempts, follow_up, status, goal_id, created_at, updated_at, domain_ids_json)
        VALUES (?, ?, '', '2026-09-23', 1, '', '', '', 'open', NULL, 't1', 't1', ?)`);
      expect(() => insert.run("invalid", "不能保存", '["missing"]')).toThrow();
      expect(db.prepare("SELECT * FROM issues WHERE id = 'invalid'").get()).toBeUndefined();
      insert.run("valid", "原问题", '["health"]');
      const update = db.prepare(`UPDATE issue_writes
        SET title = '更改标题', domain_ids_json = '["missing"]' WHERE id = 'valid'`);
      expect(() => update.run()).toThrow();
      expect(db.prepare("SELECT title FROM issues WHERE id = 'valid'").get())
        .toEqual({ title: "原问题" });
      expect(db.prepare("SELECT domain_id FROM issue_domain_links WHERE issue_id = 'valid'").all())
        .toEqual([{ domain_id: "health" }]);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare(`UPDATE inbox_items SET status = 'processing',
        target_type = 'issue', target_id = 'inbox-captured' WHERE id = 'captured'`).run().changes).toBe(1);
    } finally {
      db.close();
    }
  });
});
