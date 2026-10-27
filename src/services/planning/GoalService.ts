import {
  GoalValidationError,
  normalizeGoalDraft,
  type Goal,
  type GoalDraft,
} from "../../domain/planning/Goal";
import { goalSectionPatch, type GoalSection } from "../../domain/planning/GoalSection";
import { validateGoalRelations } from "../../domain/planning/GoalRelation";
import type { LifeDomainRepository } from "../../repositories/life/LifeDomainRepository";
import { validateProgressItems, type GoalProgressItemDraft } from "../../domain/progress/GoalProgressItem";
import type { GoalRepository } from "../../repositories/planning/GoalRepository";
import type { HabitRepository } from "../../repositories/habits/HabitRepository";
import type { LifeNavigationRepository } from "../../repositories/life/LifeNavigationRepository";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";

export class GoalService {
  constructor(
    private readonly repository: GoalRepository,
    private readonly lifeDomainRepository: LifeDomainRepository,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly habitRepository?: HabitRepository,
    private readonly navigationRepository?: LifeNavigationRepository,
  ) {}

  list(): Promise<readonly Goal[]> {
    return this.repository.list();
  }

  findById(id: string): Promise<Goal | null> {
    return this.repository.findById(id);
  }

  async create(draft: GoalDraft, progressItems: readonly GoalProgressItemDraft[] = []): Promise<Goal> {
    return this.createWithId(this.idGenerator.next(), draft, progressItems);
  }

  async createWithId(id: string, draft: GoalDraft,
    progressItems: readonly GoalProgressItemDraft[] = []): Promise<Goal> {
    const normalizedDraft = normalizeGoalDraft(draft);
    await this.assertDirection(normalizedDraft);
    await this.assertHabitsExist(normalizedDraft);
    this.assertStatusReason(normalizedDraft);
    const normalizedItems = validateProgressItems(progressItems);
    await this.assertDomainsExist(normalizedDraft.domainIds);
    const existingGoals = await this.repository.list();
    this.assertValidParent(id, normalizedDraft.parentId, existingGoals);
    normalizedDraft.relations = validateGoalRelations(id, normalizedDraft.relations ?? [], existingGoals);
    const timestamp = this.clock.now().toISOString();
    const goal: Goal = {
      id,
      ...normalizedDraft,
      sortOrder: existingGoals.length,
      completedAt: normalizedDraft.status === "completed" ? timestamp : null,
      archivedAt: normalizedDraft.status === "archived" ? timestamp : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const items = normalizedItems.map((item, sortOrder) => ({
      ...item, id: this.idGenerator.next(), goalId: id, sortOrder,
      createdAt: timestamp, updatedAt: timestamp,
    }));
    await this.repository.create(goal, items);
    return goal;
  }

  async updateSection(id: string, section: GoalSection, draft: GoalDraft): Promise<Goal> {
    const current = await this.repository.findById(id);
    if (!current) throw new GoalValidationError("这个目标已经不存在了。");
    return this.update(id, { ...current, ...goalSectionPatch(section, draft) });
  }

  async update(id: string, draft: GoalDraft): Promise<Goal> {
    const existingGoal = await this.repository.findById(id);

    if (!existingGoal) {
      throw new GoalValidationError("这个目标已经不存在了。");
    }

    const normalizedDraft = normalizeGoalDraft({
      ...draft,
      horizon: draft.horizon === undefined ? existingGoal.horizon : draft.horizon,
      directionId: draft.directionId === undefined ? existingGoal.directionId : draft.directionId,
      relations: draft.relations === undefined ? existingGoal.relations : draft.relations,
      priority: draft.priority === undefined ? existingGoal.priority : draft.priority,
      parentId: draft.parentId === undefined ? existingGoal.parentId : draft.parentId,
      progressWeight: draft.progressWeight === undefined ? existingGoal.progressWeight : draft.progressWeight,
      progressMode: draft.progressMode === undefined ? existingGoal.progressMode : draft.progressMode,
      habitProgress: draft.habitProgress === undefined ? existingGoal.habitProgress : draft.habitProgress,
      statusReason: draft.statusReason === undefined && draft.status === existingGoal.status
        ? existingGoal.statusReason : draft.statusReason,
    });
    this.assertStatusReason(normalizedDraft, existingGoal);
    await this.assertDirection(normalizedDraft, existingGoal);
    await this.assertHabitsExist(normalizedDraft);
    await this.assertDomainsExist(normalizedDraft.domainIds);
    const goals = await this.repository.list();
    this.assertValidParent(id, normalizedDraft.parentId, goals);
    normalizedDraft.relations = validateGoalRelations(id, normalizedDraft.relations ?? [], goals);
    const timestamp = this.clock.now().toISOString();
    const goal: Goal = {
      ...existingGoal,
      ...normalizedDraft,
      completedAt:
        normalizedDraft.status === "completed"
          ? (existingGoal.completedAt ?? timestamp)
          : normalizedDraft.status === "archived" ? existingGoal.completedAt : null,
      archivedAt: normalizedDraft.status === "archived"
        ? (existingGoal.archivedAt ?? timestamp) : null,
      updatedAt: timestamp,
    };

    await this.repository.update(goal);
    return goal;
  }

  private async assertDirection(draft: GoalDraft, existing?: Goal): Promise<void> {
    if (!draft.directionId) {
      if (draft.horizon === "annual" && !(existing?.horizon === "annual" && !existing.directionId)) {
        throw new GoalValidationError("请为年度目标关联一个长期方向。");
      }
      return;
    }
    const direction = await this.navigationRepository?.findById(draft.directionId);
    if (!direction || direction.kind !== "vision") throw new GoalValidationError("关联的长期方向不存在或类型不符。");
    if (direction.archivedAt && existing?.directionId !== direction.id) {
      throw new GoalValidationError("这个长期方向已归档，请选择其他方向。");
    }
  }

  private async assertDomainsExist(domainIds: readonly string[]): Promise<void> {
    for (const domainId of domainIds) {
      if (!(await this.lifeDomainRepository.findById(domainId))) {
        throw new GoalValidationError("关联的生活领域已经不存在了。");
      }
    }
  }

  private async assertHabitsExist(draft: GoalDraft): Promise<void> {
    if (!draft.habitProgress) return;
    if (draft.progressMode !== "automatic") {
      throw new GoalValidationError("习惯型进度不能同时使用探索型设置。");
    }
    const ids = new Set((await this.habitRepository?.list() ?? []).map((habit) => habit.id));
    if (draft.habitProgress.some((setting) => !ids.has(setting.habitId))) {
      throw new GoalValidationError("关联的习惯已不存在，请重新选择。");
    }
  }

  private assertStatusReason(draft: GoalDraft, existing?: Goal): void {
    if ((draft.status === "paused" || draft.status === "abandoned") && !draft.statusReason &&
        !(existing?.status === draft.status && !existing.statusReason)) {
      throw new GoalValidationError("暂停或放弃目标时请填写原因。");
    }
  }

  private assertValidParent(id: string, parentId: string | null, goals: readonly Goal[]): void {
    const byId = new Map(goals.map((goal) => [goal.id, goal]));
    const visited = new Set<string>([id]);
    let current = parentId;
    while (current) {
      if (visited.has(current)) throw new GoalValidationError("上级目标不能形成循环关联。");
      visited.add(current);
      const parent = byId.get(current);
      if (!parent) throw new GoalValidationError("上级目标已不存在。");
      current = parent.parentId;
    }
  }
}
