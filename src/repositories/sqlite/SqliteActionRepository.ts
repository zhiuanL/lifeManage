import type { Action, ActionStatus } from "../../domain/planning/Action";
import { normalizeActionDetails, parseActionDetails } from "../../domain/planning/ActionDetails";
import type { ActionCompletionPlan, ActionPlanChange, PlanAdjustment, PlanReason } from "../../domain/planning/ActionPlanChange";
import type { ActionStateEvent } from "../../domain/planning/ActionStateEvent";
import type { ActionRepository } from "../planning/ActionRepository";
import type { SqliteExecutor } from "./SqliteExecutor";

interface ActionRow {
  details_json: string;
  id: string;
  title: string;
  notes: string;
  progress_weight: number;
  domain_id: string | null;
  goal_id: string | null;
  status: ActionStatus;
  scheduled_for: string | null;
  sort_order: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

const selectedColumns = `id, title, notes, domain_id, goal_id, status, scheduled_for,
  sort_order, completed_at, created_at, updated_at, progress_weight, details_json`;

interface PlanChangeRow {
  id: number;
  action_id: string;
  before_date: string | null;
  after_date: string | null;
  reason_code: PlanReason | "initial";
  note: string;
  changed_at: string;
  completed_at_at_change: string | null;
  domain_id: string | null;
  goal_id: string | null;
}

export class SqliteActionRepository implements ActionRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async list(): Promise<readonly Action[]> {
    const [rows, links] = await Promise.all([this.executor.select<ActionRow>(
      `SELECT ${selectedColumns}
       FROM actions
       ORDER BY
         CASE status WHEN 'open' THEN 0 ELSE 1 END,
         CASE WHEN scheduled_for IS NULL THEN 1 ELSE 0 END,
         scheduled_for ASC,
         sort_order ASC,
         created_at ASC`,
    ), this.executor.select<{ action_id: string; domain_id: string }>(
      "SELECT action_id, domain_id FROM action_domain_links ORDER BY action_id, domain_id",
    )]);

    const byAction = new Map<string, string[]>();
    for (const link of links) {
      const ids = byAction.get(link.action_id) ?? [];
      ids.push(link.domain_id);
      byAction.set(link.action_id, ids);
    }
    return rows.map((row) => toAction(row, byAction.get(row.id) ?? []));
  }

