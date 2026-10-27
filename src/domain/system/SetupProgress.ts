export interface SetupProgress { step: number; completed: boolean }
export const setupStepLabels = ["人生领域", "目标模板", "复盘模板", "人生景观", "提醒规则", "启用模块"] as const;
export function validateSetupProgress(value: unknown): SetupProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("初始化进度无效。");
  const item = value as Record<string, unknown>;
  if (!Number.isInteger(item.step) || Number(item.step) < 0 || Number(item.step) >= setupStepLabels.length ||
    typeof item.completed !== "boolean") throw new Error("初始化进度无效。");
  return { step: Number(item.step), completed: item.completed };
}
