import type { InboxItem, InboxSource, InboxStatus, InboxTarget } from "../../domain/inbox/InboxItem";
import type { InboxRepository } from "../inbox/InboxRepository";
import type { SqliteExecutor } from "./SqliteExecutor";

interface InboxRow {
  id: string;
  content: string;
  source: InboxSource;
  status: InboxStatus;
  target_type: InboxTarget | null;
  target_id: string | null;
  created_at: string;
  updated_at: string;
}

const columns = "id, content, source, status, target_type, target_id, created_at, updated_at";

export class SqliteInboxRepository implements InboxRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async list(): Promise<readonly InboxItem[]> {
    const rows = await this.executor.select<InboxRow>(
      `SELECT ${columns} FROM inbox_items ORDER BY created_at DESC, id DESC`,
    );
    return rows.map(toInboxItem);
  }

  async findById(id: string): Promise<InboxItem | null> {
    const rows = await this.executor.select<InboxRow>(
      `SELECT ${columns} FROM inbox_items WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ? toInboxItem(rows[0]) : null;
  }

  async create(item: InboxItem): Promise<void> {
    await this.executor.execute(
      `INSERT INTO inbox_items
       (id, content, source, status, target_type, target_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.id, item.content, item.source, item.status, item.targetType, item.targetId,
        item.createdAt, item.updatedAt],
    );
  }

  async changeStatus(id: string, from: InboxStatus, to: InboxStatus, updatedAt: string): Promise<boolean> {
    const result = await this.executor.execute(
      `UPDATE inbox_items SET status = ?, updated_at = ?
       WHERE id = ? AND status = ?`,
      [to, updatedAt, id, from],
    );
    return result.rowsAffected === 1;
  }

  async reserve(id: string, target: InboxTarget, targetId: string, updatedAt: string): Promise<boolean> {
    const result = await this.executor.execute(
      `UPDATE inbox_items SET status = 'processing', target_type = ?, target_id = ?, updated_at = ?
       WHERE id = ? AND status = 'unprocessed'`,
      [target, targetId, updatedAt, id],
    );
    return result.rowsAffected === 1;
  }

  async finish(id: string, target: InboxTarget, targetId: string, updatedAt: string): Promise<boolean> {
    const result = await this.executor.execute(
      `UPDATE inbox_items SET status = 'organized', updated_at = ?
       WHERE id = ? AND status = 'processing' AND target_type = ? AND target_id = ?`,
      [updatedAt, id, target, targetId],
    );
    return result.rowsAffected === 1;
  }
}

function toInboxItem(row: InboxRow): InboxItem {
  return {
    id: row.id,
    content: row.content,
    source: row.source,
    status: row.status,
    targetType: row.target_type,
    targetId: row.target_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
