import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { m4InboxMigration } from "../../src/db/migrations/0005-m4-inbox";
import { suggestInboxTarget } from "../../src/domain/inbox/InboxItem";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteInboxRepository } from "../../src/repositories/sqlite/SqliteInboxRepository";
import { SqliteIssueRepository } from "../../src/repositories/sqlite/SqliteIssueRepository";
import { SqliteDecisionRepository } from "../../src/repositories/sqlite/SqliteDecisionRepository";
import { SqliteActionRepository } from "../../src/repositories/sqlite/SqliteActionRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteReviewRepository } from "../../src/repositories/sqlite/SqliteReviewRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteLifeRecordsRepository } from "../../src/repositories/sqlite/SqliteLifeRecordsRepository";
import type { SqliteExecutor } from "../../src/repositories/sqlite/SqliteExecutor";
import { InboxService } from "../../src/services/inbox/InboxService";
import { IssueService } from "../../src/services/issues/IssueService";
import { DecisionService } from "../../src/services/decisions/DecisionService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { ActionService } from "../../src/services/planning/ActionService";
import { GoalService } from "../../src/services/planning/GoalService";
import { ReviewService } from "../../src/services/reviews/ReviewService";
import { LifeRecordsService } from "../../src/services/records/LifeRecordsService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
import { v1InboxRecordTargetsMigration } from "../../src/db/migrations/0046-v1-inbox-record-targets";
import { inboxTargetHref } from "../../src/domain/inbox/InboxItem";
import { inspectBackup, identityRoleBackupTables } from "../../src/domain/backup/Backup";

const clock = { now: () => new Date("2026-09-23T08:00:00.000Z") };

function setup(executor: SqliteExecutor = new MemorySqliteExecutor()) {
  const domains = new SqliteLifeDomainRepository(executor);
  const goals = new SqliteGoalRepository(executor);
  const actions = new SqliteActionRepository(executor);
  const reviews = new SqliteReviewRepository(executor);
  const issues = new SqliteIssueRepository(executor);
  const decisions = new SqliteDecisionRepository(executor);
  let sequence = 0;
  const ids = { next: () => `item-${++sequence}` };
  const lifeDomainService = new LifeDomainService(domains, clock, ids);
  const goalService = new GoalService(goals, domains, clock, ids);
  const actionService = new ActionService(actions, goals, domains, clock, ids);
  const reviewService = new ReviewService(reviews, domains, clock, ids);
  const issueService = new IssueService(issues, domains, goals, clock, ids);
  const decisionService = new DecisionService(decisions, domains, goals, clock, ids);
  const records = new LifeRecordsService(new SqliteLifeRecordsRepository(executor), domains, goals, clock, ids);
  const inbox = new InboxService(new SqliteInboxRepository(executor), lifeDomainService,
    goalService, actionService, reviewService, issueService, decisionService, clock, ids, records);
  return { executor, inbox, lifeDomainService, goalService, actionService, reviewService, issueService,
    decisionService, records };
}

