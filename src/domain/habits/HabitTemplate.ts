import type { HabitDraft } from "./Habit";

export const habitTemplateFields = {
  intention: "养成意图", weeklyTarget: "每周期望次数", frequency: "期望节奏",
  stableContext: "稳定情境", triggerCondition: "触发条件",
  obstacle: "可能的阻碍", adjustment: "调整方式",
} as const;

type HabitTemplateDefaults = Partial<Record<Exclude<keyof typeof habitTemplateFields, "weeklyTarget">, string>>
  & { weeklyTarget?: number };

export function normalizeHabitTemplateDefaults(value: unknown): HabitTemplateDefaults {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("习惯模板内容无效。");
  const result: HabitTemplateDefaults = {};
  for (const [key, field] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(habitTemplateFields, key)) {
      throw new Error("习惯模板字段无效。");
    }
    if (key === "weeklyTarget") {
      if (typeof field !== "number" || !Number.isInteger(field) || field < 1 || field > 7) {
        throw new Error("习惯模板每周期望次数需为 1 到 7 的整数。");
      }
      result.weeklyTarget = field;
    } else {
      // Old text defaults allowed 2000 characters; keep them readable without truncation.
      const limit = key === "stableContext" || key === "triggerCondition" ? 500 : 2000;
      if (typeof field !== "string" || field.length > limit) throw new Error("习惯模板内容无效或过长。");
      result[key as Exclude<keyof typeof habitTemplateFields, "weeklyTarget">] = field;
    }
  }
  return result;
}

export function habitDraftDefaults(value: unknown): Partial<HabitDraft> {
  const defaults = normalizeHabitTemplateDefaults(value);
  const result: Partial<HabitDraft> = {};
  for (const key of ["intention", "stableContext", "triggerCondition", "obstacle", "adjustment"] as const) {
    const field = defaults[key];
    if (field === undefined) continue;
    if (field.length > 500) throw new Error("习惯模板文字超过习惯字段上限，请先在模板中心调整。");
    result[key] = field;
  }
  if (defaults.weeklyTarget !== undefined) result.weeklyTarget = defaults.weeklyTarget;
  return result;
}
