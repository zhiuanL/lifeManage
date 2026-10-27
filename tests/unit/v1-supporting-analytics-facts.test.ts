import { describe, expect, it } from "vitest";
import { buildAnalytics, type AnalyticsData } from "../../src/domain/analytics/Analytics";
import type { Habit, HabitLog } from "../../src/domain/habits/Habit";
import type { Issue } from "../../src/domain/issues/Issue";
import type { Action } from "../../src/domain/planning/Action";
import type { Goal } from "../../src/domain/planning/Goal";
import { groupIncompleteReasons } from "../../src/domain/planning/ActionFeedbackFacts";
import type { Review } from "../../src/domain/reviews/Review";
import { createReviewStructure, reviewTypes } from "../../src/domain/reviews/ReviewStructure";

const stamp = "2026-09-23T09:00:00";
const now = new Date("2026-09-23T12:00:00");
const filter = { weeks: 4 as const, domainId: "health", goalId: null };
const empty: AnalyticsData = { goals: [], actions: [], reviews: [], issues: [],
  planChanges: [], completionPlans: [], stateEvents: [] };
const habit: Habit = { id: "habit", title: "散步", intention: "", weeklyTarget: 3,
  stableContext: "", triggerCondition: "", obstacle: "", adjustment: "", startOn: "2026-08-01",
  domainIds: ["health"], archived: false, createdAt: stamp, updatedAt: stamp };
const goal: Goal = { id: "goal", title: "保持健康", description: "", status: "active",
  domainId: "health", domainIds: ["health"], targetDate: null, sortOrder: 0,
  completedAt: null, createdAt: stamp, updatedAt: stamp };

function log(id: string, recordedOn: string, completed: boolean, overrides: Partial<HabitLog> = {}): HabitLog {
  return { id, habitId: habit.id, recordedOn, completed, obstacle: "", adjustment: "",
    createdAt: stamp, updatedAt: stamp, ...overrides };
}
function action(id: string, overrides: Partial<Action> = {}): Action {
  return { id, title: id, notes: "", goalId: null, domainId: "health", domainIds: ["health"],
    scheduledFor: null, status: "open", sortOrder: 0, completedAt: null,
    createdAt: stamp, updatedAt: stamp, ...overrides };
}
function review(id: string, overrides: Partial<Review> = {}): Review {
  return { id, title: id, reflection: "", insight: "", nextFocus: "", domainId: "health",
    domainIds: ["health"], reviewedOn: "2026-09-23", createdAt: stamp, updatedAt: stamp, ...overrides };
}
function issue(id: string, overrides: Partial<Issue> = {}): Issue {
  return { id, title: id, description: "", firstSeen: "2026-08-01", occurrenceCount: 8,
    causeHypothesis: "", attempts: "", followUp: "", status: "open", goalId: null,
    domainIds: ["health"], createdAt: stamp, updatedAt: stamp, ...overrides };
}

