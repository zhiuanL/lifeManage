import { ActionValidationError } from "./ActionValidationError";

export const planReasons = ["personal", "external", "conflict", "other"] as const;
export type PlanReason = (typeof planReasons)[number];

export const planReasonLabels: Record<PlanReason | "initial", string> = {
  initial: "首次安排",
  personal: "主动调整",
  external: "外部变化",
  conflict: "时间冲突",
  other: "其他原因",
};

export interface PlanAdjustment {
  reason: PlanReason;
  note: string;
}

export interface ActionPlanChange {
  id: number;
  actionId: string;
  beforeDate: string | null;
  afterDate: string | null;
  reason: PlanReason | "initial";
  note: string;
  changedAt: string;
  completedAtAtChange: string | null;
  domainId: string | null;
  goalId: string | null;
}

export interface ActionCompletionPlan {
  actionId: string;
  completedAt: string;
  plannedDate: string | null;
}

export function normalizePlanAdjustment(adjustment: PlanAdjustment | undefined): PlanAdjustment {
  if (!adjustment || !planReasons.includes(adjustment.reason)) {
    throw new ActionValidationError("调整安排日期时请选择原因。");
  }
  const note = adjustment.note.trim();
  if (note.length > 500) throw new ActionValidationError("调整说明请控制在 500 个字符以内。");
  return { reason: adjustment.reason, note };
}
