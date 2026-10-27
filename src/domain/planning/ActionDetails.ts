import { ActionValidationError } from "./ActionValidationError.ts";

export const actionFeedbackFields = [
  ["actualResult", "实际结果"], ["learning", "收获"], ["problems", "遇到的问题"],
  ["incompleteReason", "未完成原因"], ["nextAdjustment", "后续调整"],
] as const;
export const actionIntentionFields = [
  ["trigger", "触发情境"], ["execution", "执行动作"], ["fallback", "备用方案"],
] as const;
export const actionDetailFields = [...actionFeedbackFields, ...actionIntentionFields];
type ActionDetailText = (typeof actionDetailFields)[number][0];
export type ActionDetails = Record<ActionDetailText, string> & { actualMinutes: number | null };

export function normalizeActionDetails(value: unknown = {}): ActionDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ActionValidationError("行动反馈格式无效。");
  const source = value as Record<string, unknown>;
  const allowed = new Set<string>([...actionDetailFields.map(([key]) => key), "actualMinutes"]);
  if (Object.keys(source).some((key) => !allowed.has(key))) throw new ActionValidationError("行动反馈包含未知字段。");
  const result = {} as ActionDetails;
  for (const [key, label] of actionDetailFields) {
    const text = source[key] ?? "";
    if (typeof text !== "string" || text.trim().length > 2000) {
      throw new ActionValidationError(`${label}请填写不超过 2000 个字符的文字。`);
    }
    result[key] = text.trim();
  }
  const minutes = source.actualMinutes ?? null;
  if (minutes !== null && (typeof minutes !== "number" || !Number.isSafeInteger(minutes) || minutes < 0)) {
    throw new ActionValidationError("投入时间请填写零或正整数分钟，也可以留空。");
  }
  result.actualMinutes = minutes;
  return result;
}

export function parseActionDetails(json: string): ActionDetails {
  try { return normalizeActionDetails(JSON.parse(json)); }
  catch { throw new Error("行动反馈数据无效，请检查备份。"); }
}
