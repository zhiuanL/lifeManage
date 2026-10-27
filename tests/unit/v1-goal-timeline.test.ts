import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import type { Goal } from "../../src/domain/planning/Goal";
import type { GoalProgressItem } from "../../src/domain/progress/GoalProgressItem";
import { buildGoalTimeline, type GoalVersionFact } from "../../src/domain/records/GoalTimeline";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteGoalHistoryRepository } from "../../src/repositories/sqlite/SqliteGoalHistoryRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteGoalProgressItemRepository } from "../../src/repositories/sqlite/SqliteGoalProgressItemRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { GoalTimelineService } from "../../src/services/history/GoalTimelineService";
import { GoalService } from "../../src/services/planning/GoalService";
import { GoalProgressItemService } from "../../src/services/planning/GoalProgressItemService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const firstDate = "2026-10-20T08:00:00.000Z";
const secondDate = "2026-10-21T08:00:00.000Z";
const lastDate = "2026-10-22T08:00:00.000Z";
const goal: Goal = { id: "g", title: "新目标", description: "", domainId: "new",
  domainIds: ["new", "shared"], parentId: null, status: "paused", statusReason: "调整节奏",
  targetDate: null, sortOrder: 0, completedAt: null, createdAt: firstDate, updatedAt: lastDate };
const item: GoalProgressItem = { id: "i", goalId: "g", kind: "milestone", title: "阶段结果",
  targetValue: 10, currentValue: 10, weight: 1, sortOrder: 0,
  createdAt: firstDate, updatedAt: lastDate };
function progress(current = 4, target = 10) {
  return [{ id: "i", kind: "milestone", title: "阶段结果", target_value: target, current_value: current }];
}
function version(id: number, snapshot: Record<string, unknown> = {}): GoalVersionFact {
  return { id, objectId: goal.id, changedAt: id === 1 ? secondDate : lastDate,
    snapshot: { title: "旧目标", status: "active", description: "", target_date: null,
      domain_id: "old", domain_ids: ["old", "shared"], progress_items: progress(), ...snapshot } };
}

describe("V1 recorded goal timeline facts", () => {
  it("pairs before snapshots with the next state, preserving dates, title and explicit old/new domains", () => {
    const older = version(1);
    const newer = version(2, { title: "中间目标" });
    const source = [newer, older];
    const copy = JSON.stringify(source);
    const entries = buildGoalTimeline([goal], [item], source);
    expect(entries.find(entry => entry.id === "goal-change-1")).toMatchObject({
      title: "中间目标", changedAt: secondDate, label: "目标调整", detail: "调整名称",
      domainIds: ["old", "shared"],
    });
    expect(entries.find(entry => entry.id === "goal-change-2")).toMatchObject({
      title: "新目标", changedAt: lastDate, domainIds: ["old", "shared", "new"],
    });
    expect(entries.find(entry => entry.id === "goal-change-2")?.detail).toContain("进行中变为暂停");
    expect(entries.filter(entry => entry.label === "阶段成果")).toHaveLength(1);
    expect(entries.find(entry => entry.label === "阶段成果")?.changedAt).toBe(lastDate);
    expect(JSON.stringify(source)).toBe(copy);
    expect(goal.domainIds).toEqual(["new", "shared"]);
  });

  it("ignores identical saves, array order and fields absent from legacy snapshots", () => {
    const old = version(1, { title: goal.title, status: goal.status,
      domain_id: "new", domain_ids: ["shared", "new"], progress_items: progress(10) });
    expect(buildGoalTimeline([goal], [item], [old])).toEqual([]);
    const legacy = { ...old, snapshot: { title: goal.title, status: goal.status, domain_id: "new" } };
    expect(buildGoalTimeline([{ ...goal, domainIds: ["new"] }], [item], [legacy])).toEqual([]);
    expect(buildGoalTimeline([goal], [item], [])).toEqual([]);
  });

  it("does not infer achievements from new items, lower thresholds, changed kinds or missing old progress", () => {
    const unchanged = { title: goal.title, status: goal.status,
      domain_id: "new", domain_ids: [...goal.domainIds] };
    for (const before of [[], progress(4, 20),
      [{ ...progress()[0], kind: "key_result" }], undefined]) {
      const entries = buildGoalTimeline([goal], [item], [version(1, {
        ...unchanged, progress_items: before,
      })]);
      expect(entries.filter(entry => entry.label === "阶段成果")).toEqual([]);
    }
  });

  it("shows explicit progress changes without calling an unfinished result an achievement", () => {
    const entries = buildGoalTimeline([goal], [{ ...item, currentValue: 6 }], [version(1, {
      title: goal.title, status: goal.status, domain_id: "new", domain_ids: [...goal.domainIds],
    })]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ label: "目标调整", detail: "调整进度项", changedAt: secondDate });
  });

  it("records a historical result once even when later undone, and records a later re-achievement", () => {
    const versions = [version(1), version(2, { progress_items: progress(10) }),
      { ...version(3, { progress_items: progress(2) }), changedAt: lastDate }];
    const entries = buildGoalTimeline([goal], [item], versions);
    expect(entries.filter(entry => entry.label === "阶段成果").map(entry => entry.id))
      .toEqual(["goal-result-3-i", "goal-result-1-i"]);
    expect(buildGoalTimeline([], [item], versions)).toEqual([]);
  });

  it("rejects broken snapshots and dates without producing partial facts", () => {
    for (const broken of [
      { ...version(1), changedAt: "2026-02-30T08:00:00Z" },
      { ...version(1), changedAt: "2026-10-20T24:00:00Z" },
      version(1, { domain_ids: "old" }),
      version(1, { status: "unknown" }),
      version(1, { progress_items: [...progress(), ...progress()] }),
      { ...version(1), snapshot: [] as unknown as Record<string, unknown> },
    ]) expect(() => buildGoalTimeline([goal], [item], [broken])).toThrow();
    expect(() => buildGoalTimeline([goal], [item], [version(1), version(1)])).toThrow();
    expect(() => buildGoalTimeline([{ ...goal, updatedAt: firstDate }], [item], [version(1)]))
      .toThrow("读取不一致");
  });

  it("fails closed when a repository fails or historical writes cross the reads", async () => {
    const goals = { list: vi.fn(async () => [goal]) };
    const progressRepository = { list: vi.fn(async () => [item]) };
    const history = { listGoalVersions: vi.fn().mockResolvedValueOnce([version(1)])
      .mockResolvedValueOnce([version(1), version(2)]) };
    const service = new GoalTimelineService(history,
      goals as unknown as SqliteGoalRepository, progressRepository as unknown as SqliteGoalProgressItemRepository);
    await expect(service.list()).rejects.toThrow("读取期间发生变化");
    history.listGoalVersions.mockRejectedValue(new Error("private SQL failure"));
    await expect(service.list()).rejects.toThrow("private SQL failure");
  });
});

