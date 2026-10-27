import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { m4DecisionsMigration } from "../../src/db/migrations/0007-m4-decisions";
import { normalizeDecisionDraft, type DecisionDraft } from "../../src/domain/decisions/Decision";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteDecisionRepository } from "../../src/repositories/sqlite/SqliteDecisionRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteInboxRepository } from "../../src/repositories/sqlite/SqliteInboxRepository";
import { SqliteIssueRepository } from "../../src/repositories/sqlite/SqliteIssueRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteActionRepository } from "../../src/repositories/sqlite/SqliteActionRepository";
import { SqliteReviewRepository } from "../../src/repositories/sqlite/SqliteReviewRepository";
import { SqliteLifeRecordsRepository } from "../../src/repositories/sqlite/SqliteLifeRecordsRepository";
import type { SqliteExecutor } from "../../src/repositories/sqlite/SqliteExecutor";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
import { DecisionService } from "../../src/services/decisions/DecisionService";
import { InboxService } from "../../src/services/inbox/InboxService";
import { IssueService } from "../../src/services/issues/IssueService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { ActionService } from "../../src/services/planning/ActionService";
import { GoalService } from "../../src/services/planning/GoalService";
import { ReviewService } from "../../src/services/reviews/ReviewService";
import { LifeRecordsService } from "../../src/services/records/LifeRecordsService";

const clock = { now: () => new Date("2026-09-23T08:00:00.000Z") };
let sequence = 0;
const ids = { next: () => `decision-${++sequence}` };

function draft(overrides: Partial<DecisionDraft> = {}): DecisionDraft {
  return {
    title: "是否调整工作节奏", decidedOn: "2026-09-23",
    importance: "ordinary", status: "considering", background: "",
    options: "", constraints: "", criteria: "", risks: "", opportunityCost: "",
    reversibility: "unknown", choice: "", rationale: "", executionConditions: "",
    outcome: "", reflection: "", goalId: null, domainIds: [], ...overrides,
  };
}

function setup(executor: SqliteExecutor) {
  const domains = new SqliteLifeDomainRepository(executor);
  const goals = new SqliteGoalRepository(executor);
  const decisions = new SqliteDecisionRepository(executor);
  const lifeDomainService = new LifeDomainService(domains, clock, ids);
  const goalService = new GoalService(goals, domains, clock, ids);
  const decisionService = new DecisionService(decisions, domains, goals, clock, ids);
  const inbox = new InboxService(
    new SqliteInboxRepository(executor), lifeDomainService, goalService,
    new ActionService(new SqliteActionRepository(executor), goals, domains, clock, ids),
    new ReviewService(new SqliteReviewRepository(executor), domains, clock, ids),
    new IssueService(new SqliteIssueRepository(executor), domains, goals, clock, ids),
    decisionService, clock, ids,
    new LifeRecordsService(new SqliteLifeRecordsRepository(executor), domains, goals, clock, ids),
  );
  return { lifeDomainService, goalService, decisionService, inbox };
}

