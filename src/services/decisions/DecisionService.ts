import { DecisionValidationError, normalizeDecisionDraft, type Decision, type DecisionDraft } from "../../domain/decisions/Decision";
import type { DecisionRepository } from "../../repositories/decisions/DecisionRepository";
import type { LifeDomainRepository } from "../../repositories/life/LifeDomainRepository";
import type { GoalRepository } from "../../repositories/planning/GoalRepository";
import type { LifeNavigationRepository } from "../../repositories/life/LifeNavigationRepository";
import type { LifeRecordsRepository } from "../../repositories/records/LifeRecordsRepository";
import type { ResourceNeedRepository } from "../../repositories/resources/ResourceNeedRepository";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";

export class DecisionService {
  constructor(
    private readonly repository: DecisionRepository,
    private readonly domains: LifeDomainRepository,
    private readonly goals: GoalRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly navigation?: LifeNavigationRepository,
    private readonly people?: LifeRecordsRepository,
    private readonly resources?: ResourceNeedRepository,
  ) {}

  list(): Promise<readonly Decision[]> { return this.repository.list(); }
  findById(id: string): Promise<Decision | null> { return this.repository.findById(id); }

  create(draft: DecisionDraft): Promise<Decision> { return this.createWithId(this.ids.next(), draft); }

  async createWithId(id: string, draft: DecisionDraft): Promise<Decision> {
    const normalized = normalizeDecisionDraft(draft);
    await this.validateLinks(normalized);
    const now = this.clock.now().toISOString();
    const decision: Decision = { ...normalized, id, createdAt: now, updatedAt: now };
    await this.repository.create(decision);
    return decision;
  }

  async update(id: string, draft: DecisionDraft): Promise<Decision> {
    const previous = await this.repository.findById(id);
    if (!previous) throw new DecisionValidationError("这条决策已经不存在了。");
    const normalized = normalizeDecisionDraft({ ...draft,
      resourceNeedIds: draft.resourceNeedIds ?? previous.resourceNeedIds ?? [],
      personIds: draft.personIds ?? previous.personIds ?? [],
      navigationIds: draft.navigationIds ?? previous.navigationIds ?? [],
    });
    if (previous.importance === "major" && normalized.importance === "ordinary") {
      throw new DecisionValidationError("重大决策档案不能降级，以免遗漏已经记录的背景。");
    }
    await this.validateLinks(normalized, previous);
    const decision: Decision = { ...previous, ...normalized, updatedAt: this.clock.now().toISOString() };
    await this.repository.update(decision);
    return decision;
  }

  private async validateLinks(draft: DecisionDraft, previous?: Decision): Promise<void> {
    const needs = (draft.resourceNeedIds ?? []).length ? await this.resources?.list() ?? [] : [];
    for (const id of draft.resourceNeedIds ?? []) {
      if (!needs.some((need) => need.id === id)) throw new DecisionValidationError("关联的资源需求已经不存在了。");
    }
    const people = (draft.personIds ?? []).length ? await this.people?.listPeople() ?? [] : [];
    for (const id of draft.personIds ?? []) {
      const person = people.find((item) => item.id === id);
      if (!person) throw new DecisionValidationError("关联的人物已经不存在了。");
      if (person.archived && !previous?.personIds?.includes(id)) {
        throw new DecisionValidationError("已归档的人物不能新增引用。");
      }
    }
    for (const id of draft.navigationIds ?? []) {
      const reference = await this.navigation?.findById(id);
      if (!reference) throw new DecisionValidationError("关联的人生导航已经不存在了。");
      if (reference.archivedAt && !previous?.navigationIds?.includes(id)) {
        throw new DecisionValidationError("已归档的人生导航不能新增引用。");
      }
    }
    for (const id of draft.domainIds) {
      if (!(await this.domains.findById(id))) throw new DecisionValidationError("关联的生活领域已经不存在了。");
    }
    if (draft.goalId && !(await this.goals.findById(draft.goalId))) {
      throw new DecisionValidationError("关联的目标已经不存在了。");
    }
  }
}
