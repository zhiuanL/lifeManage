import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { AttentionSettingsEditor } from "../../src/components/AttentionSettingsEditor";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import {
  attentionRulePreference, defaultAttentionSettings, findAttentionSignals, validateAttentionSettings, type AttentionSettings,
} from "../../src/domain/attention/Attention";
import type { Review } from "../../src/domain/reviews/Review";
import { createReviewStructure, type ReviewType } from "../../src/domain/reviews/ReviewStructure";
import { AttentionPage } from "../../src/pages/AttentionPage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteReviewRepository } from "../../src/repositories/sqlite/SqliteReviewRepository";
import { SqliteSystemRepository } from "../../src/repositories/sqlite/SqliteSystemRepository";
import type { SystemRepository } from "../../src/repositories/system/SystemRepository";
import { AttentionService } from "../../src/services/attention/AttentionService";
import type { IssueService } from "../../src/services/issues/IssueService";
import type { DomainMetricService } from "../../src/services/life/DomainMetricService";
import type { ActionService } from "../../src/services/planning/ActionService";
import type { GoalService } from "../../src/services/planning/GoalService";
import { ReviewService } from "../../src/services/reviews/ReviewService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const now = new Date("2026-10-20T10:00:00");
const settings = { ...defaultAttentionSettings };
const draft: Review = {
  id: "复盘 &1", title: "整理本周方向", reflection: "", insight: "", nextFocus: "",
  domainId: "work", domainIds: ["work"], reviewedOn: "2026-10-18",
  goalIds: ["related-goal"], issueIds: ["related-issue"],
  structure: createReviewStructure("weekly", "2026-10-18"),
  createdAt: new Date("2026-10-18T09:00:00").toISOString(),
  updatedAt: new Date("2026-10-19T09:00:00").toISOString(),
};

function signals(reviews: readonly Review[] = [draft], preferences: AttentionSettings = settings, date = now) {
  return findAttentionSignals([], [], [], preferences, date, [], [], [], [], [], [], [], reviews);
}

function readers(reviews: Pick<ReviewService, "list">, system: SystemRepository, date: () => Date = () => now) {
  return new AttentionService(
    { list: async () => [] } as unknown as GoalService,
    { list: async () => [], listPlanChanges: async () => [] } as unknown as ActionService,
    { list: async () => [] } as unknown as IssueService, system, { now: date },
    { listDefinitions: async () => [], listRecords: async () => [] } as unknown as DomainMetricService,
    { list: async () => [], listLogs: async () => [] },
    { list: async () => [] }, { list: async () => [] }, reviews,
    { listEvents: async () => [] },
  );
}

function stubService() {
  let metadata: string | null = null;
  const system = {
    getMetadata: vi.fn(async () => metadata),
    setMetadata: vi.fn(async (_key: string, value: string) => { metadata = value; }),
    completeFirstInitialization: async () => {},
  };
  const reviews = { list: vi.fn().mockResolvedValue([draft]) };
  return { system, reviews, service: () => readers(reviews, system) };
}

