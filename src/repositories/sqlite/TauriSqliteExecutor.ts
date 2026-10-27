import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import type { SqlExecutionResult, SqliteExecutor, SqlStatement } from "./SqliteExecutor";

const databaseUrl = "sqlite:lifeos.db";

export class TauriSqliteExecutor implements SqliteExecutor {
  private readonly database = Database.load(databaseUrl);

  async select<T>(statement: string, bindValues: unknown[] = []): Promise<T[]> {
    return (await this.database).select<T[]>(statement, bindValues);
  }

  async execute(
    statement: string,
    bindValues: unknown[] = [],
  ): Promise<SqlExecutionResult> {
    const result = await (await this.database).execute(statement, bindValues);

    return {
      rowsAffected: result.rowsAffected,
      lastInsertId: result.lastInsertId,
    };
  }

  async executeTransaction(statements: readonly SqlStatement[]): Promise<readonly SqlExecutionResult[] | null> {
    await this.database;
    return invoke<SqlExecutionResult[] | null>("execute_transaction", { statements });
  }
}
