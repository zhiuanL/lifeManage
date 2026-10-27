import { ProgressItemValidationError, validateProgressItems, type GoalProgressItem, type GoalProgressItemDraft } from
  "../../domain/progress/GoalProgressItem";
import type { GoalProgressItemRepository } from "../../repositories/planning/GoalProgressItemRepository";
import type { GoalRepository } from "../../repositories/planning/GoalRepository";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";

export type EditableProgressItem = GoalProgressItemDraft & { id?: string };

export class GoalProgressItemService {
  constructor(
    private readonly repository: GoalProgressItemRepository,
    private readonly goals: GoalRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  list(): Promise<readonly GoalProgressItem[]> {
    return this.repository.list();
  }

  async replace(goalId: string, drafts: readonly EditableProgressItem[]): Promise<readonly GoalProgressItem[]> {
    if (!(await this.goals.findById(goalId))) throw new ProgressItemValidationError("目标已不存在，请重新读取后再试。");
    const normalized = validateProgressItems(drafts);
    const before = (await this.repository.list()).filter((item) => item.goalId === goalId);
    const oldById = new Map(before.map((item) => [item.id, item]));
    const used = new Set<string>();
    const timestamp = this.clock.now().toISOString();
    const items = normalized.map((item, sortOrder) => {
      if (drafts[sortOrder].id && !oldById.has(drafts[sortOrder].id!)) {
        throw new ProgressItemValidationError("进度项已改变，请重新打开目标。");
      }
      const id = drafts[sortOrder].id ?? this.ids.next();
      if (used.has(id)) throw new ProgressItemValidationError("进度项不能重复。");
      used.add(id);
      return {
        ...item, id, goalId, sortOrder,
        createdAt: oldById.get(id)?.createdAt ?? timestamp, updatedAt: timestamp,
      };
    });
    if (before.length === items.length && items.every((item, index) =>
      item.id === before[index].id && item.kind === before[index].kind &&
      item.title === before[index].title && item.targetValue === before[index].targetValue &&
      item.currentValue === before[index].currentValue && item.weight === before[index].weight)) {
      return before;
    }
    await this.repository.replace(goalId, items, timestamp);
    return items;
  }
}
