import { exportTypes, fieldPresets, scenarioPresets, type ExportScenario, type ExportType } from "../export/ContextExport";
import { validateProgressItems, type GoalProgressItemDraft } from "../progress/GoalProgressItem";
import { normalizeGoalProgressMode } from "../progress/GoalProgressMode";
import { domainTemplateFields, normalizeDomainTemplateDefaults } from "../life/DomainTemplate";
import { recommendedLifeDomains } from "../life/recommendedLifeDomains";
import { habitTemplateFields, normalizeHabitTemplateDefaults } from "../habits/HabitTemplate";
import { issueTemplateFields, normalizeIssueTemplateDefaults } from "../issues/IssueTemplate";
import { decisionTemplateFields, decisionDraftDefaults } from "../decisions/DecisionTemplate";

import { createReviewStructure, defaultReviewTemplate, normalizeReviewTemplate, reviewTypes, type ReviewField, type ReviewType } from "../reviews/ReviewStructure";

export const templateCategories = ["goal", "review", "domain", "issue", "decision", "habit", "export"] as const;
export type TemplateCategory = (typeof templateCategories)[number];
export const templateLabels: Record<TemplateCategory, string> = {
  goal: "目标", review: "回顾", domain: "领域", issue: "问题", decision: "决策",
  habit: "习惯", export: "上下文导出",
};
export const templateFields = {
  goal: { description: "目标说明" },
  domain: domainTemplateFields,
  review: { reflection: "回看", insight: "发现", nextFocus: "下一处关注" },
  issue: issueTemplateFields,
  habit: habitTemplateFields,
  decision: decisionTemplateFields,
  export: { question: "希望讨论的问题" },
} as const;

export interface Template {
  id: string;
  category: TemplateCategory;
  name: string;
  version: number;
  defaults: Record<string, string | number | string[] | Record<string, string[]> | GoalProgressItemDraft[] | ReviewField[]>;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export class TemplateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateValidationError";
  }
}

export function cloneTemplateDefaults(values: Template["defaults"]): Template["defaults"] {
  // Template defaults are persisted JSON, including nested progress and export fields.
  return JSON.parse(JSON.stringify(values)) as Template["defaults"];
}

export function reviewTemplateDefaults(type: ReviewType): Template["defaults"] {
  return { reviewType: type, reviewFields: defaultReviewTemplate(type).fields.map(field => ({ ...field })) };
}

export function reviewStructureFromTemplate(template: Template, anchor: string) {
  if (template.category !== "review") throw new TemplateValidationError("请选择复盘模板。");
  const { defaults } = validateTemplate("review", template.name, template.defaults);
  const type = (defaults.reviewType ?? "daily") as ReviewType;
  const fields = defaults.reviewFields ?? Object.entries(templateFields.review).map(([key, label]) => ({
    key, label, defaultValue: String(defaults[key] ?? ""),
  }));
  return createReviewStructure(type, anchor, normalizeReviewTemplate({
    id: template.id, name: template.name, version: template.version, fields,
  }));
}

export function normalizeTemplateProgressAlgorithm(value: unknown): "automatic" | "habit" {
  if (value === undefined || value === "automatic") return "automatic";
  if (value === "habit") return "habit";
  throw new TemplateValidationError("请选择有效的模板默认计算方式。");
}

const defaults: readonly Omit<Template, "version" | "builtIn" | "createdAt" | "updatedAt">[] = [
  ...recommendedLifeDomains.map(domain => ({
    id: `default-domain-${domain.icon}`, category: "domain" as const,
    name: `${domain.name}领域`, defaults: {
      name: domain.name, description: domain.description, focus: domain.focus,
      color: domain.color, icon: domain.icon, longTermExpectation: "",
    },
  })),
  ...reviewTypes.map(type => ({
    id: defaultReviewTemplate(type).id, category: "review" as const,
    name: defaultReviewTemplate(type).name, defaults: reviewTemplateDefaults(type),
  })),
  { id: "default-smart", category: "goal", name: "SMART 目标", defaults: {
    description: "具体想实现什么？如何知道已经做到？预期何时完成？",
    progressItems: [
      { kind: "milestone", title: "阶段里程碑", targetValue: 1, currentValue: 0, weight: 1 },
      { kind: "outcome", title: "可验证的结果", targetValue: 1, currentValue: 0, weight: 1 },
    ],
  } },
  { id: "default-okr", category: "goal", name: "OKR 方向", defaults: {
    description: "想靠近的方向：\n可观察到的关键结果：",
    progressItems: [
      { kind: "key_result", title: "关键结果 1", targetValue: 1, currentValue: 0, weight: 1 },
      { kind: "key_result", title: "关键结果 2", targetValue: 1, currentValue: 0, weight: 1 },
    ],
  } },
  { id: "default-exploration", category: "goal", name: "探索型目标", defaults: {
    progressMode: "exploration",
    description: "想探索的假设：\n下一次小尝试：",
  } },
  { id: "default-habit-goal", category: "goal", name: "习惯型目标", defaults: {
    progressAlgorithm: "habit",
    description: "希望养成的节奏：\n允许中断后怎样继续：",
  } },
  { id: "default-review", category: "review", name: "轻量回顾", defaults: {
    reflection: "这段时间发生了什么？", insight: "哪些变化值得注意？",
    nextFocus: "接下来愿意照看什么？",
  } },
  { id: "default-issue", category: "issue", name: "问题诊断", defaults: {
    description: "已经发生的事实：", causeHypothesis: "可能的原因（待验证）：",
    attempts: "已经试过：", followUp: "下次回看的信号：",
  } },
  { id: "default-habit", category: "habit", name: "轻量习惯", defaults: {
    intention: "希望保留的日常节奏：", weeklyTarget: 3, frequency: "理想的频率：",
    stableContext: "", triggerCondition: "",
    obstacle: "遇到阻碍时：", adjustment: "允许如何调整：",
  } },
  { id: "default-decision", category: "decision", name: "重大选择", defaults: {
    importance: "major",
    background: "为什么此时要做选择？", options: "有哪些可选方案？",
    constraints: "现实约束：", risks: "可能的风险：",
  } },
  ...Object.entries(scenarioPresets).map(([scenario, preset]) => ({
    id: `default-export-${scenario}`, category: "export" as const,
    name: preset.title, defaults: {
      scenario, question: preset.question, sections: [...preset.sections],
      fields: Object.fromEntries(exportTypes.map((type) => [type, [...fieldPresets[type]]])),
    },
  })),
];

