export interface SqlExecutionResult {
  rowsAffected: number;
  lastInsertId?: number;
}

export interface SqlStatement {
  statement: string;
  bindValues?: unknown[];
  requireAffectedRows?: boolean;
}

export interface SqliteExecutor {
  select<T>(statement: string, bindValues?: unknown[]): Promise<T[]>;
  execute(statement: string, bindValues?: unknown[]): Promise<SqlExecutionResult>;
  // All statements run on one connection. A guarded zero-row write rolls back and returns null.
  executeTransaction(statements: readonly SqlStatement[]): Promise<readonly SqlExecutionResult[] | null>;
}
