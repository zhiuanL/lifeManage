import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { LandscapeContextSection } from "../../src/components/LandscapeContextSection";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { domainSatisfactionBackupTables, inspectBackup, landscapeContextBackupTables } from "../../src/domain/backup/Backup";
import { emptyLandscapeContext, normalizeLandscapeContext, type LandscapeContext } from "../../src/domain/life/LandscapeContext";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteLandscapeContextRepository } from "../../src/repositories/sqlite/SqliteLandscapeContextRepository";
import { LandscapeContextService } from "../../src/services/life/LandscapeContextService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(cleanup);
const timestamp = "2026-10-22T08:00:00.000Z";
const clock = { now: () => new Date(timestamp) };
const input = { lifeState: " 正在恢复\n生活节奏 ", currentStage: "调整期", currentFocus: "留出休息时间", lifeTensions: "工作与休息" };
const saved: LandscapeContext = { ...normalizeLandscapeContext(input), updatedAt: timestamp };
function view(source: LandscapeContextService) {
  return <LifeOSContext.Provider value={{ landscapeContextService: source } as LifeOSContextValue}>
    <LandscapeContextSection />
  </LifeOSContext.Provider>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function open() {
  await waitFor(() => expect((screen.getByRole("button", { name: "编辑生活状态" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "编辑生活状态" }));
}
describe("V1 user-authored landscape context", () => {
  it("keeps fields optional, trims text without interpreting life and rejects excess/invalid values", () => {
    expect(normalizeLandscapeContext(emptyLandscapeContext())).toEqual(emptyLandscapeContext());
    expect(normalizeLandscapeContext(input).lifeState).toBe("正在恢复\n生活节奏");
    expect(() => normalizeLandscapeContext({ ...input, currentStage: "x".repeat(121) })).toThrow("当前阶段");
    expect(() => normalizeLandscapeContext({ ...input, currentFocus: null } as unknown as typeof input)).toThrow("当前重心");
  });
  for (const mode of ["memory", "SQLite"] as const) {
    it(`${mode} persists one optional record, clears without inferred text, and rolls back`, async () => {
      const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
      try {
        const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
        await new MigrationRunner(sql, migrations, clock).run();
        const service = new LandscapeContextService(new SqliteLandscapeContextRepository(sql), clock);
        expect(await service.get()).toBeNull();
        expect(await service.save(input)).toEqual(saved);
        expect(await service.get()).toEqual(saved);
        await sql.execute("BEGIN IMMEDIATE");
        await service.save({ ...input, currentStage: "不应保留" });
        await sql.execute("ROLLBACK");
        expect(await service.get()).toEqual(saved);
        await service.save(emptyLandscapeContext());
        expect(await service.get()).toEqual({ ...emptyLandscapeContext(), updatedAt: timestamp });
        if (db) {
          expect(db.prepare("SELECT * FROM landscape_context").all()).toHaveLength(1);
          expect(() => db.prepare("INSERT INTO landscape_context VALUES ('other', '', '', '', '', ?)").run(timestamp)).toThrow();
        }
      } finally { db?.close(); }
    });
  }
  it("upgrades 51 without rewriting facts, rolls back failed migration, and validates exact 52/legacy backups", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, 51), clock).run();
      db.prepare("INSERT INTO app_metadata VALUES (?, ?, ?)").run("untouched", "原始事实", timestamp);
      const before = Object.fromEntries(domainSatisfactionBackupTables.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
      const migration = migrations[51];
      await expect(new MigrationRunner(sql, [...migrations.slice(0, 51), { ...migration,
        statements: [...migration.statements, "CREATE TABLE life_domains (id TEXT)"] }], clock).run()).rejects.toThrow();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='landscape_context'").all()).toEqual([]);
      await new MigrationRunner(sql, migrations, clock).run();
      for (const table of domainSatisfactionBackupTables) expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual(before[table]);
      const repository = new SqliteLandscapeContextRepository(sql);
      expect(await repository.get()).toBeNull();
      await repository.save(saved);
      const data = Object.fromEntries(landscapeContextBackupTables.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
      const backup = { format: "lifeos-backup", schemaVersion: 52, appVersion: "test", exportedAt: timestamp, data };
      expect(inspectBackup(backup).counts.landscape_context).toBe(1);
      expect(inspectBackup({ ...backup, schemaVersion: 51, data: before }).counts.landscape_context).toBe(0);
      expect(() => inspectBackup({ ...backup, schemaVersion: 51 })).toThrow();
      const row = data.landscape_context[0];
      for (const patch of [{ id: "other" }, { updated_at: "invalid" }, { life_state: null },
        { current_focus: 0 }, { current_stage: "x".repeat(121) }, { extra: "" }]) {
        expect(() => inspectBackup({ ...backup, data: { ...data, landscape_context: [{ ...row, ...patch }] } })).toThrow();
      }
      expect(() => inspectBackup({ ...backup, data: { ...data, landscape_context: [row, row] } })).toThrow();
      expect((await new MigrationRunner(sql, migrations, clock).run()).appliedMigrationIds).toEqual([]);
    } finally { db.close(); }
  });
  it("retains authored text after closing and reopening an isolated local database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lifeos-landscape-context-"));
    const path = join(dir, "test.sqlite");
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(path);
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations, clock).run();
      await new LandscapeContextService(new SqliteLandscapeContextRepository(sql), clock).save(input);
      db.close();
      db = undefined;
      db = new DatabaseSync(path);
      expect(await new SqliteLandscapeContextRepository(nativeSqliteExecutor(db)).get()).toEqual(saved);
    } finally {
      db?.close();
      unlinkSync(path);
      rmdirSync(dir);
    }
  });
  it("saves from the Chinese inline section, consumes committed result without rereading, and cancels changes", async () => {
    const source = { get: vi.fn().mockResolvedValue(null), save: vi.fn().mockResolvedValue(saved) } as unknown as LandscapeContextService;
    render(view(source));
    await open();
    fireEvent.change(screen.getByRole("textbox", { name: "整体生活状态" }), { target: { value: input.lifeState } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
    expect(screen.getByText(saved.currentStage)).toBeTruthy();
    expect(source.get).toHaveBeenCalledOnce();
    await open();
    fireEvent.change(screen.getByRole("textbox", { name: "当前阶段" }), { target: { value: "不要保存" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(source.save).toHaveBeenCalledOnce();
    expect(screen.queryByText("不要保存")).toBeNull();
  });
  it("locks saves, protects fields/cancel and preserves drafts with Chinese failure", async () => {
    const pending = deferred<LandscapeContext>();
    const source = { get: vi.fn().mockResolvedValue(saved), save: vi.fn().mockReturnValue(pending.promise) } as unknown as LandscapeContextService;
    render(view(source));
    await open();
    fireEvent.change(screen.getByRole("textbox", { name: "当前阶段" }), { target: { value: "保留草稿" } });
    fireEvent.submit(screen.getByRole("form"));
    fireEvent.submit(screen.getByRole("form"));
    expect(source.save).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("textbox", { name: "当前阶段" }).closest("fieldset")?.disabled).toBe(true);
    await act(async () => pending.reject(new Error("SQLITE_BUSY private path")));
    expect(screen.getByRole("alert").textContent).toContain("输入已保留");
    expect(screen.queryByText(/SQLITE_BUSY/)).toBeNull();
    expect((screen.getByRole("textbox", { name: "当前阶段" }) as HTMLInputElement).value).toBe("保留草稿");
    vi.mocked(source.save).mockResolvedValueOnce(saved);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
  });
  it("isolates replacement reads and writes an existing draft only to its original source", async () => {
    const nextRead = deferred<LandscapeContext | null>();
    const original = { get: vi.fn().mockResolvedValue(saved), save: vi.fn().mockRejectedValueOnce(new Error("failed")).mockResolvedValue(saved) } as unknown as LandscapeContextService;
    const replacement = { get: vi.fn().mockReturnValue(nextRead.promise), save: vi.fn() } as unknown as LandscapeContextService;
    const rendered = render(view(original));
    await open();
    fireEvent.change(screen.getByRole("textbox", { name: "当前阶段" }), { target: { value: "原来源草稿" } });
    rendered.rerender(view(replacement));
    expect(screen.getByRole("status").textContent).toContain("正在读取");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("alert");
    await act(async () => nextRead.resolve({ ...saved, currentStage: "新来源阶段" }));
    expect((screen.getByRole("textbox", { name: "当前阶段" }) as HTMLInputElement).value).toBe("原来源草稿");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
    expect(original.save).toHaveBeenCalledTimes(2);
    expect(replacement.save).not.toHaveBeenCalled();
    expect(screen.getByText("新来源阶段")).toBeTruthy();
    expect(screen.queryByText("原来源草稿")).toBeNull();
  });
  it("does not render a late read from an old source and recovers read errors explicitly", async () => {
    const late = deferred<LandscapeContext | null>();
    const old = { get: vi.fn().mockReturnValue(late.promise) } as unknown as LandscapeContextService;
    const source = { get: vi.fn().mockRejectedValueOnce(new Error("private")).mockResolvedValue(null) } as unknown as LandscapeContextService;
    const rendered = render(view(old));
    rendered.rerender(view(source));
    expect((await screen.findByRole("alert")).textContent).toContain("读取失败");
    await act(async () => late.resolve(saved));
    expect(screen.queryByText(saved.currentStage)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await open();
    expect((screen.getByRole("textbox", { name: "整体生活状态" }) as HTMLTextAreaElement).value).toBe("");
  });
});
