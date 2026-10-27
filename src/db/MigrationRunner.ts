import type { SqliteExecutor } from "../repositories/sqlite/SqliteExecutor";
import type { Clock } from "../shared/clock";
import type { Migration } from "./migrations/types";
import { v1InboxRecordTargetsMigration } from "./migrations/0046-v1-inbox-record-targets";
import { DatabaseCompatibilityError } from "./DatabaseCompatibilityError";

const createMigrationTableStatement = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
)`;

export interface MigrationRunSummary {
  appliedMigrationIds: readonly string[];
  currentVersion: string;
  isNewDatabase: boolean;
}

export class MigrationRunner {
  constructor(
    private readonly executor: SqliteExecutor,
    private readonly orderedMigrations: readonly Migration[],
    private readonly clock: Clock,
  ) {}

  async run(): Promise<MigrationRunSummary> {
    // Inspect existing tables before creating anything in a database from another LifeOS version.
    const tables = await this.executor.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    );
    const hasMigrationTable = tables.some((table) => table.name === "schema_migrations");
    if (tables.length > 0 && !hasMigrationTable) {
      throw new DatabaseCompatibilityError("legacy");
    }

    if (hasMigrationTable) {
      const columns = await this.executor.select<{ name: string }>(
        "PRAGMA table_info(schema_migrations)",
      );
      if (!["version", "applied_at"].every((name) =>
        columns.some((column) => column.name === name))) {
        throw new DatabaseCompatibilityError("legacy");
      }
    }

    const appliedRows = hasMigrationTable
      ? await this.executor.select<{ version: string }>(
          "SELECT version FROM schema_migrations ORDER BY version",
        )
      : [];
    if (appliedRows.length === 0 && tables.some((table) => table.name !== "schema_migrations")) {
      throw new DatabaseCompatibilityError("legacy");
    }
    const appliedVersions = new Set(appliedRows.map((row) => row.version));
    if (appliedRows.some((row) => !this.orderedMigrations.some((migration) =>
      migration.id === row.version))) {
      throw new DatabaseCompatibilityError("newer");
    }
    if (appliedVersions.has(v1InboxRecordTargetsMigration.id)) {
      const columns = await this.executor.select<{ name: string }>("PRAGMA table_info(inbox_items)");
      if (!columns.some(column => column.name === "privacy_level")) {
        throw new DatabaseCompatibilityError("missing-inbox-privacy");
      }
    }

    await this.executor.execute(createMigrationTableStatement);
    const appliedMigrationIds: string[] = [];

    for (const migration of this.orderedMigrations) {
      if (appliedVersions.has(migration.id)) {
        continue;
      }

      await this.executor.executeTransaction([
        ...migration.statements.map((statement) => ({ statement })),
        {
          statement: "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
          bindValues: [migration.id, this.clock.now().toISOString()],
        },
      ]);
      appliedMigrationIds.push(migration.id);
    }

    const latestMigration = this.orderedMigrations[this.orderedMigrations.length - 1];

    return {
      appliedMigrationIds,
      currentVersion: latestMigration?.id ?? "0000",
      isNewDatabase: tables.length === 0,
    };
  }
}
