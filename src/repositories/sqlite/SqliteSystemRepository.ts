import type { Clock } from "../../shared/clock";
import type { SystemRepository } from "../system/SystemRepository";
import type { SqliteExecutor } from "./SqliteExecutor";
import type { LifeDomain } from "../../domain/life/LifeDomain";
import { recommendedDomainStatements } from "./recommendedDomainStatements";

const initializedAtKey = "m0_initialized_at";
const pendingKey = "m0_recommended_domains_pending";

export class SqliteSystemRepository implements SystemRepository {
  constructor(
    private readonly executor: SqliteExecutor,
    private readonly clock: Clock,
  ) {}

  async getMetadata(key: string): Promise<string | null> {
    const rows = await this.executor.select<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key = ? LIMIT 1",
      [key],
    );

    return rows[0]?.value ?? null;
  }

  async setMetadata(key: string, value: string): Promise<void> {
    await this.executor.execute(
      `INSERT INTO app_metadata (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      [key, value, this.clock.now().toISOString()],
    );
  }

  async completeFirstInitialization(
    initializedAt: string, domains: readonly LifeDomain[],
  ): Promise<void> {
    const results = await this.executor.executeTransaction([
      {
        statement: "INSERT OR IGNORE INTO app_metadata (key, value, updated_at) VALUES (?, ?, ?)",
        bindValues: [initializedAtKey, initializedAt, initializedAt],
        requireAffectedRows: true,
      },
      ...recommendedDomainStatements(domains),
      {
        statement: "INSERT OR IGNORE INTO app_metadata (key, value, updated_at) VALUES (?, ?, ?)",
        bindValues: ["v1_setup_progress", JSON.stringify({ step: 0, completed: false }), initializedAt],
      },
      { statement: "DELETE FROM app_metadata WHERE key = ?", bindValues: [pendingKey] },
    ]);
    if (!results) {
      throw new Error("生活空间已在其他窗口初始化，请重试打开。");
    }
  }
}
