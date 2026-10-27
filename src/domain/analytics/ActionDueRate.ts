import type { ActionStateEvent } from "../planning/ActionStateEvent";

export interface ActionDueOutcome {
  dueDate: string;
  onTime: boolean;
}

function localDate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function evaluateActionDueOutcomes(
  events: readonly ActionStateEvent[],
  lastDueDate: string,
): ActionDueOutcome[] {
  const ordered = events.map((event) => ({ ...event, day: localDate(event.changedAt) }))
    .filter((event): event is ActionStateEvent & { day: string } => event.day !== null)
    .sort((left, right) =>
      left.changedAt.localeCompare(right.changedAt) || left.id - right.id);
  // A later change to an old action cannot establish what its status was at creation.
  if (ordered[0]?.beforeStatus !== null) return [];
  const dates = [...new Set(ordered.flatMap((event) =>
    event.scheduledFor && event.scheduledFor <= lastDueDate ? [event.scheduledFor] : []))].sort();
  const outcomes: ActionDueOutcome[] = [];
  let cursor = 0;
  let status: ActionStateEvent["afterStatus"] | null = null;
  let activePlan: string | null = null;

  for (const dueDate of dates) {
    while (cursor < ordered.length && ordered[cursor].day <= dueDate) {
      const event = ordered[cursor++];
      if (event.afterStatus === "open" || event.beforeStatus === "open") {
        activePlan = event.scheduledFor;
      }
      // Edits while completed do not create a second due obligation.
      status = event.afterStatus;
    }
    if (activePlan === dueDate && status) {
      outcomes.push({ dueDate, onTime: status === "completed" });
    }
  }
  return outcomes;
}
