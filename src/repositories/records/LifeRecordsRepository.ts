import type { LifeEvent, Person, Skill } from "../../domain/records/LifeRecords";

export interface LifeRecordsRepository {
  listPeople(): Promise<readonly Person[]>;
  savePerson(item: Person, create: boolean): Promise<boolean>;
  listEvents(): Promise<readonly LifeEvent[]>;
  saveEvent(item: LifeEvent, create: boolean): Promise<boolean>;
  listSkills(): Promise<readonly Skill[]>;
  saveSkill(item: Skill, create: boolean): Promise<boolean>;
  setArchived(table: "people" | "life_events" | "skills",
    id: string, archived: boolean, updatedAt: string): Promise<boolean>;
}
