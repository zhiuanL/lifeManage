import { isPlainDate } from "../planning/Goal";

export const reviewTypes = ["daily", "weekly", "monthly", "quarterly", "annual"] as const;
export type ReviewType = (typeof reviewTypes)[number];
export const reviewTypeLabels: Record<ReviewType, string> = {
  daily: "日复盘", weekly: "周复盘", monthly: "月复盘", quarterly: "季度复盘", annual: "年度复盘",
};
export type ReviewStatus = "draft" | "completed";
export type ReviewMode = "structured" | "narrative";
export interface ReviewField { key: string; label: string; defaultValue: string }
export interface ReviewTemplateSnapshot {
  id: string; name: string; version: number; fields: readonly ReviewField[];
}
export interface ReviewPeriod { type: ReviewType; start: string; end: string }
export interface ReviewStructure extends ReviewPeriod {
  status: ReviewStatus; mode: ReviewMode; template: ReviewTemplateSnapshot;
  answers: Readonly<Record<string, string>>;
}

export function defaultReviewTemplate(value: ReviewType): ReviewTemplateSnapshot {
  const periodType = type(value);
  return {
    id: `default-review-${periodType}`, name: reviewTypeLabels[periodType], version: 1,
    fields: definitions[periodType].map(([key, label]) => ({ key, label, defaultValue: "" })),
  };
}

export function createReviewStructure(value: ReviewType, anchor: string, template?: ReviewTemplateSnapshot): ReviewStructure {
  const snapshot = normalizeReviewTemplate(template ?? defaultReviewTemplate(value));
  return {
    ...reviewPeriod(value, anchor), status: "draft", mode: "structured", template: snapshot,
    answers: Object.fromEntries(snapshot.fields.map(field => [field.key, field.defaultValue])),
  };
}

export function normalizeReviewStructure(value: unknown): ReviewStructure {
  const source = record(value, "结构化复盘格式无效。");
  keys(source, ["type", "start", "end", "status", "mode", "template", "answers"], "结构化复盘包含未知字段。");
  const periodType = type(source.type);
  const start = date(source.start);
  const end = date(source.end);
  const expected = reviewPeriod(periodType, start);
  if (start !== expected.start || end !== expected.end) throw new Error("复盘起止日期与所选周期不一致。");
  if (source.status !== "draft" && source.status !== "completed") throw new Error("请选择有效的复盘状态。");
  if (source.mode !== "structured" && source.mode !== "narrative") throw new Error("请选择有效的复盘书写模式。");
  if (source.mode === "narrative" && (periodType === "daily" || periodType === "weekly")) {
    throw new Error("日复盘和周复盘使用结构化书写模式。");
  }
  const template = normalizeReviewTemplate(source.template);
  const answers = record(source.answers, "复盘答案格式无效。");
  keys(answers, template.fields.map(field => field.key), "复盘答案包含模板以外的字段。");
  return {
    type: periodType, start, end, status: source.status, mode: source.mode, template,
    answers: Object.fromEntries(template.fields.map(field => [field.key,
      text(Object.prototype.hasOwnProperty.call(answers, field.key) ? answers[field.key] : "", 12000, `${field.label}请填写不超过 12000 个字符的文字。`)])),
  };
}

export function parseReviewStructure(json: string): ReviewStructure {
  try { return normalizeReviewStructure(JSON.parse(json)); }
  catch { throw new Error("结构化复盘数据无效，请检查备份。"); }
}

// UTC date-only arithmetic avoids DST and local timezone shifts.
export function reviewPeriod(value: ReviewType, anchor: string): ReviewPeriod {
  const periodType = type(value);
  date(anchor);
  const start = new Date(`${anchor}T00:00:00.000Z`);
  const end = new Date(start);
  switch (periodType) {
    case "daily": break;
    case "weekly":
      start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
      end.setTime(start.getTime());
      end.setUTCDate(end.getUTCDate() + 6);
      break;
    case "monthly":
      start.setUTCDate(1);
      end.setUTCMonth(end.getUTCMonth() + 1, 0);
      break;
    case "quarterly":
      start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3, 1);
      end.setTime(start.getTime());
      end.setUTCMonth(end.getUTCMonth() + 3, 0);
      break;
    case "annual":
      start.setUTCMonth(0, 1);
      end.setUTCMonth(11, 31);
      break;
  }
  const result = { type: periodType, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  if (!isPlainDate(result.start) || !isPlainDate(result.end)) throw new Error("复盘周期超出有效日期范围。");
  return result;
}

