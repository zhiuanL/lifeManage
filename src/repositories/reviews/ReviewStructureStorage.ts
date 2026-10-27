import { normalizeReviewStructure, type ReviewStructure } from "../../domain/reviews/ReviewStructure";

export interface ReviewStructureColumns {
  review_type: string | null;
  period_start: string | null;
  period_end: string | null;
  review_status: string | null;
  review_mode: string | null;
  template_snapshot: string | null;
}

export interface ReviewAnswerRow {
  review_id: string;
  field_key: string;
  value: string;
}

export interface ReviewStructureStorage {
  columns: ReviewStructureColumns;
  answers: readonly ReviewAnswerRow[];
}

export function encodeReviewStructure(reviewId: string, structure: ReviewStructure | null): ReviewStructureStorage {
  assertReviewId(reviewId);
  if (structure === null) {
    return { columns: {
      review_type: null, period_start: null, period_end: null,
      review_status: null, review_mode: null, template_snapshot: null,
    }, answers: [] };
  }
  const normalized = normalizeReviewStructure(structure);
  return {
    columns: {
      review_type: normalized.type, period_start: normalized.start, period_end: normalized.end,
      review_status: normalized.status, review_mode: normalized.mode,
      template_snapshot: JSON.stringify(normalized.template),
    },
    answers: normalized.template.fields.map(field => ({
      review_id: reviewId, field_key: field.key, value: normalized.answers[field.key],
    })),
  };
}

export function decodeReviewStructure(reviewId: string, columns: ReviewStructureColumns, rows: readonly ReviewAnswerRow[]): ReviewStructure | null {
  assertReviewId(reviewId);
  const metadata = [columns.review_type, columns.period_start, columns.period_end,
    columns.review_status, columns.review_mode, columns.template_snapshot];
  if (metadata.every(value => value === null)) {
    if (rows.length) throw new Error("未分类回顾不能包含结构化答案。");
    return null;
  }
  if (metadata.some(value => typeof value !== "string")) {
    throw new Error("复盘周期或模板快照缺失，请检查本地数据。");
  }
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.review_id !== reviewId) throw new Error("复盘答案归属不一致。");
    if (typeof row.field_key !== "string" || keys.has(row.field_key)) {
      throw new Error("复盘答案字段无效或重复。");
    }
    keys.add(row.field_key);
  }
  let template: unknown;
  try { template = JSON.parse(columns.template_snapshot as string); }
  catch { throw new Error("复盘模板快照损坏，请检查本地数据。"); }
  const normalized = normalizeReviewStructure({
    type: columns.review_type, start: columns.period_start, end: columns.period_end,
    status: columns.review_status, mode: columns.review_mode, template,
    answers: Object.fromEntries(rows.map(row => [row.field_key, row.value])),
  });
  // Drafts may omit answers; persisted reviews must retain every explicit field.
  if (normalized.template.fields.some(field => !keys.has(field.key))) {
    throw new Error("复盘答案缺失，请检查本地数据。");
  }
  return normalized;
}

function assertReviewId(value: string): void {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error("复盘编号无效。");
  }
}

