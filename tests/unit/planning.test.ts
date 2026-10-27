import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteActionRepository } from "../../src/repositories/sqlite/SqliteActionRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { ActionService } from "../../src/services/planning/ActionService";
import { GoalService } from "../../src/services/planning/GoalService";

const fixedClock = {
  now: () => new Date("2026-09-23T08:00:00.000Z"),
};

describe("M2 planning", () => {
  it("keeps goals and actions as global objects with explicit context links", async () => {
    const executor = new MemorySqliteExecutor();
    const lifeDomainRepository = new SqliteLifeDomainRepository(executor);
    const goalRepository = new SqliteGoalRepository(executor);
    const actionRepository = new SqliteActionRepository(executor);
    const ids = ["domain-health", "goal-sleep", "action-wind-down"];
    const idGenerator = { next: () => ids.shift() ?? "unexpected-id" };
    const lifeDomainService = new LifeDomainService(
      lifeDomainRepository,
      fixedClock,
      idGenerator,
    );
    const goalService = new GoalService(
      goalRepository,
      lifeDomainRepository,
      fixedClock,
      idGenerator,
    );
    const actionService = new ActionService(
      actionRepository,
      goalRepository,
      lifeDomainRepository,
      fixedClock,
      idGenerator,
    );

    await new MigrationRunner(executor, migrations, fixedClock).run();
    const domain = await lifeDomainService.create({
      name: "健康",
      description: "",
      focus: "",
      color: "fern",
      icon: "heart",
    });
    const goal = await goalService.create({
      title: "恢复稳定睡眠",
      description: "把作息慢慢带回可持续的节奏。",
      domainId: domain.id,
      status: "active",
      targetDate: "2026-10-31",
    });
    const action = await actionService.create({
      title: "22:30 前放下手机",
      notes: "先从一周两天开始。",
      domainId: domain.id,
      goalId: goal.id,
      scheduledFor: "2026-09-24",
    });

    expect(await goalService.list()).toEqual([
      expect.objectContaining({
        id: "goal-sleep",
        domainId: "domain-health",
        status: "active",
        targetDate: "2026-10-31",
      }),
    ]);
    expect(await actionService.list()).toEqual([
      expect.objectContaining({
        id: "action-wind-down",
        goalId: "goal-sleep",
        domainId: "domain-health",
        status: "open",
        scheduledFor: "2026-09-24",
        completedAt: null,
      }),
    ]);

    const completedAction = await actionService.toggleCompletion(action.id);

    expect(completedAction).toMatchObject({
      status: "completed",
      completedAt: "2026-09-23T08:00:00.000Z",
    });
  });

  it("rejects stale context links and invalid scheduled dates", async () => {
    const executor = new MemorySqliteExecutor();
    const lifeDomainRepository = new SqliteLifeDomainRepository(executor);
    const goalRepository = new SqliteGoalRepository(executor);
    const actionRepository = new SqliteActionRepository(executor);
    const actionService = new ActionService(
      actionRepository,
      goalRepository,
      lifeDomainRepository,
      fixedClock,
      { next: () => "action-invalid" },
    );

    await new MigrationRunner(executor, migrations, fixedClock).run();

    await expect(
      actionService.create({
        title: "安排一次散步",
        notes: "",
        domainId: "missing-domain",
        goalId: null,
        scheduledFor: "2026-09-24",
      }),
    ).rejects.toThrow("关联的生活领域已经不存在了。");
    await expect(
      actionService.create({
        title: "安排一次散步",
        notes: "",
        domainId: null,
        goalId: null,
        scheduledFor: "2026-02-30",
      }),
    ).rejects.toThrow("安排日期请使用有效的年月日。");
  });
});
