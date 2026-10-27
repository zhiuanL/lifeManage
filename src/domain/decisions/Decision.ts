import { isPlainDate } from "../planning/Goal";

export type DecisionImportance = "ordinary" | "major";
export type DecisionStatus = "considering" | "decided";
export type DecisionReversibility = "unknown" | "reversible" | "difficult";

export interface DecisionDraft {
  title: string;
  decidedOn: string;
  importance: DecisionImportance;
  status: DecisionStatus;
  background: string;
  options: string;
  constraints: string;
  criteria: string;
  risks: string;
  opportunityCost: string;
  reversibility: DecisionReversibility;
  choice: string;
  rationale: string;
  executionConditions: string;
  outcome: string;
  reflection: string;
  goalId: string | null;
  domainIds: readonly string[];
  navigationIds?: readonly string[];
  personIds?: readonly string[];
  resourceNeedIds?: readonly string[];
}

export interface Decision extends DecisionDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export class DecisionValidationError extends Error {}

export function normalizeDecisionDraft(draft: DecisionDraft): DecisionDraft {
  const title = draft.title.trim();
  const decidedOn = draft.decidedOn.trim();
  const goalId = draft.goalId?.trim() || null;
  const domainIds = [...new Set(draft.domainIds.map((id) => id.trim()))];
  const navigationIds = [...new Set((draft.navigationIds ?? []).map((id) => id.trim()))];
  const personIds = [...new Set((draft.personIds ?? []).map((id) => id.trim()))];
  const resourceNeedIds = [...new Set((draft.resourceNeedIds ?? []).map((id) => id.trim()))];
  if (resourceNeedIds.some((id) => !id)) throw new DecisionValidationError("关联的资源需求无效。");
  if (personIds.some((id) => !id)) throw new DecisionValidationError("关联的人物无效。");
  if (navigationIds.some((id) => !id)) throw new DecisionValidationError("关联的人生导航无效。");
  if (!title || title.length > 80) throw new DecisionValidationError("决策议题不能为空，且不能超过 80 个字符。");
  if (!isPlainDate(decidedOn)) throw new DecisionValidationError("记录日期请使用有效的年月日。");
  if (draft.importance !== "ordinary" && draft.importance !== "major") {
    throw new DecisionValidationError("请选择普通或重大决策。");
  }
  if (draft.status !== "considering" && draft.status !== "decided") {
    throw new DecisionValidationError("请选择可用的决策状态。");
  }
  if (!["unknown", "reversible", "difficult"].includes(draft.reversibility)) {
    throw new DecisionValidationError("请选择可用的可逆性。");
  }
  if (domainIds.some((id) => !id)) throw new DecisionValidationError("关联的生活领域无效。");

  const fields = {
    background: draft.background.trim(),
    options: draft.options.trim(),
    constraints: draft.constraints.trim(),
    criteria: draft.criteria.trim(),
    risks: draft.risks.trim(),
    opportunityCost: draft.opportunityCost.trim(),
    choice: draft.choice.trim(),
    rationale: draft.rationale.trim(),
    executionConditions: draft.executionConditions.trim(),
    outcome: draft.outcome.trim(),
    reflection: draft.reflection.trim(),
  };
  if (Object.values(fields).some((value) => value.length > 2000)) {
    throw new DecisionValidationError("决策内容每项不能超过 2000 个字符。");
  }
  if (draft.status === "decided" && !fields.choice) {
    throw new DecisionValidationError("确定选择时请写下最终选择。");
  }
  return { title, decidedOn, importance: draft.importance, status: draft.status,
    ...fields, reversibility: draft.reversibility, goalId, domainIds, navigationIds, personIds, resourceNeedIds };
}
