import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { AttentionSettingsEditor } from "../../src/components/AttentionSettingsEditor";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import {
  attentionRulePreference, defaultAttentionSettings, findAttentionSignals,
  validateAttentionSettings, type AttentionSettings,
} from "../../src/domain/attention/Attention";
import type { LifeEvent } from "../../src/domain/records/LifeRecords";
import { AttentionPage } from "../../src/pages/AttentionPage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteLifeRecordsRepository } from "../../src/repositories/sqlite/SqliteLifeRecordsRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteSystemRepository } from "../../src/repositories/sqlite/SqliteSystemRepository";
import type { SystemRepository } from "../../src/repositories/system/SystemRepository";
import { AttentionService } from "../../src/services/attention/AttentionService";
import type { IssueService } from "../../src/services/issues/IssueService";
import type { DomainMetricService } from "../../src/services/life/DomainMetricService";
import type { ActionService } from "../../src/services/planning/ActionService";
import type { GoalService } from "../../src/services/planning/GoalService";
import { LifeRecordsService } from "../../src/services/records/LifeRecordsService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const now = new Date("2026-10-20T10:00:00");
const enabled: AttentionSettings = { ...defaultAttentionSettings,
  rules: { "recent-event": { enabled: true, scope: "all", domainIds: [] } },
};
const event: LifeEvent = {
  id: "事件 &1/#", title: "完成重要交流", happenedOn: "2026-10-18", description: "原始记录",
  goalId: null, personId: null, domainIds: ["work"], archived: false,
  createdAt: new Date("2026-10-18T09:00:00").toISOString(),
  updatedAt: new Date("2026-10-19T09:00:00").toISOString(),
};
const signals = (events: readonly LifeEvent[] = [event], settings = enabled, date = now) =>
  findAttentionSignals([], [], [], settings, date, [], [], [], [], [], [], [], [], events);

function readers(events: Pick<LifeRecordsService, "listEvents">, system: SystemRepository,
  date: () => Date = () => now) {
  return new AttentionService(
    { list: async () => [] } as unknown as GoalService,
    { list: async () => [], listPlanChanges: async () => [] } as unknown as ActionService,
    { list: async () => [] } as unknown as IssueService, system, { now: date },
    { listDefinitions: async () => [], listRecords: async () => [] } as unknown as DomainMetricService,
    { list: async () => [], listLogs: async () => [] },
    { list: async () => [] }, { list: async () => [] }, { list: async () => [] }, events,
  );
}

function stubService() {
  let metadata: string | null = null;
  const system = {
    getMetadata: vi.fn(async () => metadata),
    setMetadata: vi.fn(async (_key: string, value: string) => { metadata = value; }),
    completeFirstInitialization: async () => {},
  };
  const events = { listEvents: vi.fn().mockResolvedValue([event]) };
  return { system, events, service: () => readers(events, system) };
}

