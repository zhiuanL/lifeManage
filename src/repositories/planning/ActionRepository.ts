import type { Action } from "../../domain/planning/Action";
import type { ActionCompletionPlan, ActionPlanChange, PlanAdjustment } from "../../domain/planning/ActionPlanChange";
import type { ActionStateEvent } from "../../domain/planning/ActionStateEvent";

export interface ActionRepository {
  list(): Promise<readonly Action[]>;
  findById(id: string): Promise<Action | null>;
  create(action: Action): Promise<void>;
  update(action: Action): Promise<void>;
  updatePlan(action: Action, adjustment: PlanAdjustment): Promise<void>;
  listPlanChanges(): Promise<readonly ActionPlanChange[]>;
  listCompletionPlans(): Promise<readonly ActionCompletionPlan[]>;
  listStateEvents(): Promise<readonly ActionStateEvent[]>;
}
