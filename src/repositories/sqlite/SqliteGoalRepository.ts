import type { GoalRelation, GoalRelationType } from "../../domain/planning/GoalRelation";
import type { GoalHorizon } from "../../domain/planning/GoalHorizon";
import type { GoalPriority } from "../../domain/planning/GoalPriority";
import type { Goal, GoalStatus } from "../../domain/planning/Goal";
import { goalStorageStatus, goalStatusExtension } from "../../domain/planning/GoalLifecycleStorage";
import type { GoalProgressItem } from "../../domain/progress/GoalProgressItem";
import type { GoalProgressMode } from "../../domain/progress/GoalProgressMode";
import type { HabitGoalProgressSetting } from "../../domain/progress/HabitGoalProgress";
import type { GoalRepository } from "../planning/GoalRepository";
import type { SqliteExecutor } from "./SqliteExecutor";

interface GoalRow {
  id: string;
  title: string;
  description: string;
  domain_id: string | null;
  parent_id: string | null;
  status: GoalStatus;
  lifecycle_status: GoalStatus | null;
  status_reason: string | null;
  archived_at: string | null;
  progress_mode: GoalProgressMode;
  progress_weight: number;
  priority: GoalPriority;
  horizon: GoalHorizon | null;
  direction_id: string | null;
  target_date: string | null;
  sort_order: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

const selectedColumns = `id, title, description, domain_id, parent_id, status, target_date,
  sort_order, completed_at, created_at, updated_at, lifecycle_status, status_reason, archived_at, progress_mode, progress_weight, priority, horizon, direction_id`;

export class SqliteGoalRepository implements GoalRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async list(): Promise<readonly Goal[]> {
    const [rows, links] = await Promise.all([this.executor.select<GoalRow>(
      `SELECT ${selectedColumns}
       FROM goals
       ORDER BY
         CASE COALESCE(lifecycle_status, status)
           WHEN 'active' THEN 0 WHEN 'candidate' THEN 1 WHEN 'paused' THEN 2
           WHEN 'completed' THEN 3 WHEN 'abandoned' THEN 4 ELSE 5 END,
         sort_order ASC,
         created_at ASC`,
    ), this.executor.select<{ goal_id: string; domain_id: string }>(
      "SELECT goal_id, domain_id FROM goal_domain_links ORDER BY goal_id, domain_id",
    )]);

    const byGoal = new Map<string, string[]>();
    for (const link of links) {
      const ids = byGoal.get(link.goal_id) ?? [];
      ids.push(link.domain_id);
      byGoal.set(link.goal_id, ids);
    }
    const settings = await this.executor.select<HabitProgressRow>(
      "SELECT goal_id, habit_id, start_on, end_on, weekly_target, weight, sort_order FROM goal_habit_progress ORDER BY goal_id, sort_order",
    );
    const relations = await this.executor.select<RelationRow>("SELECT goal_id, target_goal_id, relation_type FROM goal_relations ORDER BY goal_id, target_goal_id, relation_type");
    return rows.map((row) => toGoal(row, byGoal.get(row.id) ?? [],
      settings.filter((setting) => setting.goal_id === row.id).map(toSetting),
      relations.filter((relation) => relation.goal_id === row.id).map(toRelation)));
  }

