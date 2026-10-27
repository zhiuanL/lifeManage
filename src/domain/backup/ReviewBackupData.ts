import { normalizeReviewStructure } from "../reviews/ReviewStructure";

const columns = ["review_type", "period_start", "period_end", "review_status", "review_mode", "template_snapshot"] as const;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("复盘备份结构无效。");
  return value as Record<string, unknown>;
}

function validateStructure(row: Record<string, unknown>, answers: readonly Record<string, unknown>[]) {
  if (columns.some(key => !Object.prototype.hasOwnProperty.call(row, key))) throw new Error("复盘备份元数据缺失。");
  if (columns.every(key => row[key] === null)) {
    if (answers.length) throw new Error("未分类复盘不能包含答案。");
    return;
  }
  if (columns.some(key => typeof row[key] !== "string")) throw new Error("复盘备份元数据不完整。");
  const keys = new Set<string>();
  for (const answer of answers) {
    if (typeof answer.field_key !== "string" || keys.has(answer.field_key)) throw new Error("复盘备份答案字段无效或重复。");
    keys.add(answer.field_key);
  }
  let template: unknown;
  try { template = JSON.parse(row.template_snapshot as string); }
  catch { throw new Error("复盘备份模板快照损坏。"); }
  const structure = normalizeReviewStructure({
    type: row.review_type, start: row.period_start, end: row.period_end,
    status: row.review_status, mode: row.review_mode, template,
    answers: Object.fromEntries(answers.map(answer => [answer.field_key, answer.value])),
  });
  if (structure.template.fields.some(field => !keys.has(field.key))) throw new Error("复盘备份答案缺失。");
}

export function validateReviewBackupData(value: unknown): void {
  const data = record(value);
  if (!Array.isArray(data.review_answers)) throw new Error("复盘备份缺少答案表。");
  const answers = data.review_answers.map(value => {
    const answer = record(value);
    if (Object.keys(answer).length !== 3 ||
        !["review_id", "field_key", "value"].every(key => Object.prototype.hasOwnProperty.call(answer, key)) ||
        typeof answer.review_id !== "string" || !answer.review_id.trim() ||
        answer.review_id !== answer.review_id.trim() || typeof answer.field_key !== "string" ||
        typeof answer.value !== "string" || answer.value.length > 12000) throw new Error("复盘备份答案格式无效。");
    return answer;
  });
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const answer of answers) {
    const id = answer.review_id as string;
    const group = groups.get(id) ?? [];
    group.push(answer);
    groups.set(id, group);
  }
  if (!Array.isArray(data.reviews) || !Array.isArray(data.object_versions)) throw new Error("复盘备份记录或历史缺失。");
  const reviews = data.reviews.map(record);
  const ids = new Set(reviews.map(row => row.id));
  for (const id of groups.keys()) if (!ids.has(id)) throw new Error("复盘答案引用了不存在的回顾。");
  for (const row of reviews) {
    if (typeof row.id !== "string" || row.id !== row.id.trim()) throw new Error("复盘备份编号无效。");
    validateStructure(row, groups.get(row.id) ?? []);
  }
  for (const version of data.object_versions.map(record)) {
    if (version.object_type !== "review") continue;
    const snapshot = record(JSON.parse(String(version.snapshot_json)));
    for (const key of ["goal_ids", "issue_ids"]) {
      const ids = snapshot[key];
      if (ids === undefined) continue;
      if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !id.trim() || id !== id.trim()) || new Set(ids).size !== ids.length) throw new Error("复盘历史关联格式无效。");
    }
    const hasAnswers = Object.prototype.hasOwnProperty.call(snapshot, "answers");
    const hasColumns = columns.some(key => Object.prototype.hasOwnProperty.call(snapshot, key));
    if (!hasAnswers && !hasColumns) continue;
    if (!hasAnswers || !Array.isArray(snapshot.answers)) throw new Error("复盘历史答案缺失或无效。");
    const historyAnswers = snapshot.answers.map(value => {
      const answer = record(value);
      if (Object.keys(answer).length !== 2 ||
          !Object.prototype.hasOwnProperty.call(answer, "field_key") ||
          !Object.prototype.hasOwnProperty.call(answer, "value")) throw new Error("复盘历史答案格式无效。");
      return answer;
    });
    if (typeof version.object_id !== "string" || !version.object_id.trim() ||
        version.object_id !== version.object_id.trim()) throw new Error("复盘历史编号无效。");
    validateStructure(snapshot, historyAnswers);
  }
}