  async findById(id: string): Promise<Action | null> {
    const rows = await this.executor.select<ActionRow>(
      `SELECT ${selectedColumns}
       FROM actions
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    if (!rows[0]) return null;
    const links = await this.executor.select<{ domain_id: string }>(
      "SELECT domain_id FROM action_domain_links WHERE action_id = ? ORDER BY domain_id", [id],
    );
    return toAction(rows[0], links.map((link) => link.domain_id));
  }

  async create(action: Action): Promise<void> {
    await this.executor.executeTransaction([
      { statement: `INSERT INTO actions (
        id, title, notes, domain_id, goal_id, status, scheduled_for, sort_order,
        completed_at, created_at, updated_at, progress_weight, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, bindValues: [
        action.id,
        action.title,
        action.notes,
        action.domainId,
        action.goalId,
        action.status,
        action.scheduledFor,
        action.sortOrder,
        action.completedAt,
        action.createdAt,
        action.updatedAt,
        action.progressWeight ?? 1,
        JSON.stringify(normalizeActionDetails(action.details)),
      ] },
      ...action.domainIds.map((domainId) => ({
        statement: "INSERT INTO action_domain_links (action_id, domain_id) VALUES (?, ?)",
        bindValues: [action.id, domainId],
      })),
    ]);
  }

  async update(action: Action): Promise<void> {
    await this.write(action);
  }

  private async write(action: Action, adjustment?: PlanAdjustment): Promise<void> {
    const result = await this.executor.executeTransaction([
      // The view trigger reports zero changed rows, so guard existence on its base table.
      { statement: "UPDATE actions SET id = id WHERE id = ?",
        bindValues: [action.id], requireAffectedRows: true },
      { statement: "UPDATE actions SET details_json = ?, updated_at = ? WHERE id = ?",
        bindValues: [JSON.stringify(normalizeActionDetails(action.details)), action.updatedAt, action.id] },
      { statement: `UPDATE action_plan_writes
       SET title = ?, notes = ?, domain_id = ?, goal_id = ?, status = ?,
           scheduled_for = ?, completed_at = ?, updated_at = ?${adjustment
        ? ", reason_code = ?, reason_note = ?" : ""}
       WHERE id = ?`, bindValues: [
        action.title, action.notes, action.domainId, action.goalId, action.status,
        action.scheduledFor, action.completedAt, action.updatedAt,
        ...(adjustment ? [adjustment.reason, adjustment.note] : []), action.id,
      ] },
      { statement: "UPDATE actions SET progress_weight = ? WHERE id = ?",
        bindValues: [action.progressWeight ?? 1, action.id] },
      // The INSTEAD OF UPDATE view trigger reports zero affected rows in SQLite.
      { statement: "DELETE FROM action_domain_links WHERE action_id = ?", bindValues: [action.id] },
      ...action.domainIds.map((domainId) => ({
        statement: "INSERT INTO action_domain_links (action_id, domain_id) VALUES (?, ?)",
        bindValues: [action.id, domainId],
      })),
    ]);
    if (!result) throw new Error("行动已不存在，请重新读取后再试。");
  }

  async updatePlan(action: Action, adjustment: PlanAdjustment): Promise<void> {
    await this.write(action, adjustment);
  }

  async listPlanChanges(): Promise<readonly ActionPlanChange[]> {
    const rows = await this.executor.select<PlanChangeRow>(
      `SELECT id, action_id, before_date, after_date, reason_code, note,
              changed_at, completed_at_at_change, domain_id, goal_id
       FROM action_plan_changes ORDER BY changed_at ASC, id ASC`,
    );
    return rows.map((row) => ({
      id: row.id, actionId: row.action_id, beforeDate: row.before_date,
      afterDate: row.after_date, reason: row.reason_code, note: row.note,
      changedAt: row.changed_at, completedAtAtChange: row.completed_at_at_change,
      domainId: row.domain_id, goalId: row.goal_id,
    }));
  }

  async listCompletionPlans(): Promise<readonly ActionCompletionPlan[]> {
    const rows = await this.executor.select<{
      action_id: string; completed_at: string; planned_date: string | null;
    }>("SELECT action_id, completed_at, planned_date FROM action_completion_plans");
    return rows.map((row) => ({
      actionId: row.action_id, completedAt: row.completed_at, plannedDate: row.planned_date,
    }));
  }

  async listStateEvents(): Promise<readonly ActionStateEvent[]> {
    const rows = await this.executor.select<{
      id: number; action_id: string; before_status: ActionStatus | null;
      after_status: ActionStatus; scheduled_for: string | null; changed_at: string;
    }>(`SELECT id, action_id, before_status, after_status, scheduled_for, changed_at
        FROM action_state_events ORDER BY action_id ASC, changed_at ASC, id ASC`);
    return rows.map((row) => ({
      id: row.id, actionId: row.action_id, beforeStatus: row.before_status,
      afterStatus: row.after_status, scheduledFor: row.scheduled_for, changedAt: row.changed_at,
    }));
  }
}

function toAction(row: ActionRow, linkedIds: readonly string[]): Action {
  const domainIds = row.domain_id
    ? [row.domain_id, ...linkedIds.filter((id) => id !== row.domain_id)]
    : [...linkedIds];
  return {
    id: row.id,
    title: row.title,
    details: parseActionDetails(row.details_json),
    notes: row.notes,
    progressWeight: row.progress_weight,
    domainId: domainIds[0] ?? null,
    domainIds,
    goalId: row.goal_id,
    status: row.status,
    scheduledFor: row.scheduled_for,
    sortOrder: row.sort_order,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