export const builtInTemplates: readonly Template[] = defaults.map((item) => ({
  ...item, version: 1, builtIn: true, createdAt: "", updatedAt: "",
}));

export function validateTemplate(category: TemplateCategory, name: string, values: unknown): {
  name: string; defaults: Template["defaults"];
} {
  try {
    return validateTemplateValues(category, name, values);
  } catch (reason) {
    if (reason instanceof TemplateValidationError) throw reason;
    throw new TemplateValidationError(reason instanceof Error ? reason.message : "模板内容无效。");
  }
}

function validateTemplateValues(category: TemplateCategory, name: string, values: unknown): {
  name: string; defaults: Template["defaults"];
} {
  if (!templateCategories.includes(category) || !name.trim() || name.trim().length > 80) {
    throw new Error("请选择类型，并填写不超过 80 字的模板名称。");
  }
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("模板内容无效。");
  if (category === "domain") {
    return { name: name.trim(), defaults: normalizeDomainTemplateDefaults(values) };
  }
  if (category === "habit") {
    return { name: name.trim(), defaults: normalizeHabitTemplateDefaults(values) as Template["defaults"] };
  }
  if (category === "issue") {
    return { name: name.trim(), defaults: normalizeIssueTemplateDefaults(values) };
  }
  if (category === "decision") {
    return { name: name.trim(), defaults: decisionDraftDefaults(values) };
  }
  const fields = templateFields[category];
  const record = { ...values } as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === "reviewType" || key === "reviewFields") {
      if (category !== "review") throw new Error("模板字段无效。");
    } else if (key === "progressAlgorithm") {
      if (category !== "goal") throw new Error("模板字段无效。");
      record[key] = normalizeTemplateProgressAlgorithm(value);
    } else if (key === "progressMode") {
      if (category !== "goal") throw new Error("模板字段无效。");
      record[key] = normalizeGoalProgressMode(value);
    } else if (key === "progressItems") {
      if (category !== "goal" || !Array.isArray(value)) throw new Error("模板进度项无效。");
      record[key] = validateProgressItems(value);
    } else if (key === "sections" || key === "fields" || key === "scenario") {
      if (category !== "export") throw new Error("模板字段无效。");
    } else if (!Object.prototype.hasOwnProperty.call(fields, key) || typeof value !== "string" || value.length > 2000) {
      throw new Error("模板字段无效或内容过长。");
    }
  }
  if (category === "review" && ("reviewType" in record || "reviewFields" in record)) {
    if (!reviewTypes.includes(record.reviewType as ReviewType)) throw new Error("请选择有效的复盘周期。");
    if (Object.keys(record).some(key => key !== "reviewType" && key !== "reviewFields")) {
      throw new Error("周期复盘模板不能混用旧版回顾字段。");
    }
    record.reviewFields = normalizeReviewTemplate({
      id: "validation", name: name.trim(), version: 1, fields: record.reviewFields,
    }).fields;
  }
  if (category === "goal" && normalizeTemplateProgressAlgorithm(record.progressAlgorithm) === "habit" &&
      normalizeGoalProgressMode(record.progressMode) !== "automatic") {
    throw new Error("习惯型模板不能同时使用探索型进度方式。");
  }
  if (category === "export") {
    const scenario = record.scenario as ExportScenario;
    if (!Object.prototype.hasOwnProperty.call(scenarioPresets, scenario)) throw new Error("导出场景无效。");
    const sections = record.sections;
    if (!Array.isArray(sections) || sections.some((type) =>
      !scenarioPresets[scenario].sections.includes(type as ExportType)) ||
      new Set(sections).size !== sections.length) throw new Error("导出分段无效。");
    const orders = record.fields;
    if (!orders || typeof orders !== "object" || Array.isArray(orders)) throw new Error("导出字段无效。");
    for (const [type, order] of Object.entries(orders)) {
      if (!exportTypes.includes(type as ExportType) || !Array.isArray(order) ||
          order.some((field) => !fieldPresets[type as ExportType].includes(field)) ||
          new Set(order).size !== order.length) throw new Error("导出字段无效。");
    }
  }
  return { name: name.trim(), defaults: record as Template["defaults"] };
}