describe("V1 explicit review draft period reminders", () => {
  it("shows current draft facts and an accurately labelled calculated reminder date", () => {
    const original = structuredClone(draft);
    const [result] = signals();
    expect(result).toMatchObject({
      id: `review-draft:${draft.id}`, kind: "review-draft", title: draft.title, domainIds: ["work"],
      sources: [{ id: draft.id, path: "/reviews", fragment: `review-${draft.id}`, date: draft.updatedAt }],
    });
    expect(result.summary).toContain("2026-10-12 至 2026-10-18");
    expect(result.summary).toContain("当前仍为草稿");
    expect(result.baseline).toContain("2026-10-19");
    expect(result.baseline).toContain("不是用户约定的截止日");
    expect(result.period).toBe("2026-10-12 至 2026-10-20");
    expect(draft).toEqual(original);
  });

  it("uses local calendar day boundaries, not elapsed timestamp hours", () => {
    const dated = { ...draft, updatedAt: draft.createdAt };
    expect(signals([dated], settings, new Date("2026-10-18T23:59:59.999"))).toEqual([]);
    expect(signals([dated], settings, new Date("2026-10-19T00:00:00"))).toHaveLength(1);
    const wait: AttentionSettings = { ...settings, reviewWaitDays: 2 };
    expect(signals([dated], wait, new Date("2026-10-19T23:59:59.999"))).toEqual([]);
    expect(signals([dated], wait, new Date("2026-10-20T00:00:00"))).toHaveLength(1);
    expect(signals([draft], { ...settings, reviewWaitDays: 3 })).toEqual([]);
  });

  it("defaults to four deeper cycles; daily is opt-in and no record means no reminder", () => {
    const anchors: [ReviewType, string][] = [
      ["daily", "2026-10-19"], ["weekly", "2026-10-18"], ["monthly", "2026-09-30"],
      ["quarterly", "2026-09-30"], ["annual", "2025-12-31"],
    ];
    const reviews = anchors.map(([type, anchor]) => ({
      ...draft, id: type, reviewedOn: anchor, structure: createReviewStructure(type, anchor),
    }));
    expect(signals(reviews).map(signal => signal.id)).toEqual([
      "review-draft:weekly", "review-draft:monthly", "review-draft:quarterly", "review-draft:annual",
    ]);
    expect(signals(reviews, { ...settings, reviewDraftTypes: ["daily"] }).map(signal => signal.id))
      .toEqual(["review-draft:daily"]);
    expect(signals(reviews, { ...settings, reviewDraftTypes: [] })).toEqual([]);
    expect(signals([])).toEqual([]);
    expect(signals([{ ...draft, structure: null }, { ...draft, structure: undefined }])).toEqual([]);
    expect(signals([{ ...draft, structure: { ...draft.structure!, status: "completed" } }])).toEqual([]);
    expect(signals([{ ...draft, structure: createReviewStructure("weekly", "2026-10-20") }])).toEqual([]);
  });

  it("reuses validated calendar periods across year and leap-month boundaries", () => {
    const weekly = { ...draft, structure: createReviewStructure("weekly", "2026-01-01") };
    expect(signals([weekly])[0].summary).toContain("2025-12-29 至 2026-01-04");
    const monthly = { ...draft, structure: createReviewStructure("monthly", "2024-02-29") };
    expect(signals([monthly])[0].summary).toContain("2024-02-01 至 2024-02-29");
    expect(signals([monthly])[0].baseline).toContain("2024-03-01");
  });

  it("ignores corrupt or future facts without guessing a period or completion history", () => {
    const invalid: Review[] = [
      { ...draft, createdAt: "2026-09-31T09:00:00Z" },
      { ...draft, updatedAt: "not a timestamp" },
      { ...draft, updatedAt: new Date(now.getTime() + 1).toISOString() },
      { ...draft, createdAt: now.toISOString() },
      { ...draft, reviewedOn: "2026-02-30" },
      { ...draft, reviewedOn: "2026-10-21" },
      { ...draft, structure: { ...draft.structure!, end: "2026-10-17" } },
      { ...draft, structure: { ...draft.structure!, type: "other" as ReviewType } },
      { ...draft, structure: createReviewStructure("annual", "2027-01-01") },
    ];
    expect(signals(invalid)).toEqual([]);
    expect(signals([draft], settings, new Date(NaN))).toEqual([]);
    const completed = { ...draft, id: "other", structure: { ...draft.structure!, status: "completed" as const } };
    expect(signals([draft, completed])).toHaveLength(1);
    expect(signals([draft, completed])[0].baseline).toContain("不代替同周期的其他复盘记录");
  });

  it("uses explicit review domains only and preserves disabled or empty selected scopes", () => {
    const scoped: AttentionSettings = { ...settings, rules: {
      "review-draft": { enabled: true, scope: "domains", domainIds: ["work"] },
    } };
    expect(signals([draft], scoped)).toHaveLength(1);
    expect(signals([{ ...draft, domainIds: ["home"] }], scoped)).toEqual([]);
    expect(signals([{ ...draft, domainIds: [] }], scoped)).toEqual([]);
    expect(signals([draft], { ...settings, rules: {
      "review-draft": { enabled: true, scope: "domains", domainIds: [] },
    } })).toEqual([]);
    expect(signals([draft], { ...settings, rules: {
      "review-draft": { enabled: false, scope: "all", domainIds: [] },
    } })).toEqual([]);
  });

  it("keeps old metadata untouched and rejects malformed new settings rather than enabling defaults", async () => {
    const { service, system } = stubService();
    await system.setMetadata("m5_attention_settings", JSON.stringify(settings));
    system.setMetadata.mockClear();
    expect(await service().getSettings()).toEqual(settings);
    expect(system.setMetadata).not.toHaveBeenCalled();
    const saved: AttentionSettings = { ...settings, reviewWaitDays: 4, reviewDraftTypes: [] };
    await service().setSettings(saved);
    expect(await service().getSettings()).toEqual(saved);
    for (const field of [
      { reviewWaitDays: 0 }, { reviewWaitDays: 31 }, { reviewWaitDays: 1.5 }, { reviewWaitDays: "1" },
      { reviewWaitDays: null }, { reviewDraftTypes: null }, { reviewDraftTypes: "weekly" },
      { reviewDraftTypes: ["unknown"] }, { reviewDraftTypes: ["weekly", "weekly"] },
    ]) {
      expect(() => validateAttentionSettings({ ...settings, ...field } as unknown as AttentionSettings)).toThrow();
      await system.setMetadata("m5_attention_settings", JSON.stringify({ ...settings, ...field }));
      await expect(service().getSettings()).rejects.toThrow("配置损坏");
    }
  });

  it("exposes a Chinese retry message on read failure without database details", async () => {
    const { service, reviews } = stubService();
    reviews.list.mockRejectedValueOnce(new Error("SQLITE_BUSY: C:/private/path"));
    await expect(service().getSnapshot()).rejects.toThrow("复盘记录读取失败，请重新查看。");
    expect((await service().getSnapshot()).signals).toHaveLength(1);
  });

  for (const mode of ["SQLite", "preview"] as const) {
    it(`${mode} reads saved drafts and metadata across service instances and respects explicit completion`, async () => {
      const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
      const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
      let clockDate = new Date("2026-10-18T09:00:00");
      const clock = { now: () => clockDate };
      try {
        db?.exec("PRAGMA foreign_keys=ON");
        await new MigrationRunner(sql, migrations, clock).run();
        const reviews = new ReviewService(new SqliteReviewRepository(sql, true, true),
          new SqliteLifeDomainRepository(sql), clock, { next: () => draft.id });
        const saved = await reviews.create({
          ...draft, domainId: null, domainIds: [], goalIds: [], issueIds: [],
        });
        clockDate = now;
        const system = new SqliteSystemRepository(sql, clock);
        const service = () => readers(reviews, system, clock.now);
        expect((await service().getSnapshot()).signals[0].sources[0].id).toBe(saved.id);
        await service().setSettings({ ...settings, reviewWaitDays: 3, reviewDraftTypes: ["weekly"] });
        expect((await service().getSnapshot()).signals).toEqual([]);
        expect(await service().getSettings()).toMatchObject({ reviewWaitDays: 3, reviewDraftTypes: ["weekly"] });
        await service().setSettings(settings);
        await reviews.update(saved.id, { ...saved, structure: { ...saved.structure!, status: "completed" } });
        expect((await service().getSnapshot()).signals).toEqual([]);
        await reviews.update(saved.id, { ...saved, structure: { ...saved.structure!, status: "draft" } });
        expect((await service().getSnapshot()).signals).toHaveLength(1);
        const scheduled: AttentionSettings = { ...settings,
          reviewSchedule: { startOn: "2026-10-12", types: ["weekly"], waitDays: 1 },
          rules: { "review-due": { enabled: true, scope: "all", domainIds: [] } },
        };
        await service().setSettings(scheduled);
        expect(await service().getSettings()).toEqual(scheduled);
        expect((await service().getSnapshot()).signals.map(signal => signal.kind)).toEqual(["review-due"]);
        await new MigrationRunner(sql, migrations, clock).run();
        expect((await reviews.findById(saved.id))?.createdAt).toBe(saved.createdAt);
        expect((await service().getSnapshot()).signals).toHaveLength(1);
        if (db) expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally { db?.close(); }
    });
  }

  it("shows Chinese evidence and an encoded unfiltered original review link", async () => {
    const { service } = stubService();
    const value = { attentionService: service(), lifeDomainService: { list: async () => [] } } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider, { value },
      createElement(AttentionPage))));
    await screen.findByRole("heading", { name: draft.title });
    expect(screen.getByText("已保存复盘的周期与当前草稿状态")).toBeTruthy();
    fireEvent.click(screen.getByText("查看依据"));
    expect(screen.getByText(/不是用户约定的截止日/)).toBeTruthy();
    expect(screen.getByRole("link", { name: `${draft.title}（周复盘草稿）` }).getAttribute("href"))
      .toBe(`/reviews#${encodeURIComponent(`review-${draft.id}`)}`);
  });

  it("saves only explicitly, preserves failed draft edits, and does not enable daily reminders by default", async () => {
    const { service } = stubService();
    const instance = service();
    const save = vi.spyOn(instance, "setSettings").mockRejectedValueOnce(new Error("private database path"));
    const value = { attentionService: instance, lifeDomainService: { list: async () => [] } } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider, { value },
      createElement(AttentionSettingsEditor))));
    const region = within(await screen.findByRole("region", { name: "提醒规则" }));
    const days = await region.findByLabelText("复盘周期结束后等待（天）");
    const daily = region.getByRole("checkbox", { name: "日复盘", exact: true });
    expect((days as HTMLInputElement).value).toBe("1");
    expect((daily as HTMLInputElement).checked).toBe(false);
    expect((region.getByRole("checkbox", { name: "周复盘", exact: true }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(days, { target: { value: "4" } });
    fireEvent.click(daily);
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(region.getByRole("button", { name: "保存规则" }));
    expect((await region.findByRole("alert")).textContent).toBe("提醒规则保存失败，请重试。");
    expect((days as HTMLInputElement).value).toBe("4");
    expect((daily as HTMLInputElement).checked).toBe(true);
    fireEvent.click(region.getByRole("button", { name: "保存规则" }));
    await region.findByText("已保存");
    expect(await instance.getSettings()).toMatchObject({
      reviewWaitDays: 4, reviewDraftTypes: ["daily", "weekly", "monthly", "quarterly", "annual"],
    });
    fireEvent.click(region.getByRole("button", { name: "恢复默认" }));
    expect((daily as HTMLInputElement).checked).toBe(false);
    expect((await instance.getSettings()).reviewWaitDays).toBe(4);
    fireEvent.click(region.getByRole("button", { name: "保存规则" }));
    await region.findByText("已保存");
    expect(await instance.getSettings()).toEqual(settings);
  });
});

