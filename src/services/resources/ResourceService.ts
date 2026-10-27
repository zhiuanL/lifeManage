import { normalizeNeed, ResourceValidationError, type ResourceNeed, type ResourceNeedDraft } from "../../domain/resources/Resources";
import type { GoalService } from "../planning/GoalService";
import type { LifeRecordsService } from "../records/LifeRecordsService";
import type { ResourceNeedRepository } from "../../repositories/resources/ResourceNeedRepository";
import type { DecisionRepository } from "../../repositories/decisions/DecisionRepository";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";

export class ResourceService {
  constructor(private readonly repository: ResourceNeedRepository, private readonly goals: GoalService,
    private readonly records: LifeRecordsService, private readonly clock: Clock,
    private readonly ids: IdGenerator, private readonly decisions?: DecisionRepository) {}
  list(): Promise<readonly ResourceNeed[]> { return this.repository.list(); }
  async save(draft: ResourceNeedDraft, id?: string): Promise<ResourceNeed> {
    const normalized = normalizeNeed(draft);
    if (normalized.goalId && !(await this.goals.findById(normalized.goalId))) throw new ResourceValidationError("关联目标已不存在。");
    const previous = id ? (await this.list()).find((need) => need.id === id) : undefined;
    if (id && !previous) throw new ResourceValidationError("资源需求已不存在，请刷新后重试。");
    if (normalized.decisionId && !(await this.decisions?.findById(normalized.decisionId))) {
      throw new ResourceValidationError("关联决策已不存在。");
    }
    if (previous && (previous.goalId !== normalized.goalId ||
        (previous.decisionId ?? null) !== (normalized.decisionId ?? null))) {
      throw new ResourceValidationError("资源需求归属不能更改，请为新的目标或决策另行记录。");
    }
    if (normalized.skillId) {
      const skill = (await this.records.listSkills()).find((item) => item.id === normalized.skillId);
      if (!skill) throw new ResourceValidationError("关联能力已不存在。");
      if (skill.archived && previous?.skillId !== skill.id) throw new ResourceValidationError("已归档能力不能新增引用。");
    }
    if (normalized.personId) {
      const person = (await this.records.listPeople()).find((item) => item.id === normalized.personId);
      if (!person) throw new ResourceValidationError("关联人物已不存在。");
      if (person.archived && previous?.personId !== person.id) throw new ResourceValidationError("已归档人物不能新增引用。");
    }
    const now = this.clock.now().toISOString();
    const item: ResourceNeed = { ...normalized, id: previous?.id ?? this.ids.next(),
      createdAt: previous?.createdAt ?? now, updatedAt: now };
    const saved = await this.repository.save(item, !previous);
    if (!saved) throw new Error("资源需求保存失败，请刷新后重试。");
    return item;
  }
}
