import { normalizeProgressWeight } from "../progress/ProgressWeight";
import { normalizeActionDetails, type ActionDetails } from "./ActionDetails";
import { isPlainDate, type Goal } from "./Goal";
import { ActionValidationError } from "./ActionValidationError";

export { ActionValidationError } from "./ActionValidationError";

export const actionStatuses = ["open", "completed"] as const;

export type ActionStatus = (typeof actionStatuses)[number];

export interface ActionDraft {
  details?: Partial<ActionDetails>;
  title: string;
  notes: string;
  domainId: string | null;
  domainIds?: readonly string[];
  goalId: string | null;
  progressWeight?: number;
  scheduledFor: string | null;
}

export interface Action extends ActionDraft {
  domainIds: readonly string[];
  id: string;
  status: ActionStatus;
  sortOrder: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function isActionInDomain(
  action: Action,
  domainId: string,
  goalsById: ReadonlyMap<string, Goal>,
): boolean {
  return action.domainIds.includes(domainId) ||
    (action.goalId !== null && (goalsById.get(action.goalId)?.domainIds.includes(domainId) ?? false));
}

export function normalizeActionDraft(draft: ActionDraft): ActionDraft & { domainIds: string[] } {
  const title = draft.title.trim();
  const notes = draft.notes.trim();
  const domainIds = [...new Set((draft.domainIds ?? (draft.domainId ? [draft.domainId] : []))
    .map((id) => id.trim()).filter(Boolean))];
  const domainId = domainIds[0] ?? null;
  const goalId = normalizeOptionalValue(draft.goalId);
  const scheduledFor = normalizeOptionalValue(draft.scheduledFor);

  if (!title) {
    throw new ActionValidationError("请为这个行动填写名称。");
  }

  if (title.length > 120) {
    throw new ActionValidationError("行动名称请控制在 120 个字符以内。");
  }

  if (notes.length > 800) {
    throw new ActionValidationError("行动备注请控制在 800 个字符以内。");
  }

  if (scheduledFor && !isPlainDate(scheduledFor)) {
    throw new ActionValidationError("安排日期请使用有效的年月日。");
  }

  let progressWeight: number;
  try { progressWeight = normalizeProgressWeight(draft.progressWeight); }
  catch { throw new ActionValidationError("贡献权重须大于 0 且不超过 100。"); }

  return {
    title,
    details: normalizeActionDetails(draft.details),
    notes,
    domainId,
    domainIds,
    goalId,
    progressWeight,
    scheduledFor,
  };
}

function normalizeOptionalValue(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}
