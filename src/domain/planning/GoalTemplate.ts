import type { GoalDraft } from "./Goal";
import { validateProgressItems, type GoalProgressItemDraft } from "../progress/GoalProgressItem";
import { normalizeGoalProgressMode } from "../progress/GoalProgressMode";
import { normalizeTemplateProgressAlgorithm, validateTemplate } from "../templates/Template";

export function goalDraftDefaults(value: unknown): {
  description: string;
  progressMode: NonNullable<GoalDraft["progressMode"]>;
  habitEnabled: boolean;
  progressItems: GoalProgressItemDraft[];
} {
  const { defaults } = validateTemplate("goal", "目标模板", value);
  const description = defaults.description ?? "";
  if (typeof description !== "string" || description.length > 600) {
    throw new Error("模板目标说明须为不超过 600 字的文本，请先修改模板。");
  }
  return {
    description,
    progressMode: normalizeGoalProgressMode(defaults.progressMode),
    habitEnabled: normalizeTemplateProgressAlgorithm(defaults.progressAlgorithm) === "habit",
    progressItems: validateProgressItems((defaults.progressItems ?? []) as GoalProgressItemDraft[]),
  };
}
