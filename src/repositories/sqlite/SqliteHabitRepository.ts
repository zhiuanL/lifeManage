import type { Habit, HabitLog } from "../../domain/habits/Habit";
import type { HabitRepository } from "../habits/HabitRepository";
import type { SqliteExecutor } from "./SqliteExecutor";

interface HabitRow {
  id: string; title: string; intention: string; weekly_target: number;
  stable_context: string; trigger_condition: string; obstacle: string;
  adjustment: string; start_on: string; archived: number;
  created_at: string; updated_at: string;
}
interface LogRow {
  id: string; habit_id: string; recorded_on: string; completed: number;
  obstacle: string; adjustment: string; created_at: string; updated_at: string;
}
const habitColumns = `id, title, intention, weekly_target, stable_context, trigger_condition,
  obstacle, adjustment, start_on, archived, created_at, updated_at`;

export class SqliteHabitRepository implements HabitRepository {
  constructor(private readonly db: SqliteExecutor) {}

  async list(): Promise<readonly Habit[]> {
    const [rows, links] = await Promise.all([
      this.db.select<HabitRow>(`SELECT ${habitColumns} FROM habits ORDER BY archived, created_at DESC, id DESC`),
      this.db.select<{ habit_id: string; domain_id: string }>(
        "SELECT habit_id, domain_id FROM habit_domain_links ORDER BY habit_id, domain_id"),
    ]);
    return rows.map((row) => ({
      id: row.id, title: row.title, intention: row.intention, weeklyTarget: row.weekly_target,
      stableContext: row.stable_context, triggerCondition: row.trigger_condition,
      obstacle: row.obstacle, adjustment: row.adjustment, startOn: row.start_on,
      archived: row.archived === 1, createdAt: row.created_at, updatedAt: row.updated_at,
      domainIds: links.filter((link) => link.habit_id === row.id).map((link) => link.domain_id),
    }));
  }

  async listLogs(): Promise<readonly HabitLog[]> {
    const rows = await this.db.select<LogRow>(
      `SELECT id, habit_id, recorded_on, completed, obstacle, adjustment, created_at, updated_at
       FROM habit_logs ORDER BY recorded_on DESC, created_at DESC, id DESC`,
    );
    return rows.map((row) => ({
      id: row.id, habitId: row.habit_id, recordedOn: row.recorded_on,
      completed: row.completed === 1, obstacle: row.obstacle, adjustment: row.adjustment,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }));
  }

  async create(habit: Habit): Promise<void> {
    await this.db.executeTransaction([
      {
        statement: `INSERT INTO habits (${habitColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        bindValues: [habit.id, habit.title, habit.intention, habit.weeklyTarget, habit.stableContext,
          habit.triggerCondition, habit.obstacle, habit.adjustment, habit.startOn,
          habit.createdAt, habit.updatedAt],
      },
      ...habit.domainIds.map((domainId) => ({
        statement: "INSERT INTO habit_domain_links (habit_id, domain_id) VALUES (?, ?)",
        bindValues: [habit.id, domainId],
      })),
    ]);
  }

  async update(habit: Habit): Promise<boolean> {
    const results = await this.db.executeTransaction([
      {
        statement: `UPDATE habits SET title = ?, intention = ?, weekly_target = ?, stable_context = ?,
         trigger_condition = ?, obstacle = ?, adjustment = ?, start_on = ?, updated_at = ?
         WHERE id = ?`,
        bindValues: [habit.title, habit.intention, habit.weeklyTarget, habit.stableContext,
          habit.triggerCondition, habit.obstacle, habit.adjustment, habit.startOn,
          habit.updatedAt, habit.id],
        requireAffectedRows: true,
      },
      { statement: "DELETE FROM habit_domain_links WHERE habit_id = ?", bindValues: [habit.id] },
      ...habit.domainIds.map((domainId) => ({
        statement: "INSERT INTO habit_domain_links (habit_id, domain_id) VALUES (?, ?)",
        bindValues: [habit.id, domainId],
      })),
    ]);
    return results !== null;
  }

  async setArchived(id: string, archived: boolean, updatedAt: string): Promise<boolean> {
    const result = await this.db.execute(
      "UPDATE habits SET archived = ?, updated_at = ? WHERE id = ?",
      [archived ? 1 : 0, updatedAt, id],
    );
    return result.rowsAffected === 1;
  }

  async createLog(log: HabitLog): Promise<void> {
    await this.db.execute(
      `INSERT INTO habit_logs (id, habit_id, recorded_on, completed, obstacle, adjustment, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [log.id, log.habitId, log.recordedOn, log.completed ? 1 : 0,
        log.obstacle, log.adjustment, log.createdAt, log.updatedAt],
    );
  }

  async updateLog(log: HabitLog): Promise<boolean> {
    const result = await this.db.execute(
      `UPDATE habit_logs SET completed = ?, obstacle = ?, adjustment = ?, updated_at = ?
       WHERE id = ? AND habit_id = ?`,
      [log.completed ? 1 : 0, log.obstacle, log.adjustment, log.updatedAt, log.id, log.habitId],
    );
    return result.rowsAffected === 1;
  }
}
