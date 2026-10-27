import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteReviewRepository } from "../../src/repositories/sqlite/SqliteReviewRepository";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { ReviewService } from "../../src/services/reviews/ReviewService";

const fixedClock = {
  now: () => new Date("2026-09-23T08:00:00.000Z"),
};

describe("M3 reviews", () => {
  it("keeps reviews as global records and allows gaps between them", async () => {
    const executor = new MemorySqliteExecutor();
    const lifeDomainRepository = new SqliteLifeDomainRepository(executor);
    const reviewRepository = new SqliteReviewRepository(executor);
    const ids = ["domain-health", "review-september", "review-january"];
    const idGenerator = { next: () => ids.shift() ?? "unexpected-id" };
    const lifeDomainService = new LifeDomainService(
      lifeDomainRepository,
      fixedClock,
      idGenerator,
    );
    const reviewService = new ReviewService(
      reviewRepository,
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
    await reviewService.create({
      title: "九月的睡眠",
      reflection: "晚上的节奏开始慢下来。",
      insight: "提前放下手机更容易入睡。",
      nextFocus: "继续保留睡前十分钟的安静。",
      domainId: domain.id,
      reviewedOn: "2026-09-20",
    });
    await reviewService.create({
      title: "年初的一次停顿",
      reflection: "",
      insight: "",
      nextFocus: "",
      domainId: null,
      reviewedOn: "2026-01-11",
    });

    expect(await reviewService.list()).toEqual([
      expect.objectContaining({
        id: "review-september",
        domainId: "domain-health",
        reviewedOn: "2026-09-20",
      }),
      expect.objectContaining({
        id: "review-january",
        domainId: null,
        reviewedOn: "2026-01-11",
        reflection: "",
        insight: "",
        nextFocus: "",
      }),
    ]);
  });

  it("rejects stale domain links and invalid review dates", async () => {
    const executor = new MemorySqliteExecutor();
    const lifeDomainRepository = new SqliteLifeDomainRepository(executor);
    const reviewRepository = new SqliteReviewRepository(executor);
    const reviewService = new ReviewService(
      reviewRepository,
      lifeDomainRepository,
      fixedClock,
      { next: () => "review-invalid" },
    );

    await new MigrationRunner(executor, migrations, fixedClock).run();

    await expect(
      reviewService.create({
        title: "一次回顾",
        reflection: "",
        insight: "",
        nextFocus: "",
        domainId: "missing-domain",
        reviewedOn: "2026-09-23",
      }),
    ).rejects.toThrow("关联的生活领域已经不存在了。");
    await expect(
      reviewService.create({
        title: "一次回顾",
        reflection: "",
        insight: "",
        nextFocus: "",
        domainId: null,
        reviewedOn: "2026-02-30",
      }),
    ).rejects.toThrow("回顾日期请使用有效的年月日。");
  });
});