describe("V1 explicitly enabled recurring review nodes", () => {
  const scheduled: AttentionSettings = { ...settings,
    reviewSchedule: { startOn: "2026-01-01", types: ["weekly", "monthly", "quarterly", "annual"], waitDays: 1 },
    rules: { "review-due": { enabled: true, scope: "all", domainIds: [] } },
  };
  const due = (reviews: readonly Review[] = [], preferences = scheduled, date = now) =>
    signals(reviews, preferences, date).filter(signal => signal.kind === "review-due");

  it("is off by default and considers only the latest due full period after activation", () => {
    expect(attentionRulePreference(settings, "review-due").enabled).toBe(false);
    expect(signals([], { ...settings, reviewSchedule: scheduled.reviewSchedule })).toEqual([]);
    const result = due();
    expect(result.map(signal => signal.id)).toEqual([
      "review-due:weekly:2026-10-12", "review-due:monthly:2026-09-01", "review-due:quarterly:2026-07-01",
    ]);
    expect(result[0].summary).toContain("尚无已完成记录");
    expect(result[0].sources[0]).toMatchObject({
      path: "/settings", date: "2026-01-01", fragment: "settings-attention-title",
    });
    expect(result[0].baseline).toContain("不按领域复制记录");
    const action = new URL(result[0].action!.to, "http://lifeos.local");
    expect(action.searchParams.get("create")).toBe("review");
    expect(action.searchParams.get("reviewType")).toBe("weekly");
    expect(action.searchParams.get("reviewAnchor")).toBe("2026-10-18");
    expect(due([], { ...scheduled, reviewSchedule: { ...scheduled.reviewSchedule!, startOn: "2026-10-20" } })).toEqual([]);
    expect(due([], { ...scheduled, reviewSchedule: { ...scheduled.reviewSchedule!, startOn: "2027-01-01" } })).toEqual([]);
  });

  it("uses calendar waiting boundaries and never falls back to earlier missed periods after completion", () => {
    const preferences: AttentionSettings = { ...scheduled,
      reviewSchedule: { startOn: "2026-10-12", types: ["weekly"], waitDays: 2 } };
    expect(due([], preferences, new Date("2026-10-19T23:59:59.999"))).toEqual([]);
    expect(due([], preferences, new Date("2026-10-20T00:00:00"))).toHaveLength(1);
    const complete = { ...draft, structure: { ...draft.structure!, status: "completed" as const } };
    expect(due([complete], preferences)).toEqual([]);
    expect(due([{ ...complete, structure: createReviewStructure("weekly", "2026-10-11") }], preferences))
      .toHaveLength(1);
  });

  it("handles annual and leap-day boundaries with daily reminders only explicitly selected", () => {
    const preferences: AttentionSettings = { ...scheduled, reviewSchedule: {
      startOn: "2024-01-01", types: ["annual", "daily"], waitDays: 1,
    } };
    const annual = due([], preferences, new Date("2026-01-01T00:00:00"))
      .find(signal => signal.id === "review-due:annual:2025-01-01");
    expect(annual?.summary).toContain("2025-01-01 至 2025-12-31");
    expect(new URL(annual!.action!.to, "http://lifeos.local").searchParams.get("reviewAnchor")).toBe("2025-12-31");
    const leapDay = due([], preferences, new Date("2024-03-01T00:00:00"))
      .find(signal => signal.kind === "review-due");
    expect(leapDay?.id).toBe("review-due:daily:2024-02-29");
    expect(leapDay?.baseline).toContain("2024-03-01");
  });

  it("accepts one completion in the explicit scope, not an unrelated domain or unclassified record", () => {
    const preferences: AttentionSettings = { ...scheduled, reviewSchedule: {
      startOn: "2026-10-12", types: ["weekly"], waitDays: 1,
    }, rules: { "review-due": { enabled: true, scope: "domains", domainIds: ["work", "家 &1"] } } };
    const complete = { ...draft, structure: { ...draft.structure!, status: "completed" as const } };
    expect(due([complete], preferences)).toEqual([]);
    expect(due([{ ...complete, domainIds: ["unrelated"] }], preferences)).toHaveLength(1);
    expect(due([{ ...complete, structure: null }], preferences)).toHaveLength(1);
    expect(due([{ ...complete, updatedAt: new Date(now.getTime() + 1).toISOString() }], preferences)).toHaveLength(1);
    expect(due([], { ...preferences, rules: {
      "review-due": { enabled: true, scope: "domains", domainIds: [] },
    } })).toEqual([]);
    const action = new URL(due([], preferences)[0].action!.to, "http://lifeos.local");
    expect(action.searchParams.getAll("reviewDomain")).toEqual(["work", "家 &1"]);
  });

  it("combines overlapping draft evidence into one node and restores independent drafts when disabled", () => {
    const preferences: AttentionSettings = { ...scheduled,
      reviewSchedule: { startOn: "2026-10-12", types: ["weekly"], waitDays: 1 } };
    const result = signals([draft], preferences);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("review-due");
    expect(result[0].action).toBeUndefined();
    expect(result[0].sources[1].id).toBe(draft.id);
    expect(signals([draft], { ...preferences, rules: {
      "review-due": { enabled: false, scope: "all", domainIds: [] },
    } }).map(signal => signal.kind)).toEqual(["review-draft"]);
    expect(due([], { ...preferences, reviewSchedule: { ...preferences.reviewSchedule!, types: [] } })).toEqual([]);
  });

  it("round-trips explicit schedule metadata and rejects incomplete or corrupt saved schedules", async () => {
    const { service, system } = stubService();
    await service().setSettings(scheduled);
    expect(await service().getSettings()).toEqual(scheduled);
    const invalid = [
      null, {}, { startOn: "2026-02-30", types: ["weekly"], waitDays: 1 },
      { startOn: "2026-10-12", types: ["weekly", "weekly"], waitDays: 1 },
      { startOn: "2026-10-12", types: ["other"], waitDays: 1 },
      { startOn: "2026-10-12", types: ["weekly"], waitDays: 0 },
      { startOn: "2026-10-12", types: ["weekly"], waitDays: "1" },
      { startOn: "2026-10-12", types: ["weekly"], waitDays: 1, extra: true },
    ];
    for (const reviewSchedule of invalid) {
      await system.setMetadata("m5_attention_settings", JSON.stringify({ ...settings, reviewSchedule }));
      await expect(service().getSettings()).rejects.toThrow("配置损坏");
    }
    await expect(service().setSettings({ ...scheduled, reviewSchedule: undefined })).rejects.toThrow("起始日期");
  });

  it("makes recurring settings explicit, retains failure edits and resets to off without saving", async () => {
    const { service } = stubService();
    const instance = service();
    const save = vi.spyOn(instance, "setSettings").mockRejectedValueOnce(new Error("private path"));
    const value = { attentionService: instance, lifeDomainService: { list: async () => [] } } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider, { value },
      createElement(AttentionSettingsEditor))));
    const region = within(await screen.findByRole("region", { name: "提醒规则" }));
    const toggle = await region.findByRole("checkbox", { name: "周期复盘节点", exact: true });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    fireEvent.change(region.getByLabelText("周期提醒起始日期"), { target: { value: "2026-10-12" } });
    fireEvent.change(region.getByLabelText("周期提醒等待（天）"), { target: { value: "3" } });
    const cycles = within(region.getByRole("group", { name: "定期提醒周期" }));
    expect((cycles.getByRole("checkbox", { name: "日复盘" }) as HTMLInputElement).checked).toBe(false);
    expect((cycles.getByRole("checkbox", { name: "周复盘" }) as HTMLInputElement).checked).toBe(true);
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(region.getByRole("button", { name: "保存规则" }));
    expect((await region.findByRole("alert")).textContent).toBe("提醒规则保存失败，请重试。");
    expect((region.getByLabelText("周期提醒等待（天）") as HTMLInputElement).value).toBe("3");
    fireEvent.click(region.getByRole("button", { name: "保存规则" }));
    await region.findByText("已保存");
    expect(await instance.getSettings()).toMatchObject({
      reviewSchedule: { startOn: "2026-10-12", types: ["weekly", "monthly"], waitDays: 3 },
    });
    fireEvent.click(region.getByRole("button", { name: "恢复默认" }));
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect((await instance.getSettings()).reviewSchedule?.waitDays).toBe(3);
  });

  it("shows a Chinese create link for a missing review and source evidence for the saved schedule", async () => {
    const { service, reviews } = stubService();
    reviews.list.mockResolvedValue([]);
    const instance = service();
    await instance.setSettings({ ...scheduled,
      reviewSchedule: { startOn: "2026-10-12", types: ["weekly"], waitDays: 1 },
    });
    const value = { attentionService: instance, lifeDomainService: { list: async () => [] } } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider, { value },
      createElement(AttentionPage))));
    await screen.findByRole("heading", { name: "周复盘节点" });
    const action = screen.getByRole("link", { name: "开始周复盘" });
    const target = new URL(action.getAttribute("href")!, "http://lifeos.local");
    expect(target.searchParams.get("reviewType")).toBe("weekly");
    expect(target.searchParams.get("reviewAnchor")).toBe("2026-10-18");
    fireEvent.click(screen.getByText("查看依据"));
    expect(screen.getByRole("link", { name: "已保存的周期复盘设置" }).getAttribute("href"))
      .toBe("/settings#settings-attention-title");
    expect(screen.getByText(/仅依据当前状态，不判断漏写原因或失败/)).toBeTruthy();
  });
});