  async findById(id: string): Promise<Goal | null> {
    const rows = await this.executor.select<GoalRow>(
      `SELECT ${selectedColumns}
       FROM goals
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    if (!rows[0]) return null;
    const links = await this.executor.select<{ domain_id: string }>(
      "SELECT domain_id FROM goal_domain_links WHERE goal_id = ? ORDER BY domain_id", [id],
    );
    const settings = await this.executor.select<HabitProgressRow>(
      "SELECT goal_id, habit_id, start_on, end_on, weekly_target, weight, sort_order FROM goal_habit_progress WHERE goal_id = ? ORDER BY sort_order", [id],
    );
    const relations = await this.executor.select<RelationRow>("SELECT goal_id, target_goal_id, relation_type FROM goal_relations WHERE goal_id = ? ORDER BY target_goal_id, relation_type", [id]);
    return toGoal(rows[0], links.map((link) => link.domain_id), settings.map(toSetting), relations.map(toRelation));
  }

  async create(goal: Goal, progressItems: readonly GoalProgressItem[] = []): Promise<void> {
    await this.executor.executeTransaction([
      { statement: `INSERT INTO goals (
        id, title, description, domain_id, status, target_date, sort_order,
        parent_id,
        completed_at, created_at, updated_at, lifecycle_status, status_reason, archived_at, progress_mode, progress_weight, priority, horizon, direction_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, bindValues: [
        goal.id,
        goal.title,
        goal.description,
        goal.domainId,
        goalStorageStatus(goal),
        goal.targetDate,
        goal.sortOrder,
        goal.parentId,
        goal.completedAt,
        goal.createdAt,
        goal.updatedAt,
        goalStatusExtension(goal.status),
        goal.statusReason ?? null,
        goal.archivedAt ?? null,
        goal.progressMode ?? "automatic",
        goal.progressWeight ?? 1,
        goal.priority ?? "medium",
        goal.horizon ?? null, goal.directionId ?? null,
      ] },
      ...goal.domainIds.map((domainId) => ({
        statement: "INSERT INTO goal_domain_links (goal_id, domain_id) VALUES (?, ?)",
        bindValues: [goal.id, domainId],
      })),
      ...progressItems.map((item) => ({
        statement: `INSERT INTO goal_progress_items (
          id, goal_id, kind, title, target_value, current_value, weight, sort_order,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        bindValues: [item.id, goal.id, item.kind, item.title, item.targetValue,
          item.currentValue, item.weight, item.sortOrder, item.createdAt, item.updatedAt],
      })),
      ...habitStatements(goal),
      ...relationStatements(goal),
    ]);
  }

  async update(goal: Goal): Promise<void> {
    const result = await this.executor.executeTransaction([
      { statement: `UPDATE goals
       SET title = ?, description = ?, domain_id = ?, status = ?, target_date = ?,
           parent_id = ?,
           completed_at = ?, updated_at = ?, lifecycle_status = ?, status_reason = ?, archived_at = ?, progress_mode = ?, progress_weight = ?, priority = ?, horizon = ?, direction_id = ?
       WHERE id = ?`, bindValues: [
        goal.title,
        goal.description,
        goal.domainId,
        goalStorageStatus(goal),
        goal.targetDate,
        goal.parentId,
        goal.completedAt,
        goal.updatedAt,
        goalStatusExtension(goal.status),
        goal.statusReason ?? null,
        goal.archivedAt ?? null,
        goal.progressMode ?? "automatic",
        goal.progressWeight ?? 1,
        goal.priority ?? "medium",
        goal.horizon ?? null, goal.directionId ?? null,
        goal.id,
      ], requireAffectedRows: true },
      { statement: "DELETE FROM goal_domain_links WHERE goal_id = ?", bindValues: [goal.id] },
      { statement: "DELETE FROM goal_habit_progress WHERE goal_id = ?", bindValues: [goal.id] },
      { statement: "DELETE FROM goal_relations WHERE goal_id = ?", bindValues: [goal.id] },
      ...habitStatements(goal),
      ...relationStatements(goal),
      ...goal.domainIds.map((domainId) => ({
        statement: "INSERT INTO goal_domain_links (goal_id, domain_id) VALUES (?, ?)",
        bindValues: [goal.id, domainId],
      })),
    ]);
    if (!result) throw new Error("目标已不存在，请重新读取后再试。");
  }
}

interface RelationRow { goal_id: string; target_goal_id: string; relation_type: GoalRelationType }
function toRelation(row: RelationRow): GoalRelation {
  return { targetGoalId: row.target_goal_id, type: row.relation_type };
}
function relationStatements(goal: Goal) {
  return (goal.relations ?? []).map((relation) => ({
    statement: "INSERT INTO goal_relations (goal_id, target_goal_id, relation_type) VALUES (?, ?, ?)",
    bindValues: [goal.id, relation.targetGoalId, relation.type],
  }));
}

interface HabitProgressRow {
  goal_id: string; habit_id: string; start_on: string; end_on: string;
  weekly_target: number; weight: number; sort_order: number;
}

function toSetting(row: HabitProgressRow): HabitGoalProgressSetting {
  return { habitId: row.habit_id, startOn: row.start_on, endOn: row.end_on,
    weeklyTarget: row.weekly_target, weight: row.weight };
}

function habitStatements(goal: Goal) {
  return (goal.habitProgress ?? []).map((setting, sortOrder) => ({
    statement: "INSERT INTO goal_habit_progress (goal_id, habit_id, start_on, end_on, weekly_target, weight, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
    bindValues: [goal.id, setting.habitId, setting.startOn, setting.endOn,
      setting.weeklyTarget, setting.weight, sortOrder],
  }));
}

function toGoal(row: GoalRow, linkedIds: readonly string[], habitProgress: HabitGoalProgressSetting[], relations: GoalRelation[]): Goal {
  const domainIds = row.domain_id
    ? [row.domain_id, ...linkedIds.filter((id) => id !== row.domain_id)]
    : [...linkedIds];
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    domainId: domainIds[0] ?? null,
    parentId: row.parent_id,
    domainIds,
    status: row.lifecycle_status ?? row.status,
    statusReason: row.status_reason ?? null,
    archivedAt: row.archived_at ?? null,
    progressMode: row.progress_mode,
    progressWeight: row.progress_weight,
    priority: row.priority,
    horizon: row.horizon ?? null, directionId: row.direction_id ?? null,
    relations,
    habitProgress: habitProgress.length ? habitProgress : null,
    targetDate: row.target_date,
    sortOrder: row.sort_order,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
