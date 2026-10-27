import type { Action } from "./Action";

export interface ActionReasonGroup {
  reason: string;
  actions: readonly Action[];
}

// Exact recorded text only; a current action contributes at most once.
export function groupIncompleteReasons(actions: readonly Action[]): ActionReasonGroup[] {
  const groups = new Map<string, Action[]>();
  for (const action of actions) {
    if (action.status !== "open") continue;
    const reason = action.details?.incompleteReason?.trim();
    if (!reason) continue;
    const group = groups.get(reason) ?? [];
    if (!group.some(item => item.id === action.id)) group.push(action);
    groups.set(reason, group);
  }
  return [...groups].map(([reason, items]) => ({ reason, actions: items }))
    .sort((a, b) => b.actions.length - a.actions.length || a.reason.localeCompare(b.reason, "zh-CN"));
}
