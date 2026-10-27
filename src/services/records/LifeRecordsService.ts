import { LifeRecordValidationError, normalizeEvent, normalizePerson, normalizeSkill,
  type LifeEvent, type LifeEventDraft, type Person, type PersonDraft,
  type Skill, type SkillDraft } from "../../domain/records/LifeRecords";
import type { LifeRecordsRepository } from "../../repositories/records/LifeRecordsRepository";
import type { LifeDomainRepository } from "../../repositories/life/LifeDomainRepository";
import type { GoalRepository } from "../../repositories/planning/GoalRepository";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";

export class LifeRecordsService {
  constructor(private readonly repo: LifeRecordsRepository,
    private readonly domains: LifeDomainRepository, private readonly goals: GoalRepository,
    private readonly clock: Clock, private readonly ids: IdGenerator) {}

  listPeople(): Promise<readonly Person[]> { return this.repo.listPeople(); }
  listEvents(): Promise<readonly LifeEvent[]> { return this.repo.listEvents(); }
  listSkills(): Promise<readonly Skill[]> { return this.repo.listSkills(); }

  async createPersonWithId(id: string, draft: PersonDraft): Promise<Person> {
    if (!id.trim()) throw new LifeRecordValidationError("人物标识不能为空。");
    const normalized = normalizePerson(draft);
    await this.check(normalized.domainIds);
    const now = this.clock.now().toISOString();
    const person: Person = { ...normalized, id, archived: false, createdAt: now, updatedAt: now };
    if (!(await this.repo.savePerson(person, true))) throw new Error("保存人物失败，请刷新后重试。");
    return person;
  }

  async createEventWithId(id: string, draft: LifeEventDraft): Promise<LifeEvent> {
    if (!id.trim()) throw new LifeRecordValidationError("事件标识不能为空。");
    const normalized = normalizeEvent(draft);
    await this.check(normalized.domainIds, normalized.goalId, normalized.personId);
    const now = this.clock.now().toISOString();
    const event: LifeEvent = { ...normalized, id, archived: false, createdAt: now, updatedAt: now };
    if (!(await this.repo.saveEvent(event, true))) throw new Error("保存事件失败，请刷新后重试。");
    return event;
  }

  private async check(domainIds: readonly string[], goalId?: string | null,
    personId?: string | null): Promise<void> {
    for (const id of domainIds) {
      if (!(await this.domains.findById(id))) throw new LifeRecordValidationError("关联的生活领域已不存在。");
    }
    if (goalId && !(await this.goals.findById(goalId))) throw new LifeRecordValidationError("关联的目标已不存在。");
    if (personId && !(await this.listPeople()).some((item) => item.id === personId)) {
      throw new LifeRecordValidationError("关联的人物已不存在。");
    }
  }

  async savePerson(draft: PersonDraft, id?: string): Promise<Person> {
    const previous = id ? (await this.listPeople()).find((item) => item.id === id) : undefined;
    if (id && !previous) throw new LifeRecordValidationError("人物已不存在，请刷新后重试。");
    const normalized = normalizePerson({ ...draft, dates: draft.dates ?? previous?.dates ?? [] });
    await this.check(normalized.domainIds);
    const now = this.clock.now().toISOString();
    const person: Person = { ...normalized, id: previous?.id ?? this.ids.next(),
      archived: previous?.archived ?? false, createdAt: previous?.createdAt ?? now, updatedAt: now };
    if (!(await this.repo.savePerson(person, !previous))) throw new Error("保存人物失败，请刷新后重试。");
    return person;
  }
  async saveEvent(draft: LifeEventDraft, id?: string): Promise<LifeEvent> {
    const normalized = normalizeEvent(draft);
    await this.check(normalized.domainIds, normalized.goalId, normalized.personId);
    const previous = id ? (await this.listEvents()).find((item) => item.id === id) : undefined;
    if (id && !previous) throw new LifeRecordValidationError("事件已不存在，请刷新后重试。");
    const now = this.clock.now().toISOString();
    const event: LifeEvent = { ...normalized, id: previous?.id ?? this.ids.next(),
      archived: previous?.archived ?? false, createdAt: previous?.createdAt ?? now, updatedAt: now };
    if (!(await this.repo.saveEvent(event, !previous))) throw new Error("保存事件失败，请刷新后重试。");
    return event;
  }
  async saveSkill(draft: SkillDraft, id?: string): Promise<Skill> {
    const normalized = normalizeSkill(draft);
    await this.check(normalized.domainIds, normalized.goalId);
    const previous = id ? (await this.listSkills()).find((item) => item.id === id) : undefined;
    if (id && !previous) throw new LifeRecordValidationError("能力已不存在，请刷新后重试。");
    const now = this.clock.now().toISOString();
    const skill: Skill = { ...normalized, id: previous?.id ?? this.ids.next(),
      archived: previous?.archived ?? false, createdAt: previous?.createdAt ?? now, updatedAt: now };
    if (!(await this.repo.saveSkill(skill, !previous))) throw new Error("保存能力失败，请刷新后重试。");
    return skill;
  }
  async setArchived(table: "people" | "life_events" | "skills", id: string,
    archived: boolean): Promise<void> {
    if (!(await this.repo.setArchived(table, id, archived, this.clock.now().toISOString()))) {
      throw new LifeRecordValidationError("记录已不存在，请刷新后重试。");
    }
  }
}
