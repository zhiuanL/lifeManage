import { isPlainDate } from "../planning/Goal";

import { normalizeReviewStructure, type ReviewStructure } from "./ReviewStructure";

export interface ReviewDraft {
  goalIds?: readonly string[];
  issueIds?: readonly string[];
  structure?: ReviewStructure | null;
  title: string;
  reflection: string;
  insight: string;
  nextFocus: string;
  domainId: string | null;
  domainIds?: readonly string[];
  reviewedOn: string;
}

export interface Review extends ReviewDraft {
  domainIds: readonly string[];
  id: string;
  createdAt: string;
  updatedAt: string;
}

export class ReviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewValidationError";
  }
}

export function normalizeReviewDraft(draft: ReviewDraft): ReviewDraft & { domainIds: string[] } {
  const title = draft.title.trim();
  const reflection = draft.reflection.trim();
  const insight = draft.insight.trim();
  const nextFocus = draft.nextFocus.trim();
  const domainIds = [...new Set((draft.domainIds ?? (draft.domainId ? [draft.domainId] : []))
    .map((id) => id.trim()).filter(Boolean))];
  const domainId = domainIds[0] ?? null;
  const reviewedOn = draft.reviewedOn.trim();

  if (!title) {
    throw new ReviewValidationError("请为这次回顾写下一个标题。");
  }

  if (title.length > 80) {
    throw new ReviewValidationError("回顾标题请控制在 80 个字符以内。");
  }

  if (reflection.length > 1_200) {
    throw new ReviewValidationError("回看内容请控制在 1200 个字符以内。");
  }

  if (insight.length > 1_200) {
    throw new ReviewValidationError("发现内容请控制在 1200 个字符以内。");
  }

  if (nextFocus.length > 600) {
    throw new ReviewValidationError("下一处关注请控制在 600 个字符以内。");
  }

  if (!isPlainDate(reviewedOn)) {
    throw new ReviewValidationError("回顾日期请使用有效的年月日。");
  }
  let structure: ReviewStructure | null | undefined;
  if (draft.structure !== undefined) {
    try { structure = draft.structure === null ? null : normalizeReviewStructure(draft.structure); }
    catch (reason) {
      throw new ReviewValidationError(reason instanceof Error ? reason.message : "结构化复盘格式无效。");
    }
  }

  return {
    title,
    reflection,
    insight,
    nextFocus,
    domainId,
    domainIds,
    reviewedOn,
    ...(draft.goalIds !== undefined ? { goalIds: normalizeReviewLinkIds(draft.goalIds) } : {}),
    ...(draft.issueIds !== undefined ? { issueIds: normalizeReviewLinkIds(draft.issueIds) } : {}),
    ...(draft.structure !== undefined ? { structure } : {}),
  };
}

export function normalizeReviewLinkIds(value: readonly string[]): string[] {
  if (!Array.isArray(value) || value.some(id => typeof id !== "string" || !id.trim())) {
    throw new ReviewValidationError("复盘关联编号无效。");
  }
  return [...new Set(value.map(id => id.trim()))].sort();
}
