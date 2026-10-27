import { expect, it } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { buildReviewFactDraft, type ReviewFactData } from "../../src/domain/reviews/ReviewFactDraft";
import { reviewPeriod } from "../../src/domain/reviews/ReviewStructure";
import type { Goal } from "../../src/domain/planning/Goal";
import type { LifeEvent, Skill } from "../../src/domain/records/LifeRecords";

it("loads quarterly resources and annual strategic records through production services", async () => {
  const deps = createApplicationDependencies();
  await deps.bootstrapApplicationService.bootstrap();
  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  const direction = await deps.lifeNavigationService.create("vision", { title: "健康方向", description: "保持稳定作息" });
  const goal = await deps.goalService.create({ title: "作息阶段目标", description: "", domainId: null,
    domainIds: [], status: "active", horizon: "stage", directionId: direction.id, targetDate: today });
  await deps.resourceService.save({ goalId: goal.id, kind: "time", description: "每晚留出半小时",
    met: false, skillId: null, personId: null });
  await deps.resourceService.save({ goalId: goal.id, kind: "tool", description: "已具备工具",
    met: true, skillId: null, personId: null });
  await deps.lifeRecordsService.saveEvent({ title: "开始规律作息", happenedOn: today, description: "实际记录",
    goalId: goal.id, personId: null, domainIds: [] });
  await deps.lifeRecordsService.saveSkill({ name: "作息管理", currentLevel: 0, targetLevel: 3,
    learningPath: "保持记录", practice: "安排睡前流程", reflection: "继续观察", goalId: goal.id, domainIds: [] });
  await deps.decisionService.create({ title: "调整晚间安排", decidedOn: today, importance: "major", status: "considering",
    background: "", options: "", constraints: "", criteria: "", risks: "", opportunityCost: "",
    reversibility: "unknown", choice: "", rationale: "", executionConditions: "", outcome: "", reflection: "",
    goalId: goal.id, domainIds: [], navigationIds: [direction.id] });
  const quarter = await deps.reviewFactService.generate(reviewPeriod("quarterly", today), []);
  expect(quarter.answers.resourceGaps).toContain("每晚留出半小时");
  expect(quarter.answers.resourceGaps).not.toContain("已具备工具");
  expect(quarter.answers.goalRollover).toContain("是否滚动待确认");
  expect(quarter.answers.directionAdjustment).toContain("健康方向");
  const annual = await deps.reviewFactService.generate(reviewPeriod("annual", today), []);
  expect(annual.answers.importantEvents).toContain("开始规律作息");
  expect(annual.answers.majorDecisions).toContain("考虑中，尚未确定选择");
  expect(annual.answers.capabilityGrowth).toContain("当前水平 0");
  expect(annual.answers.capabilityGrowth).toContain("非年度增长量");
  expect(annual.answers.longTermDirection).toContain("健康方向");
  expect((await deps.goalService.findById(goal.id))?.targetDate).toBe(today);
});

it("filters strategic facts by actual dates and goal-inherited domain context", () => {
  const base: ReviewFactData = { observedOn: "2026-10-13", goals: [], reviews: [], actions: [], items: [],
    issues: [], metrics: [], records: [], habits: [], logs: [], changes: [] };
  const event = (id: string, happenedOn: string, domainIds: string[]): LifeEvent => ({ id, title: id,
    happenedOn, domainIds, description: "", goalId: null, personId: null, archived: true,
    createdAt: "2026-10-13", updatedAt: "2026-10-13" });
  base.goals = [{ id: "g", title: "领域目标", description: "", domainId: "health", domainIds: ["health"],
    parentId: null, status: "active", targetDate: null, completedAt: null, sortOrder: 0,
    createdAt: "2026-01-01", updatedAt: "2026-01-01" } satisfies Goal];
  base.events = [{ ...event("继承领域", "2026-10-13", []), goalId: "g" }, event("真实事件", "2026-01-01", ["health"]), event("未来事件", "2026-12-01", ["health"]),
    event("其他领域", "2026-10-13", ["work"]), event("往年事件", "2025-12-31", ["health"])];
  base.skills = [{ id: "future", name: "未来能力", createdAt: "2027-01-01", updatedAt: "2027-01-01",
    domainIds: ["health"], goalId: null } as Skill];
  const facts = buildReviewFactDraft(reviewPeriod("annual", "2026-10-13"), base, ["health"]);
  expect(facts.answers.importantEvents).toContain("真实事件");
  expect(facts.answers.importantEvents).toContain("继承领域");
  expect(facts.answers.importantEvents).toContain("已归档");
  expect(JSON.stringify(facts)).not.toMatch(/未来事件|其他领域|往年事件|未来能力/);
  expect(buildReviewFactDraft(reviewPeriod("weekly", "2026-10-13"), base).answers.importantEvents).toBeUndefined();
});

