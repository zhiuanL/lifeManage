import type { DecisionDraft } from "./Decision";

export const decisionTemplateFields = {
  importance: "默认档案类型",
  background: "背景", options: "可选方案", constraints: "现实约束", criteria: "评价维度",
  risks: "风险", opportunityCost: "机会成本", choice: "最终选择", rationale: "选择理由",
  executionConditions: "执行条件", outcome: "后续结果", reflection: "复盘",
} as const;
type DecisionTemplateDefaults = Partial<
  Record<Exclude<keyof typeof decisionTemplateFields, "importance">, string>
> & { importance?: DecisionDraft["importance"] };

export function decisionDraftDefaults(value: unknown): DecisionTemplateDefaults {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("决策模板内容无效。");
  const result: DecisionTemplateDefaults = {};
  for (const [key, field] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(decisionTemplateFields, key)) {
      throw new Error("决策模板字段无效。");
    }
    if (key === "importance") {
      if (field !== "ordinary" && field !== "major") throw new Error("请选择有效的默认档案类型。");
      result.importance = field;
    } else {
      if (typeof field !== "string" || field.length > 2000) throw new Error("决策模板内容无效或过长。");
      result[key as Exclude<keyof typeof decisionTemplateFields, "importance">] = field;
    }
  }
  return result;
}
