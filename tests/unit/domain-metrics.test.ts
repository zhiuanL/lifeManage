import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { DomainMetricsSection } from "../../src/components/DomainMetricsSection";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { m5DomainMetricsMigration } from "../../src/db/migrations/0012-m5-domain-metrics";
import { buildDomainMetricTrends } from "../../src/domain/analytics/DomainMetricTrend";
import type { MetricDefinition } from "../../src/domain/life/DomainMetric";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteDomainMetricRepository } from "../../src/repositories/sqlite/SqliteDomainMetricRepository";
import type { SqliteExecutor } from "../../src/repositories/sqlite/SqliteExecutor";
import { DomainMetricService } from "../../src/services/life/DomainMetricService";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(cleanup);

let instant = new Date("2026-09-20T00:00:00.000Z");
const clock = { now: () => instant };

async function setup(executor: SqliteExecutor) {
  let next = 0;
  const domains = new SqliteLifeDomainRepository(executor);
  const domainService = new LifeDomainService(domains, clock, { next: () => `domain-${++next}` });
  const repo = new SqliteDomainMetricRepository(executor);
  const service = new DomainMetricService(repo, domains, clock, { next: () => `metric-${++next}` });
  const created = await domainService.create({
    name: "健康", description: "", focus: "", color: "fern", icon: "heart",
  });
  const second = await domainService.create({
    name: "成长", description: "", focus: "", color: "ocean", icon: "book-open",
  });
  return { repo, service, domainService, created, second };
}

