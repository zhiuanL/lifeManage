import {
  privacyTypes, privacyLevels, type PrivacyRecordType, type PrivacyLevel,
} from "../../domain/export/ContextExport";
import type { PrivacyRepository } from "../export/PrivacyRepository";
import type { SqliteExecutor } from "./SqliteExecutor";

const tables: Record<PrivacyRecordType, string> = {
  domain: "life_domains", goal: "goals", action: "actions", review: "reviews",
  inbox: "inbox_items", issue: "issues", decision: "decisions",
  skill: "skills", resource: "resource_needs", person: "people", metric: "metric_definitions", navigation: "life_navigation",
  habit: "habits",
  event: "life_events",
};

export class SqlitePrivacyRepository implements PrivacyRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async list(): Promise<ReadonlyMap<string, PrivacyLevel>> {
    const result = new Map<string, PrivacyLevel>();
    for (const type of privacyTypes) {
      const rows = await this.executor.select<{ id: string; privacy_level: PrivacyLevel }>(
        `SELECT id, privacy_level FROM ${tables[type]}`,
      );
      for (const row of rows) result.set(`${type}:${row.id}`,
        privacyLevels.includes(row.privacy_level) ? row.privacy_level : "highly_sensitive");
    }
    return result;
  }

  async set(type: PrivacyRecordType, id: string, level: PrivacyLevel): Promise<boolean> {
    const result = await this.executor.execute(
      `UPDATE ${tables[type]} SET privacy_level = ? WHERE id = ?`, [level, id],
    );
    return result.rowsAffected === 1;
  }
}
