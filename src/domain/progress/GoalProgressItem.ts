export const progressItemKinds = ["key_result", "milestone", "outcome", "exploration"] as const;
export type ProgressItemKind = (typeof progressItemKinds)[number];

export const progressItemLabels: Record<ProgressItemKind, string> = {
  key_result: "关键结果",
  milestone: "里程碑",
  outcome: "量化结果",
  exploration: "探索节点",
};

export interface GoalProgressItemDraft {
  kind: ProgressItemKind;
  title: string;
  targetValue: number;
  currentValue: number;
  weight: number;
}

export interface GoalProgressItem extends GoalProgressItemDraft {
  id: string;
  goalId: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export class ProgressItemValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProgressItemValidationError";
  }
}

export function validateProgressItems(items: readonly GoalProgressItemDraft[]): GoalProgressItemDraft[] {
  if (!Array.isArray(items)) throw new ProgressItemValidationError("进度项内容无效。");
  if (items.length > 30) throw new ProgressItemValidationError("每个目标最多添加 30 个进度项。");
  return items.map((item) => {
    if (!item || typeof item !== "object" || typeof item.title !== "string") {
      throw new ProgressItemValidationError("进度项内容无效。");
    }
    const title = item.title.trim();
    if (!progressItemKinds.includes(item.kind)) throw new ProgressItemValidationError("请选择进度项类型。");
    if (!title || title.length > 80) throw new ProgressItemValidationError("进度项名称请控制在 1 到 80 个字符。");
    if (![item.targetValue, item.currentValue, item.weight].every(Number.isFinite) ||
        item.targetValue <= 0 || item.targetValue > 1e9 ||
        item.currentValue < 0 || item.currentValue > 1e9 ||
        item.weight <= 0 || item.weight > 100) {
      throw new ProgressItemValidationError("目标值须大于 0，当前值不能为负，权重须在 0 到 100 之间。");
    }
    return { kind: item.kind, title, targetValue: item.targetValue,
      currentValue: item.currentValue, weight: item.weight };
  });
}
