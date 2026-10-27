import type { ActionStatus } from "./Action";

export interface ActionStateEvent {
  id: number;
  actionId: string;
  beforeStatus: ActionStatus | null;
  afterStatus: ActionStatus;
  scheduledFor: string | null;
  changedAt: string;
}
