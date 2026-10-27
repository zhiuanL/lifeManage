import type { GoalDraft } from "./Goal";

export const goalSectionFields = {
  basics: ["title", "description", "targetDate", "priority"],
  context: ["domainIds", "parentId", "progressWeight", "horizon", "directionId"],
  lifecycle: ["status", "statusReason"],
  relations: ["relations"],
  progress: ["progressMode", "habitProgress"],
} as const satisfies Record<string, readonly (keyof GoalDraft)[]>;

export type GoalSection = keyof typeof goalSectionFields;
export const goalSectionLabels: Record<GoalSection, string> = {
  basics: "基本信息", context: "领域与层级", lifecycle: "状态",
  relations: "目标关系", progress: "进度设置",
};

export function goalSectionPatch(section: GoalSection, draft: GoalDraft): Partial<GoalDraft> {
  return Object.fromEntries(goalSectionFields[section].map((key) => [key, draft[key]]));
}
