import { describe, expect, it } from "vitest";
import { calculateGoalProgress } from "../../src/domain/progress/GoalProgress";
import type { Goal } from "../../src/domain/planning/Goal";
import type { Action } from "../../src/domain/planning/Action";

const goal = (id: string, parentId: string | null = null,
  status: Goal["status"] = "active"): Goal => ({
  id, parentId, status, title: id, description: "", domainId: null, domainIds: [],
  sortOrder: 0, targetDate: null, completedAt: null, createdAt: "", updatedAt: "",
});
const action = (id: string, goalId: string | null,
  status: Action["status"] = "open"): Action => ({
  id, goalId, status, title: id, notes: "", domainId: null, domainIds: [],
  scheduledFor: null, sortOrder: 0, completedAt: null, createdAt: "", updatedAt: "",
});

describe("V1 goal progress from recorded facts", () => {
  it("rolls up direct children and actions without counting a descendant twice", () => {
    const goals = [
      goal("year"), goal("quarter", "year"), goal("month", "quarter"),
      goal("done", "year", "completed"),
    ];
    const actions = [
      action("month-done", "month", "completed"), action("month-open", "month"),
      action("quarter-done", "quarter", "completed"), action("year-open", "year"),
      action("unlinked", null, "completed"),
    ];
    const progress = calculateGoalProgress(goals, actions);
    expect(progress.get("month")).toEqual({ percent: 50, childGoalCount: 0, actionCount: 2 });
    expect(progress.get("quarter")).toEqual({ percent: 75, childGoalCount: 1, actionCount: 1 });
    expect(progress.get("year")).toEqual({ percent: 58, childGoalCount: 2, actionCount: 1 });
    expect(progress.get("done")?.percent).toBe(100);
  });

  it("keeps unknown progress unknown instead of inventing a zero", () => {
    const progress = calculateGoalProgress([
      goal("parent"), goal("unmeasured", "parent"), goal("complete", "parent", "completed"),
    ], []);
    expect(progress.get("parent")?.percent).toBeNull();
    expect(progress.get("unmeasured")?.percent).toBeNull();
    expect(progress.get("complete")?.percent).toBe(100);
    expect(calculateGoalProgress([goal("paused", null, "paused")], [])
      .get("paused")?.percent).toBeNull();
  });

  it("reflects action completion and reopening using the latest records", () => {
    const goals = [goal("target")];
    expect(calculateGoalProgress(goals, [action("a", "target")]).get("target")?.percent).toBe(0);
    expect(calculateGoalProgress(goals, [action("a", "target", "completed")])
      .get("target")?.percent).toBe(100);
    expect(calculateGoalProgress(goals, [action("a", "target")]).get("target")?.percent).toBe(0);
  });
});
