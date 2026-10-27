import type { IssueDraft } from "./Issue";

export const issueTemplateFields = {
  description: "问题描述", causeHypothesis: "原因假设",
  attempts: "尝试过的方案", followUp: "后续回看",
} as const;
export const issueTemplateLimits = {
  description: 1200, causeHypothesis: 800, attempts: 1200, followUp: 1200,
} as const;
type IssueTemplateDefaults = Partial<Record<keyof typeof issueTemplateFields, string>>;

export function normalizeIssueTemplateDefaults(value: unknown): IssueTemplateDefaults {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("问题模板内容无效。");
  const result: IssueTemplateDefaults = {};
  for (const [key, field] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(issueTemplateFields, key) ||
        typeof field !== "string" || field.length > 2000) {
      throw new Error("问题模板字段无效或内容过长。");
    }
    result[key as keyof typeof issueTemplateFields] = field;
  }
  return result;
}

export function issueDraftDefaults(value: unknown): Partial<IssueDraft> {
  const defaults = normalizeIssueTemplateDefaults(value);
  for (const key of Object.keys(issueTemplateLimits) as (keyof typeof issueTemplateLimits)[]) {
    if ((defaults[key]?.length ?? 0) > issueTemplateLimits[key]) {
      throw new Error("问题模板文字超过问题字段上限，请先在模板中心调整。");
    }
  }
  return defaults;
}