export function normalizeReviewTemplate(value: unknown): ReviewTemplateSnapshot {
  const source = record(value, "复盘模板快照格式无效。");
  keys(source, ["id", "name", "version", "fields"], "复盘模板快照包含未知字段。");
  const id = text(source.id, 128, "复盘模板编号无效。");
  const name = text(source.name, 80, "复盘模板名称请填写不超过 80 个字符的文字。");
  if (!id || !name || typeof source.version !== "number" || !Number.isSafeInteger(source.version) || source.version < 1) {
    throw new Error("复盘模板版本无效。");
  }
  if (!Array.isArray(source.fields) || source.fields.length < 1 || source.fields.length > 32) {
    throw new Error("复盘模板请保留 1 至 32 个字段。");
  }
  const seen = new Set<string>();
  const fields = source.fields.map(value => {
    const field = record(value, "复盘模板字段格式无效。");
    keys(field, ["key", "label", "defaultValue"], "复盘模板字段包含未知属性。");
    const key = text(field.key, 64, "复盘字段编号无效。");
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(key) || ["constructor", "prototype"].includes(key) || seen.has(key)) {
      throw new Error("复盘字段编号无效或重复。");
    }
    seen.add(key);
    const label = text(field.label, 80, "复盘字段名称请填写不超过 80 个字符的文字。");
    if (!label) throw new Error("请填写复盘字段名称。");
    const defaultValue = text(Object.prototype.hasOwnProperty.call(field, "defaultValue") ? field.defaultValue : "", 2000, "复盘字段默认内容请控制在 2000 个字符以内。");
    return { key, label, defaultValue };
  });
  return { id, name, version: source.version, fields };
}

const definitions: Record<ReviewType, readonly (readonly [string, string])[]> = {
  daily: [["completed", "完成了什么"], ["incomplete", "未完成的事"],
    ["incompleteReasons", "未完成原因"], ["state", "今日状态"], ["learning", "今日收获"],
    ["nextAdjustment", "明日调整"], ["goalAdjustment", "目标是否需要调整"]],
  weekly: [["execution", "本周执行总结"], ["goalProgress", "目标进度"],
    ["recurringIssues", "反复问题"], ["planChanges", "计划变更"],
    ["domainState", "人生领域状态"], ["nextFocus", "下周重点"]],
  monthly: [["weeklyConclusions", "各周结论"], ["domainTrends", "领域状态趋势"],
    ["monthlyFocus", "月度重点完成情况"], ["issueEvolution", "问题演化"],
    ["focusAdjustment", "重点调整"], ["nextFocus", "下月重点"]],
  quarterly: [["monthlyConclusions", "各月结论"], ["stageGoals", "阶段目标"],
    ["domainState", "人生领域状态"], ["resourceGaps", "资源缺口"],
    ["directionAdjustment", "方向校准"], ["goalRollover", "目标滚动"], ["nextFocus", "下季度重点"]],
  annual: [["quarterlyConclusions", "各季度结论"], ["annualGoals", "年度目标与结果"],
    ["importantEvents", "重要事件"], ["majorDecisions", "重大决策"],
    ["capabilityGrowth", "能力成长"], ["domainChanges", "领域变化"],
    ["longTermDirection", "长期方向校准"], ["nextFocus", "下一年方向"]],
};

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(message);
  return value as Record<string, unknown>;
}
function keys(source: Record<string, unknown>, allowed: readonly string[], message: string) {
  if (Object.keys(source).some(key => !allowed.includes(key))) throw new Error(message);
}
function text(value: unknown, limit: number, message: string): string {
  if (typeof value !== "string" || value.length > limit) throw new Error(message);
  return value.trim();
}
function date(value: unknown): string {
  if (typeof value !== "string" || !isPlainDate(value)) throw new Error("复盘周期请使用有效的年月日。");
  return value;
}
function type(value: unknown): ReviewType {
  if (!reviewTypes.includes(value as ReviewType)) throw new Error("请选择有效的复盘周期。");
  return value as ReviewType;
}