describe("M5 domain metrics", () => {
  it("validates definitions and daily numbers, preserving gaps and explicit corrections in preview", async () => {
    instant = new Date("2026-09-20T00:00:00.000Z");
    const executor = new MemorySqliteExecutor();
    await new MigrationRunner(executor, migrations, clock).run();
    const { repo, service, created, second } = await setup(executor);
    await expect(service.createDefinition("", "小时", [created.id])).rejects.toThrow("名称");
    await expect(service.createDefinition("睡眠", "", [created.id])).rejects.toThrow("单位");
    await expect(service.createDefinition("睡眠", "小时", [created.id, created.id])).rejects.toThrow("无效");
    await expect(service.createDefinition("睡眠", "小时", ["missing"])).rejects.toThrow("不存在");

    const definition = await service.createDefinition(" 睡眠时长 ", " 小时 ", [created.id, second.id]);
    expect(definition).toMatchObject({ name: "睡眠时长", unit: "小时",
      domainIds: [created.id, second.id] });
    await expect(repo.createDefinition({
      ...definition, id: "bad", domainIds: [created.id, "missing"],
    })).rejects.toThrow();
    expect((await service.listDefinitions()).map((item) => item.id)).toEqual([definition.id]);

    await expect(service.saveRecord(definition.id, "2026-02-30", 7, "")).rejects.toThrow("日期");
    await expect(service.saveRecord(definition.id, "2026-09-21", Number.NaN, "")).rejects.toThrow("数值");
    await expect(service.saveRecord(definition.id, "2026-09-21", 7, "x".repeat(281)))
      .rejects.toThrow("说明");
    const first = await service.saveRecord(definition.id, "2026-09-21", 7, "  散步后睡得好  ");
    const last = await service.saveRecord(definition.id, "2026-09-23", 8, "");
    await expect(service.saveRecord(definition.id, "2026-09-21", 0, "")).rejects.toThrow("更正");
    await expect(service.saveRecord("missing", "2026-09-21", 1, "")).rejects.toThrow("不存在");
    await expect(service.saveRecord(definition.id, "2026-09-22", 5, "", "missing"))
      .rejects.toThrow("不存在");
    instant = new Date("2026-09-24T00:00:00.000Z");
    await expect(service.saveRecord(definition.id, "2026-09-23", 6, "", first.id))
      .rejects.toThrow("更正");
    const correction = await service.saveRecord(definition.id, "2026-09-21", 6.5, "更正", first.id);
    expect(correction).toMatchObject({ id: first.id, value: 6.5, note: "更正",
      createdAt: first.createdAt, updatedAt: instant.toISOString() });
    expect((await service.listRecords()).map((item) => item.id)).toEqual([last.id, first.id]);
    await service.setArchived(definition.id, true);
    await expect(service.saveRecord(definition.id, "2026-09-25", 7, "")).rejects.toThrow("归档");
    expect(await service.listRecords()).toHaveLength(2);
    await service.setArchived(definition.id, false);
    await service.saveRecord(definition.id, "2026-09-25", 0, "");
    expect(await service.listRecords()).toHaveLength(3);
  });

  it("migrates a populated real database forward without backfilling, and rolls back invalid links", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      for (const migration of migrations.slice(0, migrations.indexOf(m5DomainMetricsMigration))) {
        for (const statement of migration.statements) db.exec(statement);
      }
      db.prepare(`INSERT INTO life_domains
        (id, name, color_key, icon_key, sort_order, created_at, updated_at)
        VALUES ('old', '原领域', 'fern', 'heart', 0, '2026-09-20', '2026-09-20')`).run();
      for (const statement of m5DomainMetricsMigration.statements) db.exec(statement);
      expect(db.prepare("SELECT name FROM life_domains WHERE id = 'old'").get()).toEqual({ name: "原领域" });
      expect(db.prepare("SELECT * FROM metric_definitions").all()).toEqual([]);
      expect(db.prepare("SELECT * FROM metric_records").all()).toEqual([]);
      for (const migration of migrations.slice(migrations.indexOf(m5DomainMetricsMigration) + 1)) {
        for (const statement of migration.statements) db.exec(statement);
      }
      const executor = nativeSqliteExecutor(db);
      instant = new Date("2026-09-20T00:00:00.000Z");
      const { repo, service, created, second } = await setup(executor);
      const invalid: MetricDefinition = {
        id: "invalid", name: "无效", unit: "次", archived: false,
        createdAt: instant.toISOString(), domainIds: [created.id, "missing"],
      };
      await expect(repo.createDefinition(invalid)).rejects.toThrow();
      expect(db.prepare("SELECT * FROM metric_definitions WHERE id = 'invalid'").all()).toEqual([]);
      expect(db.prepare("SELECT * FROM metric_domain_links WHERE metric_id = 'invalid'").all()).toEqual([]);

      const definition = await service.createDefinition("锻炼次数", "次", [created.id, second.id]);
      const record = await service.saveRecord(definition.id, "2026-09-21", 2, "手动记录");
      await expect(repo.createRecord({ ...record, id: "another" })).rejects.toThrow();
      instant = new Date("2026-09-22T00:00:00.000Z");
      await service.saveRecord(definition.id, "2026-09-21", 3, "更正", record.id);
      expect(await service.listRecords()).toEqual([expect.objectContaining({
        id: record.id, recordedOn: "2026-09-21", value: 3, note: "更正",
      })]);
      expect(db.prepare("SELECT domain_id FROM metric_domain_links WHERE metric_id = ? ORDER BY domain_id")
        .all(definition.id)).toEqual([{ domain_id: created.id }, { domain_id: second.id }]);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("keeps a domain, metric, and daily record after reopening an on-disk database", async () => {
    instant = new Date("2026-09-20T00:00:00.000Z");
    const directory = mkdtempSync(join(tmpdir(), "lifeos-metric-test-"));
    const path = join(directory, "lifeos.db");
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(path);
      db.exec("PRAGMA foreign_keys = ON");
      await new MigrationRunner(nativeSqliteExecutor(db), migrations, clock).run();
      const { service, created, second } = await setup(nativeSqliteExecutor(db));
      const metric = await service.createDefinition("睡眠时长", "小时", [created.id, second.id]);
      const record = await service.saveRecord(metric.id, "2026-09-20", 7.5, "首次记录");

      db.close();
      db = undefined;

      db = new DatabaseSync(path);
      db.exec("PRAGMA foreign_keys = ON");
      const executor = nativeSqliteExecutor(db);
      expect((await new MigrationRunner(executor, migrations, clock).run()).appliedMigrationIds)
        .toEqual([]);
      const domains = new LifeDomainService(new SqliteLifeDomainRepository(executor), clock,
        { next: () => "unused-domain" });
      const metrics = new DomainMetricService(new SqliteDomainMetricRepository(executor),
        new SqliteLifeDomainRepository(executor), clock, { next: () => "unused-metric" });

      expect((await domains.list()).map((domain) => domain.id)).toEqual([created.id, second.id]);
      expect(await metrics.listDefinitions()).toEqual([metric]);
      expect(await metrics.listRecords()).toEqual([record]);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db?.close();
      unlinkSync(path);
      rmdirSync(directory);
    }
  });

  it("keeps indicators in domain context, never a goal, and displays only recorded dates", () => {
    const definitions: MetricDefinition[] = [
      { id: "a", name: "睡眠", unit: "小时", domainIds: ["health", "work"],
        createdAt: "", archived: false },
      { id: "b", name: "心情", unit: "分", domainIds: ["work"],
        createdAt: "", archived: true },
    ];
    const records = [
      { id: "r1", metricId: "a", recordedOn: "2026-09-21", value: 7,
        note: "", createdAt: "", updatedAt: "" },
      { id: "r2", metricId: "a", recordedOn: "2026-09-23", value: 8,
        note: "", createdAt: "", updatedAt: "" },
      { id: "r3", metricId: "b", recordedOn: "2026-09-22", value: 2,
        note: "", createdAt: "", updatedAt: "" },
    ];
    expect(buildDomainMetricTrends(definitions, records, "health", null, "2026-09-20", "2026-09-23"))
      .toEqual([{ definition: definitions[0], records: records.slice(0, 2) }]);
    expect(buildDomainMetricTrends(definitions, records, "work", null, "2026-09-22", "2026-09-23"))
      .toEqual([{ definition: definitions[0], records: [records[1]] },
        { definition: definitions[1], records: [records[2]] }]);
    expect(buildDomainMetricTrends(definitions, records, "health", "goal", "2026-09-20", "2026-09-23"))
      .toEqual([]);
  });

  it("lets a user create, correct, archive and restore a metric in the Chinese domain view", async () => {
    instant = new Date("2026-09-20T00:00:00.000Z");
    const executor = new MemorySqliteExecutor();
    await new MigrationRunner(executor, migrations, clock).run();
    const { service, created, second } = await setup(executor);
    const value = {
      domainMetricService: service,
      lifeDomainService: { list: vi.fn().mockResolvedValue([created, second]) },
    } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, null,
      createElement(LifeOSContext.Provider, { value },
        createElement(DomainMetricsSection, { domain: created }))));
    expect(await screen.findByText(/还没有指标/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "添加指标" }));
    fireEvent.change(screen.getByLabelText("指标名称"), { target: { value: "睡眠时长" } });
    fireEvent.change(screen.getByLabelText("计量单位"), { target: { value: "小时" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "成长" }));
    fireEvent.click(screen.getByRole("button", { name: "创建指标" }));
    expect(await screen.findByRole("heading", { name: "睡眠时长 (小时)" })).toBeTruthy();
    expect((await service.listDefinitions())[0].domainIds).toEqual([created.id, second.id]);
    fireEvent.click(screen.getByRole("button", { name: "记录" }));
    fireEvent.change(screen.getByLabelText("记录日期"), { target: { value: "2026-09-21" } });
    fireEvent.change(screen.getByLabelText("数值 (小时)"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    expect(await screen.findByText("最近记录 2026-09-21")).toBeTruthy();
    fireEvent.click(screen.getByText("查看记录 (1)"));
    fireEvent.click(screen.getByRole("button", { name: "更正睡眠时长 2026-09-21的记录" }));
    fireEvent.change(screen.getByLabelText("数值 (小时)"), { target: { value: "6.5" } });
    fireEvent.click(screen.getByRole("button", { name: "保存更正" }));
    await waitFor(() => expect(screen.getByText("6.5 小时")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "归档睡眠时长" }));
    expect(await screen.findByText("已归档 · 记录保留")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "记录" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "恢复睡眠时长" }));
    expect(await screen.findByRole("button", { name: "记录" })).toBeTruthy();
    expect(await service.listRecords()).toHaveLength(1);
  });

  it("sanitizes a desktop SQL string error in the metric editor without closing it", async () => {
    const executor = new MemorySqliteExecutor();
    await new MigrationRunner(executor, migrations, clock).run();
    const { service, created } = await setup(executor);
    vi.spyOn(service, "createDefinition").mockRejectedValueOnce("database is locked");
    const value = {
      domainMetricService: service,
      lifeDomainService: { list: vi.fn().mockResolvedValue([created]) },
    } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, null,
      createElement(LifeOSContext.Provider, { value },
        createElement(DomainMetricsSection, { domain: created }))));

    fireEvent.click(await screen.findByRole("button", { name: "添加指标" }));
    fireEvent.change(screen.getByLabelText("指标名称"), { target: { value: "睡眠" } });
    fireEvent.change(screen.getByLabelText("计量单位"), { target: { value: "小时" } });
    fireEvent.click(screen.getByRole("button", { name: "创建指标" }));
    expect((await screen.findByRole("alert")).textContent).toBe("保存指标失败，请重试。");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(await service.listDefinitions()).toEqual([]);
  });
});
