import { SqliteTemplateRepository } from "../../src/repositories/sqlite/SqliteTemplateRepository";
import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { calculateGoalProgress } from "../../src/domain/progress/GoalProgress";
import type { GoalProgressItemDraft } from "../../src/domain/progress/GoalProgressItem";
import { builtInTemplates, cloneTemplateDefaults, validateTemplate } from "../../src/domain/templates/Template";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteGoalProgressItemRepository } from "../../src/repositories/sqlite/SqliteGoalProgressItemRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { GoalService } from "../../src/services/planning/GoalService";
import { TemplateService } from "../../src/services/templates/TemplateService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const clock = { now: () => new Date("2026-10-08T08:00:00Z") };
const draft = { title: "模板方向", description: "", domainId: null,
  status: "active" as const, targetDate: null };
const kr: GoalProgressItemDraft = { kind: "key_result", title: "关键结果",
  targetValue: 10, currentValue: 4, weight: 3 };

describe("V1 goal template initial progress", () => {
  it("copies nested JSON defaults without sharing progress or export fields", () => {
    const source = { description: "说明", progressItems: [kr], sections: ["goal"],
      fields: { goal: ["title"] } };
    const copy = cloneTemplateDefaults(source);
    expect(copy).toEqual(source);
    (copy.progressItems as GoalProgressItemDraft[])[0].weight = 5;
    (copy.sections as string[]).push("action");
    (copy.fields as Record<string, string[]>).goal.push("description");
    expect(source.progressItems[0].weight).toBe(3);
    expect(source.sections).toEqual(["goal"]);
    expect(source.fields.goal).toEqual(["title"]);
  });

  it("scaffolds SMART and OKR while leaving habit and exploration unquantified", () => {
    const template = (id: string) => builtInTemplates.find((item) => item.id === id)!;
    expect((template("default-smart").defaults.progressItems as GoalProgressItemDraft[])
      .map((item) => item.kind)).toEqual(["milestone", "outcome"]);
    expect((template("default-okr").defaults.progressItems as GoalProgressItemDraft[])
      .map((item) => item.kind)).toEqual(["key_result", "key_result"]);
    expect(template("default-habit-goal").defaults.progressItems).toBeUndefined();
    expect(template("default-exploration").defaults.progressItems).toBeUndefined();
    expect(validateTemplate("goal", "旧模板", { description: "原有说明" }).defaults)
      .toEqual({ description: "原有说明" });
  });

  it.each([
    null, "invalid", [null], [{ ...kr, kind: "habit" }], [{ ...kr, title: 42 }],
    [{ ...kr, title: " " }], [{ ...kr, targetValue: 0 }],
    [{ ...kr, currentValue: -1 }], [{ ...kr, weight: Infinity }],
    Array.from({ length: 31 }, () => kr),
  ])("rejects malformed template progress: %j", (progressItems) => {
    expect(() => validateTemplate("goal", "模板", { progressItems })).toThrow();
  });

  it("only permits progress on goal templates and strips copied identity fields", () => {
    expect(() => validateTemplate("review", "复盘", { progressItems: [kr] })).toThrow();
    const source = { description: "说明", progressItems: [{ ...kr,
      id: "old-id", goalId: "old-goal", title: "  新结果  " }] };
    expect(validateTemplate("goal", "模板", source).defaults.progressItems)
      .toEqual([{ ...kr, title: "新结果" }]);
    expect(source.progressItems[0].title).toBe("  新结果  ");
  });

  for (const [name, create] of [
    ["SQLite", () => {
      const db = new DatabaseSync(":memory:");
      db.exec("PRAGMA foreign_keys = ON");
      return { sql: nativeSqliteExecutor(db), db, close: () => db.close() };
    }],
    ["browser preview", () => ({
      sql: new MemorySqliteExecutor(), db: null, close: () => {},
    })],
  ] as const) {
    it(`${name} creates goal, domain links and progress atomically, then retries`, async () => {
      const { sql, db, close } = create();
      try {
        await new MigrationRunner(sql, migrations, clock).run();
        let sequence = 0;
        const ids = { next: () => `template-progress-${++sequence}` };
        const domains = new SqliteLifeDomainRepository(sql);
        const life = new LifeDomainService(domains, clock, ids);
        const health = await life.create({ name: "健康", description: "", focus: "",
          color: "fern", icon: "heart" });
        const work = await life.create({ name: "事业", description: "", focus: "",
          color: "ocean", icon: "briefcase" });
        const goals = new SqliteGoalRepository(sql);
        const service = new GoalService(goals, domains, clock, ids);
        const progress = new SqliteGoalProgressItemRepository(sql);
        const history = new VersionHistoryService(new SqliteObjectVersionRepository(sql));
        const original = await service.create({ ...draft, title: "原有目标" });
        const linked = { ...draft, domainIds: [health.id, work.id] };
        const items: GoalProgressItemDraft[] = [kr, {
          kind: "milestone", title: "阶段结果", targetValue: 1, currentValue: 1, weight: 1,
        }];
        const transact = sql.executeTransaction.bind(sql);
        vi.spyOn(sql, "executeTransaction").mockImplementationOnce((statements) =>
          transact([...statements, statements[statements.length - 1]]));
        await expect(service.createWithId("retry-goal", linked, items)).rejects.toThrow();
        expect(await goals.list()).toEqual([original]);
        expect(await progress.list()).toEqual([]);
        expect(await sql.select("SELECT goal_id, domain_id FROM goal_domain_links ORDER BY goal_id, domain_id"))
          .toEqual([]);
        expect(await history.list("goal", "retry-goal")).toEqual([]);

        const goal = await service.createWithId("retry-goal", linked, items);
        expect((await goals.findById(goal.id))?.domainIds).toEqual([health.id, work.id]);
        const saved = await progress.list();
        expect(saved.map((item) => item.sortOrder)).toEqual([0, 1]);
        expect(new Set(saved.map((item) => item.id)).size).toBe(2);
        expect(saved.every((item) => item.goalId === goal.id && item.createdAt === goal.createdAt)).toBe(true);
        expect(calculateGoalProgress(await goals.list(), [], saved).get(goal.id)?.percent).toBe(55);
        expect(await history.list("goal", goal.id)).toEqual([]);
        await expect(service.createWithId(goal.id, draft, items)).rejects.toThrow();
        expect(await goals.findById(goal.id)).toEqual(goal);
        expect(await progress.list()).toEqual(saved);
        await expect(service.create(draft, [{ ...kr, weight: 0 }])).rejects.toThrow();
        await expect(service.create({ ...draft, domainId: "missing" }, items)).rejects.toThrow();
        expect(await goals.list()).toHaveLength(2);
        if (db) expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally { close(); }
    });

    it(`${name} roundtrips custom template items without rewriting created goals`, async () => {
      const { sql, close } = create();
      try {
        await new MigrationRunner(sql, migrations, clock).run();
        let sequence = 0;
        const ids = { next: () => `template-copy-${++sequence}` };
        const templates = new TemplateService(new SqliteTemplateRepository(sql), clock, ids);
        const preset = (await templates.find("default-smart"))!;
        const snapshot = structuredClone(preset.defaults);
        const defaults = structuredClone(preset.defaults);
        const items = defaults.progressItems as GoalProgressItemDraft[];
        items[0] = { ...items[0], title: "我的里程碑", weight: 3 };
        const copy = await templates.save("goal", "我的 SMART", defaults);
        expect((await new TemplateService(new SqliteTemplateRepository(sql), clock, ids).find(copy.id))?.defaults)
          .toEqual(defaults);
        const goals = new SqliteGoalRepository(sql);
        const service = new GoalService(goals, new SqliteLifeDomainRepository(sql), clock, ids);
        const goal = await service.create({ ...draft, description: String(copy.defaults.description) }, items);
        const progress = new SqliteGoalProgressItemRepository(sql);
        const before = await progress.list();
        await templates.save("goal", "我的 SMART", { description: "改版", progressItems: [kr] }, copy.id);
        expect((await templates.find(copy.id))?.version).toBe(2);
        expect(await progress.list()).toEqual(before);
        expect((await goals.findById(goal.id))?.description).toBe(copy.defaults.description);
        expect((await templates.find("default-smart"))?.defaults).toEqual(snapshot);
        await service.update(goal.id, { ...draft, title: "仅调整目标" });
        expect(await progress.list()).toEqual(before);
      } finally { close(); }
    });
  }
});
