import { normalizePersonDates, type LifeEvent, type Person, type PersonDate, type Skill } from "../../domain/records/LifeRecords";
import { parsePersonRelationshipSnapshot } from "../../domain/records/PersonRelationshipHistory";
import type { LifeRecordsRepository } from "../records/LifeRecordsRepository";
import type { SqliteExecutor, SqlStatement } from "./SqliteExecutor";

export type PersonDateRow = { person_id: string; sort_order: number; kind: PersonDate["kind"];
  label: string; happened_on: string };

type PersonRow = { id: string; name: string; relationship_type: string; state: string;
  important_date: string | null; last_contact: string | null; shared_experiences: string;
  notes: string; archived: number; created_at: string; updated_at: string };
type EventRow = { id: string; title: string; happened_on: string; description: string;
  person_id: string | null; goal_id: string | null;
  archived: number; created_at: string; updated_at: string };
type SkillRow = { id: string; name: string; current_level: number; target_level: number;
  learning_path: string; practice: string; reflection: string; goal_id: string | null;
  archived: number; created_at: string; updated_at: string };
type DomainRow = { owner_id: string; domain_id: string };

export class SqliteLifeRecordsRepository implements LifeRecordsRepository {
  constructor(private readonly db: SqliteExecutor) {}

  private async domains(table: string, column: string): Promise<Map<string, string[]>> {
    const rows = await this.db.select<DomainRow>(
      `SELECT ${column} AS owner_id, domain_id FROM ${table} ORDER BY ${column}, domain_id`);
    const map = new Map<string, string[]>();
    for (const row of rows) map.set(row.owner_id, [...(map.get(row.owner_id) ?? []), row.domain_id]);
    return map;
  }

  async listPeople(): Promise<readonly Person[]> {
    const [rows, links, dateRows] = await Promise.all([
      this.db.select<PersonRow>("SELECT * FROM people ORDER BY archived, name, id"),
      this.domains("person_domain_links", "person_id"),
      this.db.select<PersonDateRow>("SELECT * FROM person_dates ORDER BY person_id, sort_order"),
    ]);
    const dates = new Map<string, PersonDate[]>();
    for (const row of dateRows) {
      dates.set(row.person_id, [...(dates.get(row.person_id) ?? []),
        { kind: row.kind, label: row.label, date: row.happened_on }]);
    }
    return rows.map((row) => ({
      id: row.id, name: row.name, relationshipType: row.relationship_type, state: row.state,
      importantDate: row.important_date, lastContact: row.last_contact,
      sharedExperiences: row.shared_experiences, notes: row.notes,
      domainIds: links.get(row.id) ?? [], archived: row.archived === 1,
      createdAt: row.created_at, updatedAt: row.updated_at,
      dates: normalizePersonDates(dates.get(row.id) ?? [], false),
    }));
  }
  async listEvents(): Promise<readonly LifeEvent[]> {
    const [rows, links] = await Promise.all([
      this.db.select<EventRow>("SELECT * FROM life_events ORDER BY happened_on DESC, id DESC"),
      this.domains("event_domain_links", "event_id"),
    ]);
    return rows.map((row) => ({
      id: row.id, title: row.title, happenedOn: row.happened_on,
      description: row.description, personId: row.person_id, goalId: row.goal_id,
      domainIds: links.get(row.id) ?? [], archived: row.archived === 1,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }));
  }
  async listSkills(): Promise<readonly Skill[]> {
    const [rows, links] = await Promise.all([
      this.db.select<SkillRow>("SELECT * FROM skills ORDER BY archived, name, id"),
      this.domains("skill_domain_links", "skill_id"),
    ]);
    return rows.map((row) => ({
      id: row.id, name: row.name, currentLevel: row.current_level,
      targetLevel: row.target_level, learningPath: row.learning_path,
      practice: row.practice, reflection: row.reflection, goalId: row.goal_id,
      domainIds: links.get(row.id) ?? [], archived: row.archived === 1,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }));
  }

