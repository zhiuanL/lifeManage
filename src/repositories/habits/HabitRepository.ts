import type { Habit, HabitLog } from "../../domain/habits/Habit";

export interface HabitRepository {
  list(): Promise<readonly Habit[]>;
  listLogs(): Promise<readonly HabitLog[]>;
  create(habit: Habit): Promise<void>;
  update(habit: Habit): Promise<boolean>;
  setArchived(id: string, archived: boolean, updatedAt: string): Promise<boolean>;
  createLog(log: HabitLog): Promise<void>;
  updateLog(log: HabitLog): Promise<boolean>;
}
