import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteSystemRepository } from "../../src/repositories/sqlite/SqliteSystemRepository";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { ThemePreferenceService } from "../../src/services/system/ThemePreferenceService";

const fixedClock = {
  now: () => new Date("2026-09-22T08:00:00.000Z"),
};

describe("M1 life domains", () => {
  it("persists a domain context and updates it through the service boundary", async () => {
    const executor = new MemorySqliteExecutor();
    const migrationRunner = new MigrationRunner(executor, migrations, fixedClock);
    const repository = new SqliteLifeDomainRepository(executor);
    const service = new LifeDomainService(repository, fixedClock, {
      next: () => "domain-health",
    });

    await migrationRunner.run();
    const createdDomain = await service.create({
      name: "健康",
      description: "保持有精神和余裕的身体状态。",
      focus: "每周安排三次舒展活动",
      longTermExpectation: "拥有稳定的精力",
      currentState: "最近睡眠不够",
      color: "fern",
      icon: "heart",
    });
    const updatedDomain = await service.update(createdDomain.id, {
      name: "健康",
      description: "保持有精神和余裕的身体状态。",
      focus: "睡眠节奏回到稳定",
      longTermExpectation: "拥有稳定的精力",
      currentState: "正在调整",
      status: "paused",
      color: "ocean",
      icon: "sprout",
    });

    expect(await service.list()).toEqual([
      {
        id: "domain-health",
        name: "健康",
        description: "保持有精神和余裕的身体状态。",
        focus: "睡眠节奏回到稳定",
        longTermExpectation: "拥有稳定的精力",
        currentState: "正在调整",
        status: "paused",
        color: "ocean",
        icon: "sprout",
        sortOrder: 0,
        createdAt: "2026-09-22T08:00:00.000Z",
        updatedAt: "2026-09-22T08:00:00.000Z",
      },
    ]);
    expect(updatedDomain.focus).toBe("睡眠节奏回到稳定");
    const archived = await service.update(createdDomain.id, {
      ...updatedDomain, status: "archived",
    });
    expect((await service.findById(archived.id))?.status).toBe("archived");
    expect((await service.list())[0].id).toBe(createdDomain.id);
    expect((await service.update(archived.id, { ...archived, status: "active" })).status)
      .toBe("active");
  });

  it("keeps the M1 theme preference in local metadata", async () => {
    const executor = new MemorySqliteExecutor();
    const migrationRunner = new MigrationRunner(executor, migrations, fixedClock);
    const systemRepository = new SqliteSystemRepository(executor, fixedClock);
    const service = new ThemePreferenceService(systemRepository);

    await migrationRunner.run();

    expect(await service.getTheme()).toBe("mist");
    await service.setTheme("night");
    expect(await service.getTheme()).toBe("night");
  });

  it("rejects a life domain without a meaningful name", async () => {
    const executor = new MemorySqliteExecutor();
    const repository = new SqliteLifeDomainRepository(executor);
    const service = new LifeDomainService(repository, fixedClock, {
      next: () => "domain-invalid",
    });

    await expect(
      service.create({
        name: "   ",
        description: "",
        focus: "",
        color: "ocean",
        icon: "heart",
      }),
    ).rejects.toThrow("请为这个生活领域填写名称。");
  });

  it("rejects invalid status and oversized context", async () => {
    const executor = new MemorySqliteExecutor();
    const service = new LifeDomainService(new SqliteLifeDomainRepository(executor), fixedClock,
      { next: () => "invalid" });
    const draft = { name: "健康", description: "", focus: "",
      color: "fern" as const, icon: "heart" as const };
    await expect(service.create({ ...draft, status: "deleted" as "active" }))
      .rejects.toThrow("领域状态");
    await expect(service.create({ ...draft, longTermExpectation: "长".repeat(501) }))
      .rejects.toThrow("长期期待");
  });
});
