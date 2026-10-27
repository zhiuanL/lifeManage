import type { Goal, GoalStatus } from "./Goal";

export type LegacyGoalStatus = "active" | "paused" | "completed";
export type GoalStatusExtension = "candidate" | "abandoned" | "archived";

// Keep the original constrained column intact to preserve inbound foreign keys.
export function goalStorageStatus(goal: Goal): LegacyGoalStatus {
  if (goal.status === "candidate") return "active";
  if (goal.status === "abandoned") return "paused";
  if (goal.status === "archived") return goal.completedAt ? "completed" : "active";
  return goal.status;
}

export function goalStatusExtension(status: GoalStatus): GoalStatusExtension | null {
  return status === "candidate" || status === "abandoned" || status === "archived" ? status : null;
}
