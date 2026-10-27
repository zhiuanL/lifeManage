import {
  ActionValidationError,
  normalizeActionDraft,
  type Action,
  type ActionDraft,
} from "../../domain/planning/Action";
import type { ActionStateEvent } from "../../domain/planning/ActionStateEvent";
import { normalizePlanAdjustment, type ActionCompletionPlan, type ActionPlanChange, type PlanAdjustment } from
  "../../domain/planning/ActionPlanChange";
import type { LifeDomainRepository } from "../../repositories/life/LifeDomainRepository";
import type { ActionRepository } from "../../repositories/planning/ActionRepository";
import type { GoalRepository } from "../../repositories/planning/GoalRepository";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";

export class ActionService {
  constructor(
    private readonly repository: ActionRepository,
    private readonly goalRepository: GoalRepository,
    private readonly lifeDomainRepository: LifeDomainRepository,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  list(): Promise<readonly Action[]> {
    return this.repository.list();
  }

  findById(id: string): Promise<Action | null> {
    return this.repository.findById(id);
  }

  listPlanChanges(): Promise<readonly ActionPlanChange[]> {
    return this.repository.listPlanChanges();
  }

  listCompletionPlans(): Promise<readonly ActionCompletionPlan[]> {
    return this.repository.listCompletionPlans();
  }

  listStateEvents(): Promise<readonly ActionStateEvent[]> {
    return this.repository.listStateEvents();
  }

  async create(draft: ActionDraft): Promise<Action> {
    return this.createWithId(this.idGenerator.next(), draft);
  }

  async createWithId(id: string, draft: ActionDraft): Promise<Action> {
    const normalizedDraft = normalizeActionDraft(draft);
    await this.assertReferencesExist(normalizedDraft);
    const existingActions = await this.repository.list();
    const timestamp = this.clock.now().toISOString();
    const action: Action = {
      id,
      ...normalizedDraft,
      status: "open",
      sortOrder: existingActions.length,
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.create(action);
    return action;
  }

  async update(id: string, draft: ActionDraft, adjustment?: PlanAdjustment): Promise<Action> {
    const existingAction = await this.repository.findById(id);

    if (!existingAction) {
      throw new ActionValidationError("这个行动已经不存在了。");
    }

    const normalizedDraft = normalizeActionDraft({ ...draft,
      details: draft.details === undefined ? existingAction.details : draft.details,
      progressWeight: draft.progressWeight === undefined ? existingAction.progressWeight : draft.progressWeight,
    });
    const planAdjustment = existingAction.scheduledFor !== normalizedDraft.scheduledFor
      ? normalizePlanAdjustment(adjustment) : null;
    await this.assertReferencesExist(normalizedDraft);
    const action: Action = {
      ...existingAction,
      ...normalizedDraft,
      updatedAt: this.clock.now().toISOString(),
    };

    if (planAdjustment) await this.repository.updatePlan(action, planAdjustment);
    else await this.repository.update(action);
    return action;
  }

  async toggleCompletion(id: string): Promise<Action> {
    const existingAction = await this.repository.findById(id);

    if (!existingAction) {
      throw new ActionValidationError("这个行动已经不存在了。");
    }

    const timestamp = this.clock.now().toISOString();
    const isCompleting = existingAction.status === "open";
    const action: Action = {
      ...existingAction,
      status: isCompleting ? "completed" : "open",
      completedAt: isCompleting ? timestamp : null,
      updatedAt: timestamp,
    };

    await this.repository.update(action);
    return action;
  }

  private async assertReferencesExist(draft: ActionDraft): Promise<void> {
    if (draft.goalId && !(await this.goalRepository.findById(draft.goalId))) {
      throw new ActionValidationError("关联的目标已经不存在了。");
    }

    for (const domainId of draft.domainIds ?? (draft.domainId ? [draft.domainId] : [])) {
      if (!(await this.lifeDomainRepository.findById(domainId))) {
        throw new ActionValidationError("关联的生活领域已经不存在了。");
      }
    }
  }
}
