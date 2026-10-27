import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { createStorageStatus } from "../../src/domain/system/storage-status";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteSystemRepository } from "../../src/repositories/sqlite/SqliteSystemRepository";
import { BootstrapApplicationService } from "../../src/services/system/BootstrapApplicationService";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";

const fixedClock = {
  now: () => new Date("2026-09-22T08:00:00.000Z"),
};

describe("storage migration foundation", () => {
  it("runs ordered migrations once and persists bootstrap metadata", async () => {
    const executor = new MemorySqliteExecutor();
    const migrationRunner = new MigrationRunner(executor, migrations, fixedClock);
    const repository = new SqliteSystemRepository(executor, fixedClock);
    let index = 0;
    const service = new BootstrapApplicationService(
      migrationRunner, repository, fixedClock, { next: () => `recommended-${++index}` },
    );

    const firstBootstrap = await service.bootstrap();
    const secondBootstrap = await service.bootstrap();

    expect(firstBootstrap).toMatchObject({
      isFirstInitialization: true,
      migrationVersion: migrations.at(-1)?.id,
    });
    expect(secondBootstrap).toEqual({
      initializedAt: "2026-09-22T08:00:00.000Z",
      isFirstInitialization: false,
      migrationVersion: migrations.at(-1)?.id,
    });
    expect(await repository.getMetadata("m0_initialized_at")).toBe(
      "2026-09-22T08:00:00.000Z",
    );
    expect(await repository.getMetadata("m0_recommended_domains_pending")).toBeNull();
    expect((await new SqliteLifeDomainRepository(executor).list()).map((domain) => ({
      name: domain.name, focus: domain.focus, currentState: domain.currentState,
      longTermExpectation: domain.longTermExpectation,
    }))).toEqual(["事业", "成长", "健康", "关系", "财务"].map((name) => ({
      name, focus: "", currentState: "", longTermExpectation: "",
    })));
  });

  it("rolls back preview seeds and resumes pending setup after a failed write", async () => {
    const executor = new MemorySqliteExecutor();
    const repository = new SqliteSystemRepository(executor, fixedClock);
    const domains = new SqliteLifeDomainRepository(executor);
    let index = 0;
    let failOnce = true;
    const service = new BootstrapApplicationService(
      new MigrationRunner(executor, migrations, fixedClock),
      repository, fixedClock, {
        next: () => {
          index++;
          if (failOnce && index === 2) return "recommended-1";
          return `recommended-${index}`;
        },
      },
    );

    await expect(service.bootstrap()).rejects.toThrow("Duplicate domain");
    expect(await domains.list()).toHaveLength(0);
    expect(await repository.getMetadata("m0_initialized_at")).toBeNull();
    expect(await repository.getMetadata("m0_recommended_domains_pending")).not.toBeNull();
    failOnce = false;
    expect((await service.bootstrap()).isFirstInitialization).toBe(true);
    expect(await domains.list()).toHaveLength(5);
    expect(await repository.getMetadata("m0_recommended_domains_pending")).toBeNull();
  });

  it("describes browser preview storage as explicitly ephemeral in Chinese", () => {
    expect(createStorageStatus("browser-preview", "0010-m5-action-completions")).toEqual({
      environment: "browser-preview",
      label: "浏览器预览存储已就绪",
      detail: "临时本地存储已初始化至 0010-m5-action-completions。",
    });
  });
});