describe("M4 inbox capture and deliberate conversion", () => {
  it("reads existing object suggestions without reserving, creating or modifying anything", async () => {
    const { executor, inbox, lifeDomainService, goalService, records } = setup();
    await new MigrationRunner(executor, migrations, clock).run();
    const domain = await lifeDomainService.create({
      name: "健康", description: "", focus: "", color: "fern", icon: "heart",
    });
    const goal = await goalService.create({
      title: "睡眠调整", description: "", domainId: domain.id, targetDate: null, status: "active",
    });
    const person = await records.savePerson({
      name: "小林", notes: "", domainIds: [], relationshipType: "", state: "",
      importantDate: null, lastContact: null, sharedExperiences: "",
    });
    const item = await inbox.capture("明天与小林商量健康和睡眠调整");
    const before = {
      inbox: await inbox.list(), goals: await goalService.list(), people: await records.listPeople(),
    };
    const matches = await inbox.suggestObjects(item.content);
    expect(matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "domain", id: domain.id }),
      expect.objectContaining({ type: "goal", id: goal.id }),
      expect.objectContaining({ type: "person", id: person.id }),
    ]));
    expect({ inbox: await inbox.list(), goals: await goalService.list(), people: await records.listPeople() })
      .toEqual(before);
    expect((await inbox.list()).find(entry => entry.id === item.id)?.status).toBe("unprocessed");
  });

  it("keeps original text, archives and restores, and never classifies on capture", async () => {
    const { executor, inbox } = setup();
    await new MigrationRunner(executor, migrations, clock).run();
    const text = "  明天预约检查\n只是先记下来。  ";
    await expect(inbox.capture("  ")).rejects.toThrow("先写下");
    await expect(inbox.capture("x".repeat(4001))).rejects.toThrow("4000");
    const item = await inbox.capture(text, "quick-capture");
    expect(item).toMatchObject({
      content: text, status: "unprocessed", targetType: null, source: "quick-capture",
    });
    expect(suggestInboxTarget(text)).toMatchObject({ type: "action", reason: expect.any(String) });
    expect(suggestInboxTarget("发现了反复的问题")?.type).toBe("issue");
    expect(suggestInboxTarget("要不要换工作")?.type).toBe("decision");
    expect(suggestInboxTarget("复盘这一周")?.type).toBe("review");
    await inbox.archive(item.id);
    expect((await inbox.list())[0].status).toBe("archived");
    await inbox.restore(item.id);
    expect((await inbox.list())[0].content).toBe(text);
    await expect(inbox.restore(item.id)).rejects.toThrow("已变化");
  });

  it("converts into real planning and review objects with optional domain context", async () => {
    const { executor, inbox, lifeDomainService, goalService, actionService, reviewService } = setup();
    await new MigrationRunner(executor, migrations, clock).run();
    const domain = await lifeDomainService.create({
      name: "健康", description: "", focus: "", color: "fern", icon: "heart",
    });
    const goal = await inbox.capture("睡好觉");
    const action = await inbox.capture("早点放下手机");
    const review = await inbox.capture("昨晚更早休息了");
    await inbox.convert(goal.id, { type: "goal", draft: {
      title: "调整睡眠", description: "", domainId: domain.id, status: "active", targetDate: null,
    } });
    await inbox.convert(action.id, { type: "action", draft: {
      title: "今晚早点放下手机", notes: "", goalId: `inbox-${goal.id}`,
      domainId: domain.id, scheduledFor: null,
    } });
    await inbox.convert(review.id, { type: "review", draft: {
      title: "睡前回看", reflection: "更安静了", insight: "", nextFocus: "",
      domainId: null, reviewedOn: "2026-09-22",
    } });
    expect((await goalService.list())[0]).toMatchObject({ id: `inbox-${goal.id}`, domainId: domain.id });
    expect((await actionService.list())[0]).toMatchObject({
      id: `inbox-${action.id}`, goalId: `inbox-${goal.id}`,
    });
    expect((await reviewService.list())[0]).toMatchObject({
      id: `inbox-${review.id}`, reviewedOn: "2026-09-22",
    });
    expect(await inbox.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: goal.id, content: "睡好觉", status: "organized", targetType: "goal" }),
      expect.objectContaining({ id: action.id, content: "早点放下手机", status: "organized" }),
    ]));
    await expect(inbox.archive(goal.id)).rejects.toThrow("已变化");
  });

  it("rejects invalid drafts before reservation and keeps archived records out of conversion", async () => {
    const { executor, inbox } = setup();
    await new MigrationRunner(executor, migrations, clock).run();
    const item = await inbox.capture("下周再想想");
    await expect(inbox.convert(item.id, { type: "action", draft: {
      title: " ", notes: "", goalId: null, domainId: null, scheduledFor: null,
    } })).rejects.toThrow("行动");
    await expect(inbox.convert(item.id, { type: "action", draft: {
      title: "安排", notes: "", goalId: null, domainId: "missing", scheduledFor: null,
    } })).rejects.toThrow("生活领域");
    expect((await inbox.list())[0].status).toBe("unprocessed");
    await inbox.archive(item.id);
    await expect(inbox.convert(item.id, { type: "action", draft: {
      title: "安排", notes: "", goalId: null, domainId: null, scheduledFor: null,
    } })).rejects.toThrow("已处理");
  });

  it("does not attach an unprocessed inbox item to an existing formal object", async () => {
    const { executor, inbox, goalService } = setup();
    await new MigrationRunner(executor, migrations, clock).run();
    const item = await inbox.capture("新方向");
    await goalService.createWithId(`inbox-${item.id}`, {
      title: "已有的目标", description: "", status: "active", domainId: null, targetDate: null,
    });
    await expect(inbox.convert(item.id, { type: "goal", draft: {
      title: "新方向", description: "", status: "active", domainId: null, targetDate: null,
    } })).rejects.toThrow("已被占用");
    expect((await inbox.list())[0].status).toBe("unprocessed");
    expect((await goalService.list()).map((goal) => goal.title)).toEqual(["已有的目标"]);
  });

  it("recovers after a partial write without creating a duplicate target", async () => {
    const memory = new MemorySqliteExecutor();
    let failFinish = true;
    const executor: SqliteExecutor = {
      select: (sql, bind) => memory.select(sql, bind),
      executeTransaction: (statements) => memory.executeTransaction(statements),
      execute: (sql, bind) => {
        if (failFinish && sql.includes("status = 'organized'")) {
          failFinish = false;
          throw new Error("disk temporarily unavailable");
        }
        return memory.execute(sql, bind);
      },
    };
    const { inbox, actionService } = setup(executor);
    await new MigrationRunner(executor, migrations, clock).run();
    const item = await inbox.capture("预约牙医");
    const draft = { title: "预约牙医", notes: "", goalId: null, domainId: null, scheduledFor: null };
    await expect(inbox.convert(item.id, { type: "action", draft })).rejects.toThrow("disk");
    expect((await inbox.list())[0]).toMatchObject({ status: "processing", targetId: `inbox-${item.id}` });
    expect(await actionService.list()).toHaveLength(1);
    expect(await inbox.hasReservedTarget(item.id)).toBe(true);
    await expect(inbox.convert(item.id, { type: "goal", draft: {
      title: "另一个方向", description: "", status: "active", domainId: null, targetDate: null,
    } })).rejects.toThrow("另一个模块");
    expect(await inbox.finishProcessing(item.id)).toMatchObject({ status: "organized" });
    await expect(inbox.hasReservedTarget(item.id)).rejects.toThrow("已变化");
    await inbox.convert(item.id, { type: "action", draft: { ...draft, title: "不应覆盖原行动" } });
    await inbox.convert(item.id, { type: "action", draft });
    expect(await actionService.list()).toHaveLength(1);
    expect((await actionService.list())[0].title).toBe("预约牙医");
  });

  it("allows editing and retry when the reserved target was never created", async () => {
    const memory = new MemorySqliteExecutor();
    let failCreate = true;
    const executor: SqliteExecutor = {
      select: (sql, bind) => memory.select(sql, bind),
      executeTransaction: (statements) => {
        if (failCreate && statements.some(({ statement }) => statement.includes("INSERT INTO actions"))) {
          failCreate = false;
          return Promise.reject(new Error("target insert failed"));
        }
        return memory.executeTransaction(statements);
      },
      execute: (sql, bind) => memory.execute(sql, bind),
    };
    const { inbox, actionService } = setup(executor);
    await new MigrationRunner(executor, migrations, clock).run();
    const item = await inbox.capture("安排体检");
    const draft = { title: "安排体检", notes: "", goalId: null, domainId: null, scheduledFor: null };
    await expect(inbox.convert(item.id, { type: "action", draft })).rejects.toThrow("target insert failed");
    expect(await inbox.hasReservedTarget(item.id)).toBe(false);
    await expect(inbox.finishProcessing(item.id)).rejects.toThrow("尚未创建");
    expect((await inbox.list())[0].status).toBe("processing");
    await inbox.convert(item.id, { type: "action", draft: { ...draft, title: "预约体检" } });
    expect((await actionService.list()).map((action) => action.title)).toEqual(["预约体检"]);
    expect((await inbox.list())[0].status).toBe("organized");
  });

  it("converts a suggested problem into a formal issue with multiple domains", async () => {
    const { executor, inbox, lifeDomainService, goalService, issueService } = setup();
    await new MigrationRunner(executor, migrations, clock).run();
    const health = await lifeDomainService.create({
      name: "健康", description: "", focus: "", color: "fern", icon: "heart",
    });
    const work = await lifeDomainService.create({
      name: "事业", description: "", focus: "", color: "ocean", icon: "briefcase",
    });
    const goal = await goalService.create({
      title: "改善作息", description: "", domainId: null, status: "active", targetDate: null,
    });
    const item = await inbox.capture("睡眠总是被工作打断");
    expect(suggestInboxTarget(item.content)?.type).toBe("issue");
    const draft = {
      title: "睡眠受工作影响", description: item.content, firstSeen: "2026-09-22",
      occurrenceCount: 3, status: "open" as const, goalId: goal.id,
      domainIds: [health.id, work.id], causeHypothesis: "", attempts: "", followUp: "",
    };
    await inbox.convert(item.id, { type: "issue", draft });
    expect((await issueService.list())[0]).toMatchObject({
      id: `inbox-${item.id}`, domainIds: [health.id, work.id].sort(),
      goalId: goal.id, occurrenceCount: 3,
    });
    expect((await inbox.list())[0]).toMatchObject({ status: "organized", targetType: "issue" });
  });

  it("recovers an issue conversion after the formal record was written", async () => {
    const memory = new MemorySqliteExecutor();
    let failFinish = true;
    const executor: SqliteExecutor = {
      select: (sql, bind) => memory.select(sql, bind),
      executeTransaction: (statements) => memory.executeTransaction(statements),
      execute: (sql, bind) => {
        if (failFinish && sql.includes("status = 'organized'")) {
          failFinish = false;
          throw new Error("disk temporarily unavailable");
        }
        return memory.execute(sql, bind);
      },
    };
    const { inbox, issueService } = setup(executor);
    await new MigrationRunner(executor, migrations, clock).run();
    const item = await inbox.capture("问题反复出现");
    const draft = {
      title: "反复出现", description: item.content, firstSeen: "2026-09-23",
      occurrenceCount: 1, status: "open" as const, goalId: null, domainIds: [],
      causeHypothesis: "", attempts: "", followUp: "",
    };
    await expect(inbox.convert(item.id, { type: "issue", draft })).rejects.toThrow("disk");
    expect(await inbox.hasReservedTarget(item.id)).toBe(true);
    expect((await inbox.list())[0]).toMatchObject({ status: "processing", targetType: "issue" });
    await inbox.finishProcessing(item.id);
    expect(await issueService.list()).toHaveLength(1);
    expect((await inbox.list())[0].status).toBe("organized");
  });

  it("only lets one conversion type win for concurrent attempts", async () => {
    const { executor, inbox, goalService, actionService } = setup();
    await new MigrationRunner(executor, migrations, clock).run();
    const item = await inbox.capture("明天看看");
    const outcomes = await Promise.allSettled([
      inbox.convert(item.id, { type: "goal", draft: {
        title: "目标", description: "", status: "active", domainId: null, targetDate: null,
      } }),
      inbox.convert(item.id, { type: "action", draft: {
        title: "行动", notes: "", goalId: null, domainId: null, scheduledFor: null,
      } }),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await goalService.list()).length + (await actionService.list()).length).toBe(1);
    expect((await inbox.list())[0].status).toBe("organized");
  });

  it("adds M4 schema without rewriting M3 user data, in real SQLite", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      for (const migration of migrations.slice(0, 4)) {
        for (const statement of migration.statements) db.exec(statement);
      }
      db.prepare(`INSERT INTO life_domains
        (id, name, description, focus, color_key, icon_key, sort_order, created_at, updated_at)
        VALUES ('d', '健康', '', '', 'fern', 'heart', 0, '2026-09-22', '2026-09-22')`).run();
      db.prepare(`INSERT INTO reviews
        (id, title, domain_id, reviewed_on, created_at, updated_at)
        VALUES ('r', '之前的回顾', 'd', '2026-09-22', '2026-09-22', '2026-09-22')`).run();
      for (const statement of m4InboxMigration.statements) db.exec(statement);
      expect(db.prepare("SELECT title, domain_id FROM reviews WHERE id = 'r'").get())
        .toMatchObject({ title: "之前的回顾", domain_id: "d" });
      expect(db.prepare("SELECT name FROM life_domains WHERE id = 'd'").get())
        .toMatchObject({ name: "健康" });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'inbox_items'").get())
        .toMatchObject({ name: "inbox_items" });
    } finally {
      db.close();
    }
  });

  it("enforces capture and conversion states on a clean SQLite database", () => {
    const db = new DatabaseSync(":memory:");
    try {
      for (const migration of migrations) {
        for (const statement of migration.statements) db.exec(statement);
      }
      const insert = db.prepare(`INSERT INTO inbox_items
        (id, content, source, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);
      insert.run("new", "一段原文", "inbox", "unprocessed", "2026-09-23", "2026-09-23");
      expect(() => insert.run("empty", "  ", "inbox", "unprocessed",
        "2026-09-23", "2026-09-23")).toThrow();
      const reserve = db.prepare(`UPDATE inbox_items
        SET status = 'processing', target_type = 'action', target_id = 'inbox-new'
        WHERE id = 'new' AND status = 'unprocessed'`);
      expect(reserve.run().changes).toBe(1);
      expect(reserve.run().changes).toBe(0);
      expect(db.prepare("SELECT content, target_id FROM inbox_items WHERE id = 'new'").get())
        .toMatchObject({ content: "一段原文", target_id: "inbox-new" });
      expect(db.prepare(`UPDATE inbox_items SET status = 'organized'
        WHERE id = 'new' AND status = 'processing'`).run().changes).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe("V1 inbox person and event conversion", () => {
  for (const storage of ["memory", "sqlite"] as const) {
    it(`preserves capture and explicit links when creating people and events (${storage})`, async () => {
      const db = storage === "sqlite" ? new DatabaseSync(":memory:") : null;
      try {
        db?.exec("PRAGMA foreign_keys = ON");
        const services = setup(db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor());
        await new MigrationRunner(services.executor, migrations, clock).run();
        const domain = await services.lifeDomainService.create({
          name: "关系", description: "", focus: "", color: "fern", icon: "heart",
        });
        const goal = await services.goalService.create({
          title: "保持联系", description: "", status: "active", domainId: null, targetDate: null,
        });
        const text = "  认识了新朋友\n一起学习  ";
        const personCapture = await services.inbox.capture(text);
        const personDraft = { name: "小林", relationshipType: "朋友", state: "", importantDate: null,
          lastContact: "2026-09-22", sharedExperiences: "一起学习", notes: text,
          domainIds: [domain.id] };
        await services.inbox.convert(personCapture.id, { type: "person", draft: personDraft });
        const personId = `inbox-${personCapture.id}`;
        expect(await services.records.listPeople()).toEqual([
          expect.objectContaining({ id: personId, name: "小林", domainIds: [domain.id], notes: text.trim() }),
        ]);
        const eventCapture = await services.inbox.capture("重要事件：一起完成学习计划");
        const eventDraft = { title: "完成学习计划", happenedOn: "2026-09-22",
          description: eventCapture.content, personId, goalId: goal.id, domainIds: [domain.id] };
        await services.inbox.convert(eventCapture.id, { type: "event", draft: eventDraft });
        await services.inbox.convert(eventCapture.id, {
          type: "event", draft: { ...eventDraft, title: "不能覆盖原记录" },
        });
        expect(await services.records.listEvents()).toEqual([
          expect.objectContaining({ ...eventDraft, id: `inbox-${eventCapture.id}` }),
        ]);
        expect(await services.inbox.list()).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: personCapture.id, content: text,
            status: "organized", targetType: "person", targetId: personId }),
          expect.objectContaining({ id: eventCapture.id, status: "organized", targetType: "event" }),
        ]));
        if (db) {
          const data = Object.fromEntries(identityRoleBackupTables.map(table => [
            table, db.prepare(`SELECT * FROM ${table}`).all(),
          ]));
          const backup = { format: "lifeos-backup", schemaVersion: 46,
            appVersion: "test", exportedAt: clock.now().toISOString(), data };
          expect(inspectBackup(backup).counts.inbox_items).toBe(2);
          expect(() => inspectBackup({ ...backup, schemaVersion: 45 })).toThrow("未知");
          const orphan = structuredClone(backup);
          orphan.data.life_events = [];
          expect(() => inspectBackup(orphan)).toThrow();
          const processing = structuredClone(backup);
          processing.data.inbox_items = [{
            id: "pending", content: "待重试", source: "inbox", status: "processing",
            target_type: "event", target_id: "inbox-pending",
            created_at: clock.now().toISOString(), updated_at: clock.now().toISOString(),
          }];
          expect(inspectBackup(processing).counts.inbox_items).toBe(1);
          processing.data.inbox_items[0].target_type = "unknown";
          expect(() => inspectBackup(processing)).toThrow("未知");
          processing.data.inbox_items[0].target_type = "event";
          processing.data.inbox_items[0].status = "unprocessed";
          expect(() => inspectBackup(processing)).toThrow("不一致");
        }
      } finally { db?.close(); }
    });
  }

  it("validates person, event dates and links before reserving the capture", async () => {
    const { executor, inbox, records } = setup();
    await new MigrationRunner(executor, migrations, clock).run();
    const item = await inbox.capture("先记录");
    const person = { name: "小林", notes: "", relationshipType: "", state: "",
      importantDate: null, lastContact: null, sharedExperiences: "", domainIds: [] };
    await expect(inbox.convert(item.id, { type: "person", draft: { ...person, name: " " } }))
      .rejects.toThrow("人物");
    await expect(inbox.convert(item.id, { type: "person", draft: { ...person, domainIds: ["missing"] } }))
      .rejects.toThrow("领域");
    const event = { title: "聚会", happenedOn: "2026-09-22", description: "",
      personId: null, goalId: null, domainIds: [] };
    await expect(inbox.convert(item.id, { type: "event", draft: { ...event, happenedOn: "2026-02-30" } }))
      .rejects.toThrow("日期");
    await expect(inbox.convert(item.id, { type: "event", draft: { ...event, personId: "missing" } }))
      .rejects.toThrow("人物");
    await expect(inbox.convert(item.id, { type: "event", draft: { ...event, goalId: "missing" } }))
      .rejects.toThrow("目标");
    expect((await inbox.list())[0]).toMatchObject({ status: "unprocessed", targetType: null });
    expect(await records.listPeople()).toHaveLength(0);
    expect(await records.listEvents()).toHaveLength(0);
  });

  for (const type of ["person", "event"] as const) {
    it(`allows editing and retrying ${type} when the reserved insert failed`, async () => {
      const memory = new MemorySqliteExecutor();
      let failCreate = true;
      const executor: SqliteExecutor = {
        select: (sql, bind) => memory.select(sql, bind),
        execute: (sql, bind) => memory.execute(sql, bind),
        executeTransaction: statements => {
          const table = type === "person" ? "people" : "life_events";
          if (failCreate && statements.some(item => item.statement.includes(`INSERT INTO ${table}`))) {
            failCreate = false;
            return Promise.reject(new Error("insert unavailable"));
          }
          return memory.executeTransaction(statements);
        },
      };
      const { inbox, records } = setup(executor);
      await new MigrationRunner(executor, migrations, clock).run();
      const item = await inbox.capture("原始记录");
      const conversion = type === "person"
        ? { type, draft: { name: "小林", notes: "", relationshipType: "", state: "",
            importantDate: null, lastContact: null, sharedExperiences: "", domainIds: [] } }
        : { type, draft: { title: "聚会", happenedOn: "2026-09-22", description: "",
            personId: null, goalId: null, domainIds: [] } };
      await expect(inbox.convert(item.id, conversion)).rejects.toThrow("insert unavailable");
      expect(await inbox.hasReservedTarget(item.id)).toBe(false);
      await expect(inbox.finishProcessing(item.id)).rejects.toThrow("尚未创建");
      if (conversion.type === "person") {
        await inbox.convert(item.id, { type: "person", draft: { ...conversion.draft, name: "小李" } });
        expect((await records.listPeople()).map(person => person.name)).toEqual(["小李"]);
      } else {
        await inbox.convert(item.id, { type: "event", draft: { ...conversion.draft, title: "重聚" } });
        expect((await records.listEvents()).map(event => event.title)).toEqual(["重聚"]);
      }
      expect((await inbox.list())[0]).toMatchObject({ status: "organized", content: item.content });
    });

    it(`recovers ${type} after finish failure without duplicates or overwrites`, async () => {
      const memory = new MemorySqliteExecutor();
      let failFinish = true;
      const executor: SqliteExecutor = {
        select: (sql, bind) => memory.select(sql, bind),
        executeTransaction: statements => memory.executeTransaction(statements),
        execute: (sql, bind) => {
          if (failFinish && sql.includes("status = 'organized'")) {
            failFinish = false;
            return Promise.reject(new Error("finish unavailable"));
          }
          return memory.execute(sql, bind);
        },
      };
      const { inbox, records } = setup(executor);
      await new MigrationRunner(executor, migrations, clock).run();
      const item = await inbox.capture("原始记录");
      const conversion = type === "person"
        ? { type, draft: { name: "小林", notes: "", relationshipType: "", state: "",
            importantDate: null, lastContact: null, sharedExperiences: "", domainIds: [] } }
        : { type, draft: { title: "聚会", happenedOn: "2026-09-22", description: "",
            personId: null, goalId: null, domainIds: [] } };
      await expect(inbox.convert(item.id, conversion)).rejects.toThrow("finish unavailable");
      expect(await inbox.hasReservedTarget(item.id)).toBe(true);
      expect((await inbox.list())[0]).toMatchObject({ status: "processing", targetType: type });
      await inbox.finishProcessing(item.id);
      await inbox.convert(item.id, conversion);
      const rows = type === "person" ? await records.listPeople() : await records.listEvents();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(`inbox-${item.id}`);
    });
  }

  it("rejects fixed-id collisions and leaves the existing person unchanged", async () => {
    const { executor, inbox, records } = setup();
    await new MigrationRunner(executor, migrations, clock).run();
    const item = await inbox.capture("认识了新朋友");
    const draft = { name: "已有人物", notes: "", relationshipType: "", state: "",
      importantDate: null, lastContact: null, sharedExperiences: "", domainIds: [] };
    await records.createPersonWithId(`inbox-${item.id}`, draft);
    await expect(inbox.convert(item.id, { type: "person", draft: { ...draft, name: "新人物" } }))
      .rejects.toThrow("占用");
    expect((await records.listPeople())[0].name).toBe("已有人物");
    expect((await inbox.list())[0].status).toBe("unprocessed");
  });

  it("keeps recommendations explainable and encodes direct source links", () => {
    expect(suggestInboxTarget("认识了新朋友")?.type).toBe("person");
    expect(suggestInboxTarget("重要事件：毕业")?.type).toBe("event");
    expect(suggestInboxTarget("要不要搬家")?.type).toBe("decision");
    expect(inboxTargetHref("person", "人物 / 1")).toBe(`/people#${encodeURIComponent("person-人物 / 1")}`);
    expect(inboxTargetHref("event", "event-1")).toBe("/timeline#event-event-1");
  });

  it("preserves all version 45 inbox rows and rolls back an interrupted migration", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      for (const migration of migrations.filter(item => item.id < v1InboxRecordTargetsMigration.id)) {
        for (const statement of migration.statements) db.exec(statement);
      }
      const insert = db.prepare(`INSERT INTO inbox_items
        (id, content, source, status, target_type, target_id, created_at, updated_at, privacy_level)
        VALUES (?, ?, 'inbox', ?, ?, ?, '2026-09-22T08:00:00.000Z', '2026-09-23T08:00:00.000Z', ?)`);
      for (const [index, status] of ["unprocessed", "archived", "processing", "organized"].entries()) {
        const linked = status === "processing" || status === "organized";
        insert.run(status, `  ${status}\n原文  `, status, linked ? "action" : null,
          linked ? `inbox-${status}` : null, ["normal", "private", "highly_sensitive"][index % 3]);
      }
      const before = db.prepare("SELECT * FROM inbox_items ORDER BY id").all();
      db.exec("BEGIN IMMEDIATE");
      for (const statement of v1InboxRecordTargetsMigration.statements) db.exec(statement);
      db.exec("ROLLBACK");
      expect(db.prepare("SELECT * FROM inbox_items ORDER BY id").all()).toEqual(before);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'inbox_items_v46'").get()).toBeUndefined();
      db.exec("BEGIN IMMEDIATE");
      for (const statement of v1InboxRecordTargetsMigration.statements) db.exec(statement);
      db.exec("COMMIT");
      expect(db.prepare("SELECT * FROM inbox_items ORDER BY id").all()).toEqual(before);
      for (const type of ["event", "person"]) {
        insert.run(type, "新类型", "processing", type, `inbox-${type}`, "private");
      }
      expect(() => insert.run("invalid", "无效类型", "processing", "skill", "inbox-invalid", "private")).toThrow();
      expect(() => insert.run("empty", "空标识", "processing", "event", " ", "private")).toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });
});
