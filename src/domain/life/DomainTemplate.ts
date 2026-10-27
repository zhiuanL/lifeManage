import { domainColorKeys, domainIconKeys, type LifeDomainDraft } from "./LifeDomain";

export const domainTemplateFields = {
  name: "领域名称", description: "领域说明", focus: "当下关注",
  longTermExpectation: "长期期待",
} as const;

export const domainTemplateLimits: Record<keyof typeof domainTemplateFields, number> = {
  name: 28, description: 280, focus: 120, longTermExpectation: 500,
};

export function normalizeDomainTemplateDefaults(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("领域模板内容无效。");
  }
  const result: Record<string, string> = {};
  for (const [key, field] of Object.entries(value)) {
    if (typeof field !== "string") throw new Error("领域模板字段无效。");
    if (Object.prototype.hasOwnProperty.call(domainTemplateLimits, key)) {
      if (field.length > domainTemplateLimits[key as keyof typeof domainTemplateLimits]) {
        throw new Error(`${domainTemplateFields[key as keyof typeof domainTemplateLimits]}内容过长。`);
      }
    } else if (key === "color") {
      if (!domainColorKeys.includes(field as LifeDomainDraft["color"])) {
        throw new Error("请选择可用的领域色彩。");
      }
    } else if (key === "icon") {
      if (!domainIconKeys.includes(field as LifeDomainDraft["icon"])) {
        throw new Error("请选择可用的领域图标。");
      }
    } else {
      throw new Error("领域模板字段无效。");
    }
    result[key] = field;
  }
  return result;
}

export function domainDraftFromDefaults(value: unknown): LifeDomainDraft {
  const defaults = normalizeDomainTemplateDefaults(value);
  return {
    name: defaults.name ?? "", description: defaults.description ?? "",
    focus: defaults.focus ?? "", longTermExpectation: defaults.longTermExpectation ?? "",
    color: (defaults.color ?? "ocean") as LifeDomainDraft["color"],
    icon: (defaults.icon ?? "heart") as LifeDomainDraft["icon"],
    currentState: "", status: "active",
  };
}
