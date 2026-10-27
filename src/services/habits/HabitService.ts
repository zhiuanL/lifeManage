import { HabitValidationError, localDate, normalizeHabit, normalizeLog, type Habit, type HabitDraft,
  type HabitLog } from "../../domain/habits/Habit";
import type { HabitRepository } from "../../repositories/habits/HabitRepository";
import type { LifeDomainRepository } from "../../repositories/life/LifeDomainRepository";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";

export class HabitService {
  constructor(private readonly repository: HabitRepository,
    private readonly domains: LifeDomainRepository,
    private readonly clock: Clock, private readonly ids: IdGenerator) {}

  list(): Promise<readonly Habit[]> { return this.repository.list(); }
  listLogs(): Promise<readonly HabitLog[]> { return this.repository.listLogs(); }

  async create(draft: HabitDraft): Promise<Habit> {
    const normalized = normalizeHabit(draft, localDate(this.clock.now()));
    await this.validateDomains(normalized.domainIds);
    const now = this.clock.now().toISOString();
    const habit = { ...normalized, id: this.ids.next(), archived: false,
      createdAt: now, updatedAt: now };
    await this.repository.create(habit);
    return habit;
  }

  async update(id: string, draft: HabitDraft): Promise<Habit> {
    const previous = (await this.list()).find((item) => item.id === id);
    if (!previous) throw new HabitValidationError("习惯已经不存在，请重新读取后再试。");
    const normalized = normalizeHabit(draft, localDate(this.clock.now()));
    await this.validateDomains(normalized.domainIds);
    if ((await this.listLogs()).some((log) => log.habitId === id && log.recordedOn < normalized.startOn)) {
      throw new HabitValidationError("开始日期不能晚于已经记录的打卡日期。");
    }
    const habit = { ...previous, ...normalized, updatedAt: this.clock.now().toISOString() };
    if (!(await this.repository.update(habit))) throw new HabitValidationError("习惯已经不存在，请重新读取后再试。");
    return habit;
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    if (!(await this.repository.setArchived(id, archived, this.clock.now().toISOString()))) {
      throw new HabitValidationError("习惯已经不存在，请重新读取后再试。");
    }
  }

  async saveLog(habitId: string, date: string, completed: boolean,
    obstacle = "", adjustment = ""): Promise<HabitLog> {
    const habit = (await this.list()).find((item) => item.id === habitId);
    if (!habit) throw new HabitValidationError("习惯已经不存在，请重新读取后再试。");
    if (habit.archived) throw new HabitValidationError("习惯已归档，恢复后才能记录。");
    const normalized = normalizeLog(date, obstacle, adjustment, habit.startOn, localDate(this.clock.now()));
    const previous = (await this.listLogs()).find((log) =>
      log.habitId === habitId && log.recordedOn === date);
    const now = this.clock.now().toISOString();
    const log: HabitLog = {
      ...normalized, completed, habitId,
      id: previous?.id ?? this.ids.next(), createdAt: previous?.createdAt ?? now, updatedAt: now,
    };
    if (previous) {
      if (!(await this.repository.updateLog(log))) throw new HabitValidationError("打卡记录已变化，请刷新后重试。");
    } else await this.repository.createLog(log);
    return log;
  }

  private async validateDomains(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      if (!(await this.domains.findById(id))) throw new HabitValidationError("关联的生活领域已经不存在了。");
    }
  }
}
