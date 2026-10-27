import { normalizeGoalHorizon, type GoalHorizon } from "./GoalHorizon";
import type { GoalRelation } from "./GoalRelation";
import { normalizeGoalPriority, type GoalPriority } from "./GoalPriority";
import { normalizeProgressWeight } from "../progress/ProgressWeight";
import { normalizeGoalProgressMode, type GoalProgressMode } from "../progress/GoalProgressMode";
import { normalizeHabitGoalSettings, type HabitGoalProgressSetting } from "../progress/HabitGoalProgress";

export const goalStatuses = ["candidate", "active", "paused", "completed", "abandoned", "archived"] as const;

export type GoalStatus = (typeof goalStatuses)[number];

export const goalStatusLabels: Record<GoalStatus, string> = {
  candidate: "候选", active: "进行中", paused: "暂停",
  completed: "已完成", abandoned: "放弃", archived: "归档",
};

export interface GoalDraft {
  horizon?: GoalHorizon | null;
  directionId?: string | null;
  title: string;
  description: string;
  domainId: string | null;
  parentId?: string | null;
  // domainId remains the primary legacy link for existing callers and backups.
  domainIds?: readonly string[];
  status: GoalStatus;
  statusReason?: string | null;
  progressMode?: GoalProgressMode;
  progressWeight?: number;
  priority?: GoalPriority;
  relations?: readonly GoalRelation[];
  habitProgress?: readonly HabitGoalProgressSetting[] | null;
  targetDate: string | null;
}

export interface Goal extends GoalDraft {
  parentId: string | null;
  domainIds: readonly string[];
  id: string;
  sortOrder: number;
  completedAt: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export class GoalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoalValidationError";
  }
}

export function normalizeGoalDraft(draft: GoalDraft): GoalDraft & { domainIds: string[]; parentId: string | null } {
  const title = draft.title.trim();
  const description = draft.description.trim();
  const domainIds = [...new Set((draft.domainIds ?? (draft.domainId ? [draft.domainId] : []))
    .map((id) => id.trim()).filter(Boolean))];
  const domainId = domainIds[0] ?? null;
  const targetDate = normalizeOptionalValue(draft.targetDate);
  const statusReason = normalizeOptionalValue(draft.statusReason ?? null);

  if (statusReason && statusReason.length > 600) {
    throw new GoalValidationError("状态原因请控制在 600 个字符以内。");
  }

  if (!title) {
    throw new GoalValidationError("请为这个目标填写名称。");
  }

  if (title.length > 80) {
    throw new GoalValidationError("目标名称请控制在 80 个字符以内。");
  }

  if (description.length > 600) {
    throw new GoalValidationError("目标说明请控制在 600 个字符以内。");
  }

  if (!goalStatuses.includes(draft.status)) {
    throw new GoalValidationError("请选择可用的目标状态。");
  }

  if (targetDate && !isPlainDate(targetDate)) {
    throw new GoalValidationError("目标日期请使用有效的年月日。");
  }

  // Only pure input normalization is translated; repository failures stay distinct.
  let settings: Pick<GoalDraft, "horizon" | "progressWeight" | "priority" | "progressMode" | "habitProgress">;
  try {
    settings = {
      horizon: normalizeGoalHorizon(draft.horizon),
      progressWeight: normalizeProgressWeight(draft.progressWeight),
      priority: normalizeGoalPriority(draft.priority),
      progressMode: normalizeGoalProgressMode(draft.progressMode),
      habitProgress: draft.habitProgress == null ? null : normalizeHabitGoalSettings(draft.habitProgress),
    };
  } catch (reason) {
    throw new GoalValidationError(reason instanceof Error ? reason.message : "目标设置无效，请检查后重试。");
  }
  return {
    ...settings,
    title,
    description,
    domainId,
    directionId: normalizeOptionalValue(draft.directionId ?? null),
    parentId: normalizeOptionalValue(draft.parentId ?? null),
    domainIds,
    status: draft.status,
    relations: draft.relations ?? [],
    statusReason: ["paused", "abandoned", "archived"].includes(draft.status) ? statusReason : null,
    targetDate,
  };
}

function normalizeOptionalValue(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

export function isPlainDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
