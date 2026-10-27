import { validateIdentityRoleHistorySnapshot } from "../../domain/backup/IdentityRoleBackup";
import type { IdentityRole, IdentityRoleVersion } from "../../domain/life/IdentityRole";
import type { IdentityRoleRepository } from "../life/IdentityRoleRepository";
import type { SqliteExecutor, SqlStatement } from "./SqliteExecutor";

interface RoleRow {
  id: string; name: string; description: string; active: number;
  privacy_level: IdentityRole["privacyLevel"]; archived_at: string | null;
  deleted_at: string | null; created_at: string; updated_at: string; version: number;
}

export class SqliteIdentityRoleRepository implements IdentityRoleRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  private async hydrate(rows: readonly RoleRow[]): Promise<IdentityRole[]> {
    if (!rows.length) return [];
    const placeholders = rows.map(() => "?").join(", ");
    const ids = rows.map(row => row.id);
    const domains = await this.executor.select<{ role_id: string; domain_id: string }>(
      `SELECT role_id, domain_id FROM identity_role_domain_links WHERE role_id IN (${placeholders}) ORDER BY domain_id`, ids);
    const goals = await this.executor.select<{ role_id: string; goal_id: string }>(
      `SELECT role_id, goal_id FROM identity_role_goal_links WHERE role_id IN (${placeholders}) ORDER BY goal_id`, ids);
    return rows.map(row => ({
      id: row.id, name: row.name, description: row.description, active: row.active === 1,
      privacyLevel: row.privacy_level, archivedAt: row.archived_at, deletedAt: row.deleted_at,
      createdAt: row.created_at, updatedAt: row.updated_at, version: row.version,
      domainIds: domains.filter(link => link.role_id === row.id).map(link => link.domain_id),
      goalIds: goals.filter(link => link.role_id === row.id).map(link => link.goal_id),
    }));
  }

  async list(): Promise<readonly IdentityRole[]> {
    return this.hydrate(await this.executor.select<RoleRow>(
      "SELECT * FROM identity_roles WHERE deleted_at IS NULL ORDER BY created_at, id"));
  }

  async findById(id: string): Promise<IdentityRole | null> {
    return (await this.hydrate(await this.executor.select<RoleRow>(
      "SELECT * FROM identity_roles WHERE id = ? AND deleted_at IS NULL", [id])))[0] ?? null;
  }

  async listVersions(id: string): Promise<readonly IdentityRoleVersion[]> {
    const rows = await this.executor.select<{
      role_id: string; version: number; changed_at: string; snapshot_json: string;
    }>(
      `SELECT role_id, version, changed_at, snapshot_json FROM identity_role_versions
       WHERE role_id = ? ORDER BY version DESC`, [id]);
    return rows.map(row => {
      try {
        if (row.role_id !== id || !Number.isFinite(Date.parse(row.changed_at))) throw new Error();
        return { roleId: row.role_id, version: row.version, changedAt: row.changed_at,
          snapshot: validateIdentityRoleHistorySnapshot(JSON.parse(row.snapshot_json), row.version) };
      } catch {
        throw new Error("身份角色历史数据不完整，无法读取。");
      }
    });
  }

  async save(record: IdentityRole, previous: IdentityRole | null): Promise<void> {
    const values = [record.name, record.description, Number(record.active), record.privacyLevel,
      record.archivedAt, record.deletedAt, record.updatedAt, record.version];
    const statements: SqlStatement[] = [previous ? {
      statement: `UPDATE identity_roles SET name = ?, description = ?, active = ?, privacy_level = ?,
        archived_at = ?, deleted_at = ?, updated_at = ?, version = ?
        WHERE id = ? AND version = ? AND deleted_at IS NULL`,
      bindValues: [...values, record.id, previous.version], requireAffectedRows: true,
    } : {
      statement: `INSERT INTO identity_roles (name, description, active, privacy_level,
        archived_at, deleted_at, updated_at, version, id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      bindValues: [...values, record.id, record.createdAt],
    }];
    // Snapshot the old links first, retain archived references, then validate only new links.
    for (const type of ["domain", "goal"] as const) {
      const ids = type === "domain" ? record.domainIds : record.goalIds;
      const oldIds = (type === "domain" ? previous?.domainIds : previous?.goalIds) ?? [];
      statements.push({
        statement: `DELETE FROM identity_role_${type}_links WHERE role_id = ?${ids.length
          ? ` AND ${type}_id NOT IN (${ids.map(() => "?").join(", ")})` : ""}`,
        bindValues: [record.id, ...ids],
      });
      for (const id of ids.filter(id => !oldIds.includes(id))) {
        statements.push({
          statement: `INSERT INTO identity_role_${type}_links (role_id, ${type}_id)
            SELECT ?, id FROM ${type === "domain" ? "life_domains" : "goals"}
            WHERE id = ? AND ${type === "domain" ? "status != 'archived'" : "status != 'archived' AND archived_at IS NULL"}`,
          bindValues: [record.id, id], requireAffectedRows: true,
        });
      }
    }
    if (!await this.executor.executeTransaction(statements)) {
      throw new Error("角色或关联记录已发生变化，请重新打开后重试。");
    }
  }
}