describe("V1 explicitly enabled recent important event facts", () => {
  it("stays off without explicit enablement and never writes settings during a read", async () => {
    const { service, system } = stubService();
    expect(attentionRulePreference(defaultAttentionSettings, "recent-event").enabled).toBe(false);
    expect(signals([event], defaultAttentionSettings)).toEqual([]);
    expect(signals([event], { ...defaultAttentionSettings, recentEventDays: 30 })).toEqual([]);
    expect((await service().getSnapshot()).signals).toEqual([]);
    expect(system.setMetadata).not.toHaveBeenCalled();
    await service().setSettings(enabled);
    expect((await service().getSnapshot()).signals).toHaveLength(1);
  });

  it("uses the recorded occurrence day and distinct current update evidence without changing the record", () => {
    const original = structuredClone(event);
    const [result] = signals();
    expect(result).toMatchObject({
      kind: "recent-event", title: event.title, domainIds: ["work"],
      period: "2026-10-14 至 2026-10-20",
      sources: [
        { id: event.id, date: event.happenedOn, path: "/timeline", fragment: `event-${event.id}` },
        { id: `${event.id}:updated`, date: event.updatedAt, title: `${event.title} · 当前记录更新时间` },
      ],
    });
    expect(result.summary).toContain("发生日期为 2026-10-18");
    expect(result.baseline).toContain("不推断事件结果或影响");
    expect(result.rule).toContain("不生成预约、周年或补记义务");
    expect(result.action).toBeUndefined();
    expect(event).toEqual(original);
  });

  it("includes today and the first local calendar day but excludes older and future dates", () => {
    const events = ["2026-10-13", "2026-10-14", "2026-10-20", "2026-10-21"].map(happenedOn =>
      ({ ...event, id: happenedOn, happenedOn }));
    expect(signals(events).map(signal => signal.id)).toEqual([
      "recent-event:2026-10-14", "recent-event:2026-10-20",
    ]);
    expect(signals(events, { ...enabled, recentEventDays: 1 }).map(signal => signal.id))
      .toEqual(["recent-event:2026-10-20"]);
    const midnightEvent = { ...event, happenedOn: "2026-10-20",
      createdAt: new Date("2026-10-20T00:00:00").toISOString(),
      updatedAt: new Date("2026-10-20T00:00:00").toISOString() };
    expect(signals([midnightEvent], enabled, new Date("2026-10-20T00:00:00"))).toHaveLength(1);
    const old = { ...event, createdAt: "2023-01-01T00:00:00Z", updatedAt: "2023-01-01T00:00:00Z" };
    expect(signals([{ ...old, happenedOn: "2024-02-29" }], enabled, new Date("2024-03-01T00:00:00"))[0].period)
      .toBe("2024-02-24 至 2024-03-01");
    expect(signals([{ ...old, happenedOn: "2025-12-31" }], enabled, new Date("2026-01-01T00:00:00"))[0].period)
      .toBe("2025-12-26 至 2026-01-01");
    expect(signals([{ ...event, happenedOn: "2025-10-20" }])).toEqual([]);
  });

  it("excludes archived, invalid and future facts, including rolled-over timestamp dates", () => {
    expect(signals([
      { ...event, archived: true }, { ...event, title: " " },
      { ...event, happenedOn: "2026-02-30" }, { ...event, happenedOn: "2026-10-21" },
      { ...event, createdAt: "2026-09-31T09:00:00Z" }, { ...event, updatedAt: "invalid" },
      { ...event, updatedAt: new Date(now.getTime() + 1).toISOString() },
      { ...event, createdAt: now.toISOString() },
    ])).toEqual([]);
    expect(signals([event], enabled, new Date(NaN))).toEqual([]);
  });

  it("uses only explicit event domains, including empty selected scope and disabled rules", () => {
    const scoped: AttentionSettings = { ...enabled,
      rules: { "recent-event": { enabled: true, scope: "domains", domainIds: ["work"] } } };
    expect(signals([event], scoped)).toHaveLength(1);
    expect(signals([{ ...event, domainIds: [], goalId: "work-goal" }], scoped)).toEqual([]);
    expect(signals([{ ...event, domainIds: ["home"] }], scoped)).toEqual([]);
    expect(signals([event], { ...enabled,
      rules: { "recent-event": { enabled: true, scope: "domains", domainIds: [] } } })).toEqual([]);
    expect(signals([event], { ...enabled,
      rules: { "recent-event": { enabled: false, scope: "all", domainIds: [] } } })).toEqual([]);
  });

  it("roundtrips saved configuration and rejects corrupt or noninteger calendar windows", async () => {
    const { service, system } = stubService();
    const saved = { ...enabled, recentEventDays: 30 };
    await service().setSettings(saved);
    expect(await service().getSettings()).toEqual(saved);
    expect(() => validateAttentionSettings({ ...enabled, recentEventDays: 1 })).not.toThrow();
    for (const recentEventDays of [0, 31, 1.5, "7", null]) {
      const invalid = { ...enabled, recentEventDays } as unknown as AttentionSettings;
      expect(() => validateAttentionSettings(invalid)).toThrow();
      await system.setMetadata("m5_attention_settings", JSON.stringify(invalid));
      await expect(service().getSettings()).rejects.toThrow("配置损坏");
    }
  });

  it("sanitizes event read failures and supports a subsequent read", async () => {
    const { service, events } = stubService();
    await service().setSettings(enabled);
    events.listEvents.mockRejectedValueOnce(new Error("SQLITE_BUSY C:/private/path"));
    await expect(service().getSnapshot()).rejects.toThrow("重要事件读取失败，请重新查看。");
    expect((await service().getSnapshot()).signals).toHaveLength(1);
  });

  for (const mode of ["SQLite", "preview"] as const) {
    it(`${mode} rereads occurrence edits, archives and settings without altering user facts`, async () => {
      const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
      const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
      let clockDate = new Date("2026-10-18T09:00:00");
      const clock = { now: () => clockDate };
      try {
        db?.exec("PRAGMA foreign_keys=ON");
        await new MigrationRunner(sql, migrations, clock).run();
        const records = new LifeRecordsService(new SqliteLifeRecordsRepository(sql),
          new SqliteLifeDomainRepository(sql), new SqliteGoalRepository(sql), clock, { next: () => event.id });
        const saved = await records.saveEvent({ ...event, domainIds: [] });
        clockDate = now;
        const service = () => readers(records, new SqliteSystemRepository(sql, clock), clock.now);
        expect((await service().getSnapshot()).signals).toEqual([]);
        await service().setSettings(enabled);
        expect((await service().getSnapshot()).signals[0].sources[0].id).toBe(saved.id);
        await records.saveEvent({ ...saved, happenedOn: "2026-10-13" }, saved.id);
        expect((await service().getSnapshot()).signals).toEqual([]);
        await service().setSettings({ ...enabled, recentEventDays: 8 });
        expect((await service().getSnapshot()).signals).toHaveLength(1);
        await records.setArchived("life_events", saved.id, true);
        expect((await service().getSnapshot()).signals).toEqual([]);
        await records.setArchived("life_events", saved.id, false);
        expect((await service().getSnapshot()).signals).toHaveLength(1);
        await records.saveEvent({ ...saved, happenedOn: "2026-10-21" }, saved.id);
        expect((await service().getSnapshot()).signals).toEqual([]);
        expect((await records.listEvents())[0]).toMatchObject({
          description: event.description, happenedOn: "2026-10-21", createdAt: saved.createdAt,
        });
        expect(await service().getSettings()).toEqual({ ...enabled, recentEventDays: 8 });
        if (db) expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally { db?.close(); }
    });
  }

  it("renders Chinese occurrence evidence and encoded links to the original timeline record", async () => {
    const { service } = stubService();
    const instance = service();
    await instance.setSettings(enabled);
    const value = { attentionService: instance, lifeDomainService: { list: async () => [] } } as unknown as LifeOSContextValue;
    render(<MemoryRouter><LifeOSContext.Provider value={value}><AttentionPage /></LifeOSContext.Provider></MemoryRouter>);
    await screen.findByRole("heading", { name: event.title });
    expect(screen.getByText("已记录事件的发生日期")).toBeTruthy();
    fireEvent.click(screen.getByText("查看依据"));
    expect(screen.getByRole("link", { name: event.title }).getAttribute("href"))
      .toBe(`/timeline#${encodeURIComponent(`event-${event.id}`)}`);
    expect(screen.getByRole("link", { name: `${event.title} · 当前记录更新时间` }).getAttribute("href"))
      .toBe(`/timeline#${encodeURIComponent(`event-${event.id}`)}`);
  });

  it("requires explicit save, preserves a failed draft and restores default-off only after save", async () => {
    const { service } = stubService();
    const instance = service();
    const save = vi.spyOn(instance, "setSettings").mockRejectedValueOnce(new Error("private database path"));
    const value = { attentionService: instance, lifeDomainService: { list: async () => [] } } as unknown as LifeOSContextValue;
    render(<MemoryRouter><LifeOSContext.Provider value={value}><AttentionSettingsEditor /></LifeOSContext.Provider></MemoryRouter>);
    const region = within(await screen.findByRole("region", { name: "提醒规则" }));
    const toggle = await region.findByRole("checkbox", { name: "近期重要事件", exact: true });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(region.queryByLabelText("近期重要事件观察期（天）")).toBeNull();
    fireEvent.click(toggle);
    const days = region.getByLabelText("近期重要事件观察期（天）") as HTMLInputElement;
    expect(days.value).toBe("7");
    fireEvent.change(days, { target: { value: "14" } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(region.getByRole("button", { name: "保存规则" }));
    expect((await region.findByRole("alert")).textContent).toBe("提醒规则保存失败，请重试。");
    expect(days.value).toBe("14");
    expect((toggle as HTMLInputElement).checked).toBe(true);
    fireEvent.click(region.getByRole("button", { name: "保存规则" }));
    await region.findByText("已保存");
    expect(await instance.getSettings()).toMatchObject({ recentEventDays: 14, rules: enabled.rules });
    fireEvent.click(region.getByRole("button", { name: "恢复默认" }));
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect((await instance.getSettings()).recentEventDays).toBe(14);
    fireEvent.click(region.getByRole("button", { name: "保存规则" }));
    await region.findByText("已保存");
    expect(await instance.getSettings()).toEqual(defaultAttentionSettings);
  });
});