describe("M4 decision records", () => {
  it("validates dated drafts, choice, field lengths and link identities", () => {
    expect(normalizeDecisionDraft(draft({
      title: "  一个议题 ", domainIds: ["one", "one", "two"],
    }))).toMatchObject({ title: "一个议题", domainIds: ["one", "two"] });
    expect(() => normalizeDecisionDraft(draft({ decidedOn: "2026-02-30" }))).toThrow("日期");
    expect(() => normalizeDecisionDraft(draft({ status: "decided" }))).toThrow("最终选择");
    expect(() => normalizeDecisionDraft(draft({ options: "x".repeat(2001) }))).toThrow("2000");
    expect(() => normalizeDecisionDraft(draft({ domainIds: [" "] }))).toThrow("生活领域");
  });

  it("upgrades a light record without losing its history and edits a major decision", async () => {
    const executor = new MemorySqliteExecutor();
    await new MigrationRunner(executor, migrations, clock).run();
    const { lifeDomainService, goalService, decisionService } = setup(executor);
    const health = await lifeDomainService.create({
      name: "健康", description: "", focus: "", color: "fern", icon: "heart",
    });
    const work = await lifeDomainService.create({
      name: "事业", description: "", focus: "", color: "ocean", icon: "briefcase",
    });
    const goal = await goalService.create({
      title: "保持精力", description: "", domainId: null, status: "active", targetDate: null,
    });
    const ordinary = await decisionService.create(draft({ background: "暂时先记下来" }));
    const major = await decisionService.update(ordinary.id, draft({
      importance: "major", background: "暂时先记下来", options: "减少加班或换岗",
      criteria: "健康与收入", risks: "短期收入变化", opportunityCost: "闲暇时间",
      reversibility: "reversible", status: "decided", choice: "先减少加班",
      rationale: "先做小范围试验", outcome: "开始尝试", reflection: "稍后回看",
      domainIds: [work.id, health.id, work.id], goalId: goal.id,
    }));
    expect(major).toMatchObject({ id: ordinary.id, createdAt: ordinary.createdAt,
      importance: "major", choice: "先减少加班", goalId: goal.id });
    expect(await decisionService.findById(major.id)).toMatchObject({
      domainIds: [health.id, work.id].sort(), criteria: "健康与收入", reflection: "稍后回看",
    });
    await expect(decisionService.update(major.id, draft())).rejects.toThrow("不能降级");
    await expect(decisionService.update(major.id, draft({
      importance: "major", domainIds: ["missing"],
    }))).rejects.toThrow("生活领域");
    await expect(decisionService.create(draft({ goalId: "missing" }))).rejects.toThrow("目标");
    expect(await decisionService.list()).toHaveLength(1);
  });

  it("converts a captured choice into a major record once even when marking the inbox fails", async () => {
    const memory = new MemorySqliteExecutor();
    let failFinish = true;
    const executor: SqliteExecutor = {
      select: (sql, bind) => memory.select(sql, bind),
      executeTransaction: (statements) => memory.executeTransaction(statements),
      execute: (sql, bind) => {
        if (failFinish && sql.includes("status = 'organized'")) {
          failFinish = false;
          throw new Error("暂时无法标记整理");
        }
        return memory.execute(sql, bind);
      },
    };
    await new MigrationRunner(executor, migrations, clock).run();
    const { inbox, decisionService } = setup(executor);
    const item = await inbox.capture("要不要调整工作");
    const conversion = { type: "decision" as const,
      draft: draft({ title: "调整工作", importance: "major", background: item.content }) };
    await expect(inbox.convert(item.id, conversion)).rejects.toThrow("无法标记整理");
    expect(await inbox.hasReservedTarget(item.id)).toBe(true);
    expect((await decisionService.list())[0]).toMatchObject({
      id: `inbox-${item.id}`, importance: "major", background: item.content,
    });
    await inbox.finishProcessing(item.id);
    await inbox.convert(item.id, { ...conversion, draft: draft({ title: "不应覆盖" }) });
    expect(await decisionService.list()).toHaveLength(1);
    expect((await decisionService.list())[0].title).toBe("调整工作");
    expect((await inbox.list())[0]).toMatchObject({ status: "organized", targetType: "decision" });
  });

  it("migrates old inbox states intact and atomically rolls back invalid decision links", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      for (const migration of migrations.slice(0, 6)) {
        for (const statement of migration.statements) db.exec(statement);
      }
      db.prepare(`INSERT INTO life_domains
        (id, name, description, focus, color_key, icon_key, sort_order, created_at, updated_at)
        VALUES ('health', '健康', '', '', 'fern', 'heart', 0, 't1', 't1')`).run();
      const add = db.prepare(`INSERT INTO inbox_items
        (id, content, source, status, target_type, target_id, created_at, updated_at)
        VALUES (?, ?, 'inbox', ?, ?, ?, 't1', 't2')`);
      add.run("new", "待整理", "unprocessed", null, null);
      add.run("processing", "正在整理", "processing", "issue", "inbox-processing");
      add.run("done", "已整理", "organized", "goal", "inbox-done");
      add.run("archived", "已归档", "archived", null, null);
      const before = db.prepare("SELECT * FROM inbox_items ORDER BY id").all();
      for (const statement of m4DecisionsMigration.statements) db.exec(statement);
      expect(db.prepare("SELECT * FROM inbox_items ORDER BY id").all()).toEqual(before);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

      const insert = db.prepare(`INSERT INTO decision_writes
        (id, title, decided_on, importance, status, background, options, constraints_text,
         criteria, risks, opportunity_cost, reversibility, choice, rationale, execution_conditions,
         outcome, reflection, goal_id, created_at, updated_at, domain_ids_json)
        VALUES (?, '工作选择', '2026-09-23', 'major', 'considering',
          '', '', '', '', '', '', 'unknown', '', '', '', '', '', NULL, 't1', 't1', ?)`);
      expect(() => insert.run("bad", '["missing"]')).toThrow();
      expect(db.prepare("SELECT * FROM decisions WHERE id = 'bad'").get()).toBeUndefined();
      insert.run("good", '["health"]');
      expect(() => db.prepare(`UPDATE decision_writes SET title = '不能生效',
        domain_ids_json = '["missing"]' WHERE id = 'good'`).run()).toThrow();
      expect(db.prepare("SELECT title FROM decisions WHERE id = 'good'").get())
        .toEqual({ title: "工作选择" });
      expect(db.prepare("SELECT domain_id FROM decision_domain_links WHERE decision_id = 'good'").all())
        .toEqual([{ domain_id: "health" }]);
      expect(() => db.prepare(`UPDATE decision_writes SET importance = 'ordinary'
        WHERE id = 'good'`).run()).toThrow();
      expect(db.prepare("SELECT importance FROM decisions WHERE id = 'good'").get())
        .toEqual({ importance: "major" });
      expect(db.prepare(`UPDATE inbox_items SET status = 'processing', target_type = 'decision',
        target_id = 'inbox-new' WHERE id = 'new'`).run().changes).toBe(1);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("reads and writes the complete decision dossier through the real SQLite adapter", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      for (const migration of migrations) {
        for (const statement of migration.statements) db.exec(statement);
      }
      const executor = nativeSqliteExecutor(db);
      const { lifeDomainService, goalService, decisionService } = setup(executor);
      const domain = await lifeDomainService.create({
        name: "事业", description: "", focus: "", color: "ocean", icon: "briefcase",
      });
      const goal = await goalService.create({
        title: "平衡工作", description: "", domainId: null, status: "active", targetDate: null,
      });
      const record = await decisionService.create(draft({
        importance: "major", options: "A 或 B", constraints: "时间有限",
        goalId: goal.id, domainIds: [domain.id],
      }));
      expect(await decisionService.findById(record.id)).toMatchObject({
        title: record.title, options: "A 或 B", constraints: "时间有限",
        domainIds: [domain.id], goalId: goal.id,
      });
      await decisionService.update(record.id, draft({
        importance: "major", status: "decided", choice: "A", rationale: "更可持续",
        reversibility: "difficult", outcome: "已开始", domainIds: [],
      }));
      expect(await decisionService.findById(record.id)).toMatchObject({
        choice: "A", rationale: "更可持续", reversibility: "difficult",
        outcome: "已开始", goalId: null, domainIds: [],
      });
      expect(db.prepare("SELECT * FROM decision_domain_links").all()).toEqual([]);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
