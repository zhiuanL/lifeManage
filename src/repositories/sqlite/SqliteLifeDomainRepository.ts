import type { LifeDomain } from "../../domain/life/LifeDomain";
import type { LifeDomainRepository } from "../life/LifeDomainRepository";
import type { SqliteExecutor } from "./SqliteExecutor";
import { recommendedDomainStatements } from "./recommendedDomainStatements";

interface LifeDomainRow {
  id: string;
  name: string;
  description: string;
  focus: string;
  color_key: LifeDomain["color"];
  icon_key: LifeDomain["icon"];
  current_state: string;
  long_term_expectation: string;
  status: LifeDomain["status"];
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const selectedColumns = `id, name, description, focus, color_key, icon_key,
  current_state, long_term_expectation, status,
  sort_order, created_at, updated_at`;

export class SqliteLifeDomainRepository implements LifeDomainRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async list(): Promise<readonly LifeDomain[]> {
    const rows = await this.executor.select<LifeDomainRow>(
      `SELECT ${selectedColumns}
       FROM life_domains
       ORDER BY sort_order ASC, created_at ASC`,
    );

    return rows.map(toLifeDomain);
  }

  async findById(id: string): Promise<LifeDomain | null> {
    const rows = await this.executor.select<LifeDomainRow>(
      `SELECT ${selectedColumns}
       FROM life_domains
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    return rows[0] ? toLifeDomain(rows[0]) : null;
  }

  async create(domain: LifeDomain): Promise<void> {
    await this.executor.execute(
      `INSERT INTO life_domains (
        id, name, description, focus, color_key, icon_key, sort_order, created_at, updated_at,
        current_state, long_term_expectation, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        domain.id,
        domain.name,
        domain.description,
        domain.focus,
        domain.color,
        domain.icon,
        domain.sortOrder,
        domain.createdAt,
        domain.updatedAt,
        domain.currentState,
        domain.longTermExpectation,
        domain.status,
      ],
    );
  }

  async addMissingRecommended(domains: readonly LifeDomain[]): Promise<void> {
    if (domains.length) {
      await this.executor.executeTransaction(recommendedDomainStatements(domains));
    }
  }

  async reorder(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    const result = await this.executor.executeTransaction(ids.map((id, index) => ({
      statement: `UPDATE life_domains SET sort_order = ?
        WHERE id = ? AND (SELECT COUNT(*) FROM life_domains) = ?`,
      bindValues: [index, id, ids.length],
      requireAffectedRows: true,
    })));
    if (result === null) throw new Error("领域列表已变化，请重新读取后调整顺序。");
  }

  async update(domain: LifeDomain): Promise<void> {
    const result = await this.executor.execute(
      `UPDATE life_domains
       SET name = ?, description = ?, focus = ?, color_key = ?, icon_key = ?,
           current_state = ?, long_term_expectation = ?, status = ?, updated_at = ?
       WHERE id = ?`,
      [
        domain.name,
        domain.description,
        domain.focus,
        domain.color,
        domain.icon,
        domain.currentState,
        domain.longTermExpectation,
        domain.status,
        domain.updatedAt,
        domain.id,
      ],
    );
    if (result.rowsAffected !== 1) throw new Error("领域已变化，请重新读取后保存。");
  }
}

function toLifeDomain(row: LifeDomainRow): LifeDomain {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    focus: row.focus,
    color: row.color_key,
    icon: row.icon_key,
    currentState: row.current_state,
    longTermExpectation: row.long_term_expectation,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
