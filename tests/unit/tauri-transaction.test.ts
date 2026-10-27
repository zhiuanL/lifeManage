import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriSqliteExecutor } from "../../src/repositories/sqlite/TauriSqliteExecutor";
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("desktop SQL transactions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the database and sends the entire write as one command", async () => {
    const execute = vi.fn();
    vi.mocked(Database.load).mockResolvedValue({ execute } as unknown as Database);
    vi.mocked(invoke).mockResolvedValue([{ rowsAffected: 1 }, { rowsAffected: 1 }]);
    const executor = new TauriSqliteExecutor();
    const statements = [
      { statement: "INSERT INTO metric_definitions (id) VALUES (?)", bindValues: ["metric"] },
      { statement: "INSERT INTO metric_domain_links (metric_id, domain_id) VALUES (?, ?)",
        bindValues: ["metric", "health"] },
    ];
    expect(await executor.executeTransaction(statements)).toEqual([
      { rowsAffected: 1 }, { rowsAffected: 1 },
    ]);
    expect(Database.load).toHaveBeenCalledWith("sqlite:lifeos.db");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("execute_transaction", { statements });
    expect(execute).not.toHaveBeenCalled();
  });
});
