import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { DomainMetricsSection } from "../../src/components/DomainMetricsSection";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { domainSatisfactionBackupTables, inspectBackup, personRelationshipBackupTables } from "../../src/domain/backup/Backup";
import { domainSatisfaction } from "../../src/domain/life/DomainSatisfaction";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteDomainMetricRepository } from "../../src/repositories/sqlite/SqliteDomainMetricRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import type { SqliteExecutor } from "../../src/repositories/sqlite/SqliteExecutor";
import { DomainMetricService } from "../../src/services/life/DomainMetricService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(cleanup);
const timestamp = "2026-10-22T08:00:00.000Z";
const clock = { now: () => new Date(timestamp) };
async function setup(sql: SqliteExecutor) {
  let next = 0;
  const ids = { next: () => `satisfaction-${++next}` };
  const domains = new SqliteLifeDomainRepository(sql);
  const domainService = new LifeDomainService(domains, clock, ids);
  const repository = new SqliteDomainMetricRepository(sql);
  const service = new DomainMetricService(repository, domains, clock, ids);
  const domain = await domainService.create({
    name: "健康", description: "", focus: "", color: "fern", icon: "heart",
  });
  const other = await domainService.create({
    name: "成长", description: "", focus: "", color: "ocean", icon: "book-open",
  });
  const metric = await service.createDefinition("自主评分", "自定单位", [domain.id, other.id]);
  return { domainService, domain, other, metric, repository, service };
}
function context(services: Awaited<ReturnType<typeof setup>>) {
  return { domainMetricService: services.service, lifeDomainService: services.domainService } as unknown as LifeOSContextValue;
}
function view(app: LifeOSContextValue, domain: Awaited<ReturnType<typeof setup>>["domain"]) {
  return <MemoryRouter><LifeOSContext.Provider value={app}>
    <DomainMetricsSection domain={domain} />
  </LifeOSContext.Provider></MemoryRouter>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("V1 explicit optional domain satisfaction", () => {
  for (const mode of ["memory", "SQLite"] as const) {
    it(`${mode} selects only linked active metrics without inventing scores or duplicating shared facts`, async () => {
      const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
      try {
        db?.exec("PRAGMA foreign_keys=ON");
        const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
        await new MigrationRunner(sql, migrations, clock).run();
        const { service, repository, domain, other, metric } = await setup(sql);
        expect(await service.listSatisfactionLinks()).toEqual([]);
        expect(domainSatisfaction(domain.id, [], [metric], [])).toEqual({ kind: "none" });
        const global = await service.createDefinition("全局指标", "分", []);
        const unlinked = await service.createDefinition("另一个领域", "分", [other.id]);
        await service.setSatisfactionMetric(domain.id, metric.id);
        await service.setSatisfactionMetric(other.id, metric.id);
        const links = await service.listSatisfactionLinks();
        expect(links).toHaveLength(2);
        expect(await service.listRecords()).toEqual([]);
        for (const [domainId, metricId] of [
          ["missing", metric.id], [domain.id, "missing"], [domain.id, global.id], [domain.id, unlinked.id],
        ]) await expect(service.setSatisfactionMetric(domainId, metricId)).rejects.toThrow();
        expect(await service.listSatisfactionLinks()).toEqual(links);
        const zero = await service.saveRecord(metric.id, "2026-10-20", 0, "确实为零");
        const older = await service.saveRecord(metric.id, "2026-10-18", -2.5, "");
        const records = [older, zero];
        expect(domainSatisfaction(domain.id, links, [metric], records)).toMatchObject({
          kind: "selected", latest: zero,
        });
        expect(records).toEqual([older, zero]);
        await service.setArchived(metric.id, true);
        await expect(service.setSatisfactionMetric(domain.id, metric.id)).rejects.toThrow("归档");
        expect(domainSatisfaction(domain.id, links, await service.listDefinitions(), records))
          .toMatchObject({ kind: "selected", definition: { archived: true }, latest: zero });
        const write = vi.spyOn(repository, "setSatisfactionMetric").mockRejectedValueOnce("database is locked");
        await expect(service.setSatisfactionMetric(domain.id, null)).rejects.toBe("database is locked");
        expect(await service.listSatisfactionLinks()).toEqual(links);
        write.mockRestore();
        await service.setSatisfactionMetric(domain.id, null);
        expect(await service.listSatisfactionLinks()).toEqual([{ domainId: other.id, metricId: metric.id }]);
        expect(await service.listRecords()).toHaveLength(2);
        if (db) {
          expect(() => db.prepare("INSERT INTO domain_satisfaction_links VALUES (?, ?)").run(domain.id, global.id)).toThrow();
          expect(() => db.prepare("DELETE FROM metric_domain_links WHERE metric_id=? AND domain_id=?")
            .run(metric.id, other.id)).toThrow();
          expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        }
      } finally { db?.close(); }
    });
  }

  it("upgrades version 50 without backfill, rolls back failed migration and validates version 51 backups", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys=ON");
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations.slice(0, 50), clock).run();
      const { service, domain, other, metric } = await setup(sql);
      await service.saveRecord(metric.id, "2026-10-20", 0, "保留原文");
      const before = Object.fromEntries(personRelationshipBackupTables.map(table =>
        [table, db.prepare(`SELECT * FROM ${table}`).all()]));
      const migration = migrations[50];
      await expect(new MigrationRunner(sql, [...migrations.slice(0, 50), {
        ...migration, statements: [...migration.statements, "CREATE TABLE life_domains (id TEXT)"],
      }], clock).run()).rejects.toThrow();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='domain_satisfaction_links'").all()).toEqual([]);
      expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get())
        .toMatchObject({ version: migrations[49].id });
      await new MigrationRunner(sql, migrations, clock).run();
      expect(await service.listSatisfactionLinks()).toEqual([]);
      for (const table of personRelationshipBackupTables) {
        expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual(before[table]);
      }
      expect((await new MigrationRunner(sql, migrations, clock).run()).appliedMigrationIds).toEqual([]);
      await service.setSatisfactionMetric(domain.id, metric.id);
      await service.setArchived(metric.id, true);
      const data = Object.fromEntries(domainSatisfactionBackupTables.map(table =>
        [table, db.prepare(`SELECT * FROM ${table}`).all()]));
      const backup = { format: "lifeos-backup", schemaVersion: 51, appVersion: "test", exportedAt: timestamp, data };
      expect(inspectBackup(backup).counts.domain_satisfaction_links).toBe(1);
      const legacy = { ...backup, schemaVersion: 50, data: before };
      expect(inspectBackup(legacy).counts.domain_satisfaction_links).toBe(0);
      expect(() => inspectBackup({ ...backup, schemaVersion: 50 })).toThrow();
      for (const row of [
        { domain_id: "missing", metric_id: metric.id }, { domain_id: other.id, metric_id: "missing" },
        { domain_id: domain.id, metric_id: null }, { domain_id: domain.id, metric_id: metric.id, score: 0 },
      ]) expect(() => inspectBackup({ ...backup, data: { ...data, domain_satisfaction_links: [row] } })).toThrow();
      const row = data.domain_satisfaction_links[0];
      expect(() => inspectBackup({ ...backup, data: { ...data, domain_satisfaction_links: [row, row] } })).toThrow();
      expect(() => inspectBackup({ ...backup, data: { ...data, metric_domain_links: [] } })).toThrow();
    } finally { db.close(); }
  });

  it("retains the explicit selection and original zero after reopening an isolated on-disk database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lifeos-satisfaction-"));
    const path = join(dir, "local.sqlite");
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(path);
      db.exec("PRAGMA foreign_keys=ON");
      await new MigrationRunner(nativeSqliteExecutor(db), migrations, clock).run();
      const { service, domain, metric } = await setup(nativeSqliteExecutor(db));
      await service.setSatisfactionMetric(domain.id, metric.id);
      const zero = await service.saveRecord(metric.id, "2026-10-20", 0, "");
      db.close();
      db = undefined;
      db = new DatabaseSync(path);
      const sql = nativeSqliteExecutor(db);
      const reopened = new DomainMetricService(new SqliteDomainMetricRepository(sql),
        new SqliteLifeDomainRepository(sql), clock, { next: () => "unused" });
      expect(await reopened.listSatisfactionLinks()).toEqual([{ domainId: domain.id, metricId: metric.id }]);
      expect(await reopened.listRecords()).toEqual([zero]);
    } finally {
      db?.close();
      unlinkSync(path);
      rmdirSync(dir);
    }
  });

  it("supports explicit selection, cancel, zero/custom units, recording, archiving and clearing in Chinese", async () => {
    const sql = new MemorySqliteExecutor();
    await new MigrationRunner(sql, migrations, clock).run();
    const services = await setup(sql);
    render(view(context(services), services.domain));
    expect(await screen.findByText("不评分")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "设置满意度指标" }));
    fireEvent.change(screen.getByLabelText("评分指标"), { target: { value: services.metric.id } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(await services.service.listSatisfactionLinks()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "设置满意度指标" }));
    fireEvent.change(screen.getByLabelText("评分指标"), { target: { value: services.metric.id } });
    const reads = vi.spyOn(services.service, "listSatisfactionLinks");
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    expect(await screen.findByText("尚无评分记录")).toBeTruthy();
    expect(reads).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "记录满意度" }));
    fireEvent.change(screen.getByLabelText("记录日期"), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByLabelText("数值 (自定单位)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const summary = await screen.findByRole("heading", { name: "满意度", level: 2 });
    expect(within(summary.closest(".domain-satisfaction")!).getByText("0 自定单位")).toBeTruthy();
    expect(within(summary.closest(".domain-satisfaction")!).getByText("2026-10-20")).toBeTruthy();
    expect(await services.service.listRecords()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "归档自主评分" }));
    expect(await screen.findByText("指标已归档 · 记录保留")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "记录满意度" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "设置满意度指标" }));
    expect(screen.getByRole("option", { name: "自主评分 (自定单位) · 已归档" }).matches(":disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("评分指标"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    expect(await screen.findByText("不评分")).toBeTruthy();
    expect(await services.service.listRecords()).toHaveLength(1);
  });

  it("locks fields/close and duplicate submits; failed draft retains original service/domain across replacement reads", async () => {
    const sql = new MemorySqliteExecutor();
    await new MigrationRunner(sql, migrations, clock).run();
    const services = await setup(sql);
    const pending = deferred<void>();
    const write = vi.spyOn(services.service, "setSatisfactionMetric").mockReturnValueOnce(pending.promise);
    const app = context(services);
    const ui = render(view(app, services.domain));
    fireEvent.click(await screen.findByRole("button", { name: "设置满意度指标" }));
    fireEvent.change(screen.getByLabelText("评分指标"), { target: { value: services.metric.id } });
    const form = screen.getByRole("dialog").querySelector("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(write).toHaveBeenCalledTimes(1);
    for (const field of form.querySelectorAll("select, button")) expect(field.matches(":disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("评分指标"), { target: { value: "" } });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(screen.getByRole("dialog")).toBeTruthy();
    const replacementWrite = vi.fn(async () => {});
    const replacement = { ...app, domainMetricService: {
      listDefinitions: vi.fn(async () => { throw "database path"; }),
      listRecords: vi.fn(async () => []), listSatisfactionLinks: vi.fn(async () => []),
      setSatisfactionMetric: replacementWrite,
    } } as unknown as LifeOSContextValue;
    ui.rerender(view(replacement, services.other));
    expect(await screen.findByText("指标读取失败，请重试。")).toBeTruthy();
    await act(async () => pending.reject("database path"));
    expect(await screen.findByText("保存满意度设置失败，请重试。")).toBeTruthy();
    expect((screen.getByLabelText("评分指标") as HTMLSelectElement).value).toBe(services.metric.id);
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(write.mock.calls).toEqual([[services.domain.id, services.metric.id], [services.domain.id, services.metric.id]]);
    expect(replacementWrite).not.toHaveBeenCalled();
    expect(await services.service.listSatisfactionLinks()).toEqual([{ domainId: services.domain.id, metricId: services.metric.id }]);
  });

  it("does not reread or report an old save after unmount", async () => {
    const sql = new MemorySqliteExecutor();
    await new MigrationRunner(sql, migrations, clock).run();
    const services = await setup(sql);
    const pending = deferred<void>();
    vi.spyOn(services.service, "setSatisfactionMetric").mockReturnValueOnce(pending.promise);
    const reads = vi.spyOn(services.service, "listSatisfactionLinks");
    const ui = render(view(context(services), services.domain));
    fireEvent.click(await screen.findByRole("button", { name: "设置满意度指标" }));
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    const count = reads.mock.calls.length;
    ui.unmount();
    await act(async () => pending.resolve());
    expect(reads).toHaveBeenCalledTimes(count);
  });
});