for (const mode of ["SQLite", "memory"] as const) {
  describe(`V1 goal history sources in ${mode}`, () => {
    it("rereads persisted mutations, preserves prior scope and result facts without writing during reads", async () => {
      const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
      const executor = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
      let date = firstDate;
      const clock = { now: () => new Date(date) };
      let sequence = 0;
      const ids = { next: () => `timeline-${++sequence}` };
      try {
        if (db) db.exec("PRAGMA foreign_keys=ON");
        await new MigrationRunner(executor, migrations, clock).run();
        const repository = new SqliteGoalRepository(executor);
        const progressRepository = new SqliteGoalProgressItemRepository(executor);
        const history = new SqliteGoalHistoryRepository(executor);
        const goals = new GoalService(repository, new SqliteLifeDomainRepository(executor), clock, ids);
        const progressService = new GoalProgressItemService(progressRepository, repository, clock, ids);
        const draft = { title: "阶段目标", description: "", domainId: null,
          status: "active" as const, targetDate: null };
        const savedGoal = await goals.create(draft);
        const initial = await progressService.replace(savedGoal.id, [{ ...item, id: undefined, currentValue: 4 }]);
        date = secondDate;
        await progressService.replace(savedGoal.id, [{ ...initial[0], currentValue: 10 }]);
        date = lastDate;
        await goals.update(savedGoal.id, { ...draft, title: "调整后的目标" });
        const before = await history.listGoalVersions();
        const service = new GoalTimelineService(new SqliteGoalHistoryRepository(executor),
          new SqliteGoalRepository(executor), new SqliteGoalProgressItemRepository(executor));
        const result = await service.list();
        expect(result.filter(entry => entry.label === "阶段成果")).toHaveLength(1);
        expect(result.find(entry => entry.label === "阶段成果")).toMatchObject({
          title: "阶段目标", changedAt: secondDate,
        });
        expect(result.find(entry => entry.label === "目标调整")).toMatchObject({
          title: "调整后的目标", changedAt: lastDate, detail: "调整名称",
        });
        expect(await history.listGoalVersions()).toEqual(before);
        const updated = await repository.findById(savedGoal.id);
        expect(updated?.title).toBe("调整后的目标");
        if (db) expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally { db?.close(); }
    });
  });
}
