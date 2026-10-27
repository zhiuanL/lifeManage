import type { GoalProgressItem, ProgressItemKind } from "../../domain/progress/GoalProgressItem";
import type { GoalProgressItemRepository } from "../planning/GoalProgressItemRepository";
import type { SqliteExecutor } from "./SqliteExecutor";

interface Row {
  id: string;
  goal_id: string;
  kind: ProgressItemKind;
  title: string;
  target_value: number;
  current_value: number;
  weight: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export class SqliteGoalProgressItemRepository implements GoalProgressItemRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async list(): Promise<readonly GoalProgressItem[]> {
    const rows = await this.executor.select<Row>(
      "SELECT * FROM goal_progress_items ORDER BY goal_id, sort_order, id",
    );
    return rows.map((row) => ({
      id: row.id, goalId: row.goal_id, kind: row.kind, title: row.title,
      targetValue: row.target_value, currentValue: row.current_value,
      weight: row.weight, sortOrder: row.sort_order,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }));
  }

  async replace(goalId: string, items: readonly GoalProgressItem[], updatedAt: string): Promise<void> {
    const result = await this.executor.executeTransaction([
      { statement: `INSERT INTO object_versions (object_type, object_id, changed_at, snapshot_json)
        SELECT 'goal', g.id, ?, json_object(
          'title', g.title, 'description', g.description, 'domain_id', g.domain_id,
          'status', COALESCE(g.lifecycle_status, g.status),
          'status_reason', g.status_reason, 'archived_at', g.archived_at,
          'relations', (SELECT json_group_array(json_object('target_goal_id', target_goal_id, 'relation_type', relation_type)) FROM (SELECT * FROM goal_relations WHERE goal_id = g.id ORDER BY target_goal_id, relation_type)),
          'priority', g.priority, 'progress_mode', g.progress_mode, 'progress_weight', g.progress_weight,
          'habit_progress', (SELECT json_group_array(json_object(
            'habit_id', habit_id, 'start_on', start_on, 'end_on', end_on,
            'weekly_target', weekly_target, 'weight', weight, 'sort_order', sort_order
          )) FROM (SELECT * FROM goal_habit_progress WHERE goal_id = g.id ORDER BY sort_order)),
          'target_date', g.target_date, 'sort_order', g.sort_order,
          'completed_at', g.completed_at, 'created_at', g.created_at,
          'updated_at', g.updated_at, 'privacy_level', g.privacy_level,
          'parent_id', g.parent_id,
          'domain_ids', (SELECT json_group_array(domain_id) FROM goal_domain_links
            WHERE goal_id = g.id),
          'progress_items', (SELECT json_group_array(json_object(
            'id', id, 'kind', kind, 'title', title, 'target_value', target_value,
            'current_value', current_value, 'weight', weight, 'sort_order', sort_order
          )) FROM goal_progress_items WHERE goal_id = g.id)
        ) FROM goals g WHERE g.id = ?`, bindValues: [updatedAt, goalId],
        requireAffectedRows: true },
      { statement: "UPDATE goals SET updated_at = ? WHERE id = ?", bindValues: [updatedAt, goalId],
        requireAffectedRows: true },
      { statement: "DELETE FROM goal_progress_items WHERE goal_id = ?", bindValues: [goalId] },
      ...items.map((item) => ({
        statement: `INSERT INTO goal_progress_items
          (id, goal_id, kind, title, target_value, current_value, weight, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        bindValues: [item.id, goalId, item.kind, item.title, item.targetValue,
          item.currentValue, item.weight, item.sortOrder, item.createdAt, item.updatedAt],
      })),
    ]);
    if (!result) throw new Error("目标已不存在，请重新读取后再试。");
  }
}
