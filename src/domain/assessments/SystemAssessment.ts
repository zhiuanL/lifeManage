import { isPlainDate } from "../planning/Goal";

export type AssessmentKind = "month" | "quarter";
export class AssessmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssessmentValidationError";
  }
}
export interface AssessmentDraft {
  periodKind: AssessmentKind;
  periodStart: string;
  clarity: string;
  alignment: string;
  reviews: string;
  decisions: string;
  earlyIssues: string;
  adjustment: string;
}
export interface SystemAssessment extends AssessmentDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
}
export const assessmentFields = [
  ["clarity", "更清楚当前状态"],
  ["alignment", "目标与行动更一致"],
  ["reviews", "复盘更规律"],
  ["decisions", "重大决策更有依据"],
  ["earlyIssues", "问题更早被发现"],
] as const;

export function normalizeAssessment(draft: AssessmentDraft): AssessmentDraft {
  if (!isPlainDate(draft.periodStart) ||
      (draft.periodKind !== "month" && draft.periodKind !== "quarter") ||
      draft.periodStart.slice(8) !== "01" ||
      (draft.periodKind === "quarter" &&
        !["01", "04", "07", "10"].includes(draft.periodStart.slice(5, 7)))) {
    throw new AssessmentValidationError("请选择有效的月度或季度起始日期。");
  }
  const fields = {
    clarity: draft.clarity.trim(), alignment: draft.alignment.trim(),
    reviews: draft.reviews.trim(), decisions: draft.decisions.trim(),
    earlyIssues: draft.earlyIssues.trim(), adjustment: draft.adjustment.trim(),
  };
  if (Object.values(fields).some((value) => value.length > 600)) {
    throw new AssessmentValidationError("每项评估请控制在 600 字以内。");
  }
  return { ...draft, ...fields };
}