describe("V1 supporting analysis facts", () => {
  it("keeps missing weeks unknown, explicit failure zero, and current weeks incomplete", () => {
    const logs = [
      log("failed", "2026-08-31", false, { obstacle: "下雨" }),
      log("done", "2026-09-07", true),
      log("older", "2026-09-07", false, { updatedAt: "2026-09-22T09:00:00" }),
      log("current", "2026-09-21", true),
      log("future", "2026-09-24", true),
      log("invalid", "2026-02-30", true),
    ];
    const result = buildAnalytics({ ...empty, habits: [habit], habitLogs: logs }, filter, now);
    const fact = result.habits[0];
    expect(fact.records.map(item => item.id)).toEqual(["failed", "done", "current"]);
    expect(fact.weeks.map(week => week.progress.percent)).toEqual([0, 33, null, null]);
    expect(fact.weeks[0].records[0].obstacle).toBe("下雨");
    expect(fact.weeks[3].completedDays).toBe(1);
    expect(fact.progress).toEqual({ completed: 1, expected: 6, recordedWeeks: 2, percent: 17 });
  });

  it("excludes a partial first week from rates but retains its recorded source", () => {
    const result = buildAnalytics({ ...empty, habits: [{ ...habit, startOn: "2026-09-02", archived: true }],
      habitLogs: [log("before-start", "2026-08-31", true), log("partial", "2026-09-02", true)] }, filter, now);
    expect(result.habits[0].records.map(item => item.id)).toEqual(["partial"]);
    expect(result.habits[0].progress.percent).toBeNull();
    expect(result.habits[0].habit.archived).toBe(true);
  });

  it("uses explicit habit-goal links and rejects an invalid goal scope", () => {
    const linked: Goal = { ...goal, habitProgress: [{ habitId: habit.id,
      startOn: "2026-08-31", endOn: "2026-09-23", weeklyTarget: 3, weight: 1 }] };
    const source = { ...empty, goals: [linked], habits: [habit, { ...habit, id: "unlinked" }] };
    expect(buildAnalytics(source, { ...filter, goalId: goal.id }, now).habits.map(item => item.habit.id))
      .toEqual([habit.id]);
    expect(buildAnalytics({ ...source, goals: [goal] }, { ...filter, goalId: goal.id }, now).habits).toEqual([]);
    expect(buildAnalytics(source, { ...filter, goalId: "missing" }, now).habits).toEqual([]);
  });

  it("separates all five review periods, completion and legacy unclassified records", () => {
    const reviews = reviewTypes.flatMap(type => [
      review(`${type}-draft`, { structure: createReviewStructure(type, "2026-09-23"), goalIds: [goal.id] }),
      review(`${type}-completed`, { structure: { ...createReviewStructure(type, "2026-09-23"),
        status: "completed" }, goalIds: [goal.id] }),
    ]);
    const result = buildAnalytics({ ...empty, goals: [goal], reviews: [...reviews,
      review("legacy"), review("future", { reviewedOn: "2026-09-24" }),
      review("elsewhere", { domainId: "work", domainIds: ["work"] })] }, filter, now);
    for (const type of reviewTypes) {
      const group = result.reviewGroups.find(item => item.type === type)!;
      expect(group.drafts.map(item => item.id)).toEqual([`${type}-draft`]);
      expect(group.completed.map(item => item.id)).toEqual([`${type}-completed`]);
    }
    expect(result.reviewGroups.find(item => item.type === "unclassified")?.unclassified.map(item => item.id))
      .toEqual(["legacy"]);
    const scoped = buildAnalytics({ ...empty, goals: [goal], reviews: [...reviews, review("same-domain")] },
      { ...filter, goalId: goal.id }, now);
    expect(scoped.reviewGroups.find(item => item.type === "unclassified")?.unclassified).toEqual([]);
    expect(scoped.weeks[3].reviews).toHaveLength(10);
  });

  it("separates current issue states from first-seen observations without multiplying occurrences", () => {
    const result = buildAnalytics({ ...empty, goals: [goal], issues: [
      issue("old"), issue("observing", { status: "watching", firstSeen: "2026-09-01" }),
      issue("resolved", { status: "resolved", firstSeen: "2026-09-22" }),
      issue("goal-linked", { domainIds: [], goalId: goal.id }),
      issue("future", { firstSeen: "2026-09-24" }), issue("invalid", { firstSeen: "2026-02-30" }),
      issue("outside", { domainIds: ["work"] }),
    ] }, filter, now);
    expect(result.issueStates.map(item => [item.status, item.issues.map(row => row.id)]))
      .toEqual([["open", ["old", "goal-linked"]], ["watching", ["observing"]], ["resolved", ["resolved"]]]);
    expect(result.firstSeenIssues.map(item => item.id)).toEqual(["resolved", "observing"]);
    expect(result.firstSeenIssues).toHaveLength(2);
  });

  it("groups trimmed exact reasons only and counts a duplicate action once", () => {
    const a = action("a", { details: { incompleteReason: "  太累了  " } });
    const groups = groupIncompleteReasons([a, a,
      action("b", { details: { incompleteReason: "太累了" } }),
      action("c", { details: { incompleteReason: "感觉疲惫" } }),
      action("done", { status: "completed", details: { incompleteReason: "太累了" } }),
      action("blank", { details: { incompleteReason: " " } }),
    ]);
    expect(groups.map(group => [group.reason, group.actions.map(item => item.id)]))
      .toEqual([["太累了", ["a", "b"]], ["感觉疲惫", ["c"]]]);
  });

  it("preserves zero, missing and exact large minute sums with current feedback evidence", () => {
    const zero = action("zero / 1", { details: { actualMinutes: 0 } });
    expect(buildAnalytics({ ...empty, actions: [zero] }, filter, now)).toMatchObject({
      feedbackMinutes: 0, feedbackMinutesCount: 1,
    });
    const missing = action("missing", { details: { actualResult: "尝试过", actualMinutes: null } });
    const unknown = buildAnalytics({ ...empty, actions: [missing] }, filter, now);
    expect(unknown.feedbackMinutes).toBeNull();
    expect(unknown.feedbackMinutesCount).toBe(0);
    const large = buildAnalytics({ ...empty, actions: [
      zero, missing, action("large", { details: { actualMinutes: Number.MAX_SAFE_INTEGER } }),
      action("one", { details: { actualMinutes: 1 } }),
      action("outside", { updatedAt: "2026-08-01T09:00:00", details: { actualMinutes: 50 } }),
      action("future", { updatedAt: "2026-09-23T13:00:00", details: { actualMinutes: 50 } }),
    ] }, filter, now);
    expect(large.feedbackMinutes).toBe("9007199254740992");
    expect(large.feedbackMinutesCount).toBe(3);
    expect(large.feedback.find(item => item.id === zero.id)?.to).toBe("/goals#action-zero%20%2F%201");
    expect(large.feedback.map(item => item.id).sort()).toEqual(["large", "missing", "one", zero.id].sort());
  });
});
