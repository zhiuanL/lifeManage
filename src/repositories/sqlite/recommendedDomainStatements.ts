import type { LifeDomain } from "../../domain/life/LifeDomain";
import type { SqlStatement } from "./SqliteExecutor";

export function recommendedDomainStatements(domains: readonly LifeDomain[]): SqlStatement[] {
  return domains.map((domain) => ({
    statement: `INSERT INTO life_domains (
      id, name, description, focus, color_key, icon_key, sort_order, created_at, updated_at,
      current_state, long_term_expectation, status
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM life_domains WHERE name = ?)`,
    bindValues: [
      domain.id, domain.name, domain.description, domain.focus, domain.color, domain.icon,
      domain.sortOrder, domain.createdAt, domain.updatedAt, domain.currentState,
      domain.longTermExpectation, domain.status, domain.name,
    ],
  }));
}
