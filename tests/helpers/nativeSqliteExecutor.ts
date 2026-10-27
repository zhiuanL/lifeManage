import type { DatabaseSync } from "node:sqlite";
import type { SqliteExecutor } from "../../src/repositories/sqlite/SqliteExecutor";

export function nativeSqliteExecutor(db: DatabaseSync): SqliteExecutor {
  return {
    select: async <T>(statement: string, values: unknown[] = []) =>
      db.prepare(statement).all(...(values as (string | number | null)[])) as T[],
    execute: async (statement: string, values: unknown[] = []) => ({
      rowsAffected: Number(db.prepare(statement).run(...(values as (string | number | null)[])).changes),
    }),
    executeTransaction: async (statements) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const { statement, bindValues = [], requireAffectedRows } of statements) {
          const result = db.prepare(statement).run(...(bindValues as (string | number | null)[]));
          if (requireAffectedRows && result.changes === 0) {
            db.exec("ROLLBACK");
            return null;
          }
          results.push({ rowsAffected: Number(result.changes) });
        }
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
