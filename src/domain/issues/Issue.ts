import { isPlainDate } from "../planning/Goal";

export const issueStatuses = ["open", "watching", "resolved"] as const;
export type IssueStatus = (typeof issueStatuses)[number];

export interface IssueDraft {
  title: string;
  description: string;
  firstSeen: string;
  occurrenceCount: number;
  causeHypothesis: string;
  attempts: string;
  followUp: string;
  status: IssueStatus;
  goalId: string | null;
  domainIds: readonly string[];
}

export interface Issue extends IssueDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export class IssueValidationError extends Error {}

export function normalizeIssueDraft(draft: IssueDraft): IssueDraft {
  const title = draft.title.trim();
  const description = draft.description.trim();
  const causeHypothesis = draft.causeHypothesis.trim();
  const attempts = draft.attempts.trim();
  const followUp = draft.followUp.trim();
  const firstSeen = draft.firstSeen.trim();
  const goalId = draft.goalId?.trim() || null;
  const domainIds = [...new Set(draft.domainIds.map((id) => id.trim()))];

  if (!title || title.length > 80) {
    throw new IssueValidationError("问题名称不能为空，且不能超过 80 个字符。");
  }
  if (description.length > 1200 || causeHypothesis.length > 800 ||
      attempts.length > 1200 || followUp.length > 1200) {
    throw new IssueValidationError("问题说明、原因、尝试或后续回看超过了长度限制。");
  }
  if (!isPlainDate(firstSeen)) {
    throw new IssueValidationError("首次发现日期请使用有效的年月日。");
  }
  if (!Number.isSafeInteger(draft.occurrenceCount) ||
      draft.occurrenceCount < 1 || draft.occurrenceCount > 999999) {
    throw new IssueValidationError("出现次数请填写 1 到 999999 之间的整数。");
  }
  if (!issueStatuses.includes(draft.status)) {
    throw new IssueValidationError("请选择可用的问题状态。");
  }
  if (domainIds.some((id) => !id)) {
    throw new IssueValidationError("关联的生活领域无效。");
  }

  return { title, description, firstSeen, occurrenceCount: draft.occurrenceCount,
    causeHypothesis, attempts, followUp, status: draft.status, goalId, domainIds };
}