  private async save(table: "people" | "life_events" | "skills", linkTable: string,
    linkColumn: string, columns: string[], values: unknown[], item: Person | LifeEvent | Skill,
    create: boolean, additional: readonly SqlStatement[] = [],
    preceding: readonly SqlStatement[] = []): Promise<boolean> {
    const results = await this.db.executeTransaction([
      ...preceding,
      create ? {
        statement: `INSERT INTO ${table} (id, ${columns.join(", ")}, created_at, updated_at)
           VALUES (?, ${columns.map(() => "?").join(", ")}, ?, ?)`,
        bindValues: [item.id, ...values, item.createdAt, item.updatedAt],
      } : {
        statement: `UPDATE ${table} SET ${columns.map((name) => `${name} = ?`).join(", ")},
           updated_at = ? WHERE id = ?`,
        bindValues: [...values, item.updatedAt, item.id],
        requireAffectedRows: true,
      },
      ...create ? [] : [{
        statement: `DELETE FROM ${linkTable} WHERE ${linkColumn} = ?`, bindValues: [item.id],
      }],
      ...item.domainIds.map((domainId) => ({
        statement: `INSERT INTO ${linkTable} (${linkColumn}, domain_id) VALUES (?, ?)`,
        bindValues: [item.id, domainId],
      })),
      ...additional,
    ]);
    return results !== null;
  }
  savePerson(item: Person, create: boolean): Promise<boolean> {
    const dates = item.dates === undefined ? undefined : normalizePersonDates(item.dates, false);
    const after = parsePersonRelationshipSnapshot({ name: item.name, relationshipType: item.relationshipType,
      state: item.state, domainIds: [...item.domainIds].sort() });
    return this.save("people", "person_domain_links", "person_id",
      ["name", "relationship_type", "state", "important_date", "last_contact",
        "shared_experiences", "notes"],
      [item.name, item.relationshipType, item.state, item.importantDate,
        item.lastContact, item.sharedExperiences, item.notes], item, create,
      dates === undefined ? [] : [
        { statement: "DELETE FROM person_dates WHERE person_id = ?", bindValues: [item.id] },
        ...dates.map((date, index) => ({
          statement: `INSERT INTO person_dates (person_id, sort_order, kind, label, happened_on)
            VALUES (?, ?, ?, ?, ?)`,
          bindValues: [item.id, index, date.kind, date.label, date.date],
        })),
      ], create ? [] : [{
        // Capture the persisted before-state under the same transaction as the submitted after-state.
        statement: `INSERT INTO person_relationship_versions (person_id, changed_at, before_json, after_json)
          SELECT p.id, ?, json_object('name', p.name, 'relationshipType', p.relationship_type,
            'state', p.state, 'domainIds', json((SELECT json_group_array(domain_id) FROM
              (SELECT domain_id FROM person_domain_links WHERE person_id = p.id ORDER BY domain_id)))),
            ? FROM people p WHERE p.id = ? AND (p.relationship_type != ? OR p.state != ?)`,
        bindValues: [item.updatedAt, JSON.stringify(after), item.id, item.relationshipType, item.state],
      }]);
  }
  saveEvent(item: LifeEvent, create: boolean): Promise<boolean> {
    return this.save("life_events", "event_domain_links", "event_id",
      ["title", "happened_on", "description", "person_id", "goal_id"],
      [item.title, item.happenedOn, item.description, item.personId, item.goalId], item, create);
  }
  saveSkill(item: Skill, create: boolean): Promise<boolean> {
    return this.save("skills", "skill_domain_links", "skill_id",
      ["name", "current_level", "target_level", "learning_path", "practice", "reflection", "goal_id"],
      [item.name, item.currentLevel, item.targetLevel, item.learningPath,
        item.practice, item.reflection, item.goalId], item, create);
  }
  async setArchived(table: "people" | "life_events" | "skills",
    id: string, archived: boolean, updatedAt: string): Promise<boolean> {
    const result = await this.db.execute(
      `UPDATE ${table} SET archived = ?, updated_at = ? WHERE id = ?`,
      [archived ? 1 : 0, updatedAt, id]);
    return result.rowsAffected === 1;
  }
}
