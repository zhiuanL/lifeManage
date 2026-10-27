import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { AttentionSettingsEditor } from "../../src/components/AttentionSettingsEditor";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import {
  defaultAttentionSettings, findAttentionSignals, validateAttentionSettings, type AttentionSettings,
} from "../../src/domain/attention/Attention";
import type { Decision } from "../../src/domain/decisions/Decision";
import type { Goal } from "../../src/domain/planning/Goal";
import type { ResourceNeed } from "../../src/domain/resources/Resources";
import { AttentionPage } from "../../src/pages/AttentionPage";
import { ResourcesPage } from "../../src/pages/ResourcesPage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteDecisionRepository } from "../../src/repositories/sqlite/SqliteDecisionRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteResourceNeedRepository } from "../../src/repositories/sqlite/SqliteResourceNeedRepository";
import { SqliteSystemRepository } from "../../src/repositories/sqlite/SqliteSystemRepository";
import { AttentionService } from "../../src/services/attention/AttentionService";
import type { DecisionService } from "../../src/services/decisions/DecisionService";
import type { DomainMetricService } from "../../src/services/life/DomainMetricService";
import type { IssueService } from "../../src/services/issues/IssueService";
import type { ActionService } from "../../src/services/planning/ActionService";
import type { GoalService } from "../../src/services/planning/GoalService";
import type { LifeRecordsService } from "../../src/services/records/LifeRecordsService";
import { ResourceService } from "../../src/services/resources/ResourceService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const now = new Date("2026-10-20T10:00:00");
const base = new Date("2026-08-01T09:00:00").toISOString();
const oldUpdate = new Date("2026-08-24T09:00:00").toISOString();
const week = 7 * 86400000;
const settings = { ...defaultAttentionSettings };
const goal: Goal = {
  id: "目标 &1", title: "准备重要项目", description: "", domainId: "work", domainIds: ["work"],
  parentId: null, status: "active", priority: "high", targetDate: null, sortOrder: 0,
  completedAt: null, createdAt: base, updatedAt: base,
};
const decision: Decision = {
  id: "决策 &1", title: "迁居计划", decidedOn: "2026-08-01", importance: "major",
  status: "considering", background: "", options: "", constraints: "", criteria: "", risks: "",
  opportunityCost: "", reversibility: "unknown", choice: "", rationale: "", executionConditions: "",
  outcome: "", reflection: "", goalId: goal.id, domainIds: ["home"], resourceNeedIds: ["需求 &1"],
  createdAt: base, updatedAt: base,
};
const need: ResourceNeed = {
  id: "需求 &1", goalId: goal.id, decisionId: null, kind: "time", description: "每周准备时间",
  skillId: null, personId: null, met: false, createdAt: base, updatedAt: oldUpdate,
};
const decisionNeed: ResourceNeed = {
  ...need, id: "决策需求 &1", goalId: null, decisionId: decision.id, kind: "finance", description: "搬迁预算",
};
function signals(
  needs: ResourceNeed[] = [need, decisionNeed],
  preferences: AttentionSettings = settings,
  goals: Goal[] = [goal],
  decisions: Decision[] = [decision],
  date = now,
) {
  return findAttentionSignals(goals, [], [], preferences, date, [], [], [], [], [], needs, decisions);
}

function stubService() {
  let metadata: string | null = null;
  const system = {
    getMetadata: async () => metadata,
    setMetadata: async (_key: string, value: string) => { metadata = value; },
    completeFirstInitialization: async () => {},
  };
  const resources = { list: vi.fn().mockResolvedValue([need, decisionNeed]) };
  const decisions = { list: vi.fn().mockResolvedValue([decision]) };
  const service = () => new AttentionService(
    { list: async () => [goal] } as unknown as GoalService,
    { list: async () => [], listPlanChanges: async () => [] } as unknown as ActionService,
    { list: async () => [] } as unknown as IssueService, system, { now: () => now },
    { listDefinitions: async () => [], listRecords: async () => [] } as unknown as DomainMetricService,
    { list: async () => [], listLogs: async () => [] }, resources, decisions, { list: async () => [] },
    { listEvents: async () => [] },
  );
  return { service, system, resources, decisions };
}

describe("V1 current resource gaps and record update age", () => {
  it("groups facts by their strong owner without copying references or claiming continuous shortage", () => {
    const another = { ...need, id: "需求 &2", kind: "energy" as const, description: "可用精力" };
    const inputs = [need, decisionNeed, another];
    const original = structuredClone(inputs);
    const result = signals(inputs);
    expect(result.map(signal => signal.id)).toEqual([
      `resource-gap:goal:${goal.id}`, `resource-gap:decision:${decision.id}`,
    ]);
    expect(result[0].summary).toContain("2 项资源需求当前标记为待补齐");
    expect(result[1].summary).toContain("1 项资源需求当前标记为待补齐");
    expect(result[0].domainIds).toEqual(["work"]);
    expect(result[1].domainIds).toEqual(["home"]);
    expect(result[0].sources).toHaveLength(3);
    expect(result[1].sources).toHaveLength(2);
    expect(result[1].sources.some(source => source.id === need.id)).toBe(false);
    expect(result[0].baseline).toContain("不代表持续不足时长");
    expect(result[0].rule).toContain("进行中的高优先级目标或待决重大决策");
    expect(result[0].period).toBe("2026-08-24 至 2026-10-20");
    expect(result[0].sources[1]).toMatchObject({
      path: "/resources", fragment: `resource-${need.id}`, date: need.updatedAt,
    });
    expect(inputs).toEqual(original);
  });

  it("defaults to important live nodes while an explicit all scope includes ordinary live nodes", () => {
    const ordinaryGoal = { ...goal, priority: "medium" as const };
    const ordinaryDecision = { ...decision, importance: "ordinary" as const };
    expect(signals([need, decisionNeed], settings, [ordinaryGoal], [ordinaryDecision])).toEqual([]);
    const all: AttentionSettings = { ...settings, resourceNodeScope: "all" };
    expect(signals([need, decisionNeed], all, [ordinaryGoal], [ordinaryDecision])).toHaveLength(2);
    expect(signals([need, decisionNeed], all, [{ ...goal, priority: undefined }], [ordinaryDecision]))
      .toHaveLength(2);
    for (const status of ["candidate", "paused", "completed", "abandoned", "archived"] as const) {
      expect(signals([need], all, [{ ...goal, status }], [])).toEqual([]);
    }
    expect(signals([decisionNeed], all, [], [{ ...decision, status: "decided", choice: "搬迁" }])).toEqual([]);
    expect(signals([need], settings, [], [])).toEqual([]);
  });

  it("uses exact elapsed weeks since the last edit, not creation date or a status transition", () => {
    const boundary = { ...need, updatedAt: new Date(now.getTime() - 4 * week).toISOString() };
    expect(signals([boundary], settings, [goal], [], new Date(now.getTime() - 1))).toEqual([]);
    expect(signals([boundary], settings, [goal], [])).toHaveLength(1);
    expect(signals([{ ...need, updatedAt: now.toISOString() }])).toEqual([]);
    expect(signals([{ ...need, met: true }])).toEqual([]);
    expect(signals([{ ...need, met: "false" as unknown as boolean }])).toEqual([]);
    expect(signals([need], { ...settings, resourceIdleWeeks: 9 })).toEqual([]);
    expect(signals([need], { ...settings, resourceIdleWeeks: 8 })).toHaveLength(1);
  });

  it("ignores invalid dates, future updates and inconsistent or missing strong ownership", () => {
    const invalid: ResourceNeed[] = [
      { ...need, updatedAt: "2026-09-31T09:00:00Z" },
      { ...need, updatedAt: "not a timestamp" },
      { ...need, updatedAt: new Date(now.getTime() + 1).toISOString() },
      { ...need, createdAt: now.toISOString() },
      { ...need, createdAt: "2026-07-01T09:00:00Z" },
      { ...need, goalId: "missing" },
      { ...need, goalId: null, decisionId: null },
      { ...need, decisionId: decision.id },
      { ...need, kind: "unknown" as ResourceNeed["kind"] },
    ];
    expect(signals(invalid)).toEqual([]);
    expect(signals([need], settings, [{ ...goal, createdAt: "invalid" }], [])).toEqual([]);
  });

  it("uses only the owner's explicit domains and never broadens an empty selected scope", () => {
    const scoped: AttentionSettings = { ...settings, rules: {
      "resource-gap": { enabled: true, scope: "domains", domainIds: ["work"] },
    } };
    expect(signals(undefined, scoped).map(signal => signal.id)).toEqual([`resource-gap:goal:${goal.id}`]);
    expect(signals([decisionNeed], scoped, [goal], [{ ...decision, domainIds: [] }])).toEqual([]);
    expect(signals([need], scoped, [{ ...goal, domainIds: [] }], [])).toEqual([]);
    expect(signals(undefined, { ...settings, rules: {
      "resource-gap": { enabled: true, scope: "domains", domainIds: [] },
    } })).toEqual([]);
    expect(signals(undefined, { ...settings, rules: {
      "resource-gap": { enabled: false, scope: "all", domainIds: [] },
    } })).toEqual([]);
  });

  it("keeps legacy settings, rejects corrupt new fields and does not silently turn them into defaults", async () => {
    const { service, system } = stubService();
    expect(await service().getSettings()).toEqual(settings);
    const saved: AttentionSettings = { ...settings, resourceIdleWeeks: 8, resourceNodeScope: "all" };
    await service().setSettings(saved);
    expect(await service().getSettings()).toEqual(saved);
    await expect(service().setSettings({ ...saved, resourceIdleWeeks: 0 })).rejects.toThrow("1–52");
    expect(await service().getSettings()).toEqual(saved);
    for (const invalid of [0, 53, 1.5, NaN]) {
      expect(() => validateAttentionSettings({ ...settings, resourceIdleWeeks: invalid })).toThrow();
    }
    for (const field of [{ resourceIdleWeeks: "4" }, { resourceNodeScope: "unknown" },
      { resourceIdleWeeks: null }, { resourceNodeScope: null }]) {
      await system.setMetadata("m5_attention_settings", JSON.stringify({ ...settings, ...field }));
      await expect(service().getSettings()).rejects.toThrow("配置损坏");
    }
  });

  it("surfaces a failed new reader without exposing database paths and permits explicit retry", async () => {
    const { service, resources, decisions } = stubService();
    resources.list.mockRejectedValueOnce(new Error("SQLITE_BUSY: C:/private/path"));
    await expect(service().getSnapshot()).rejects.toThrow("资源需求读取失败，请重新查看。");
    expect((await service().getSnapshot()).signals).toHaveLength(2);
    decisions.list.mockRejectedValueOnce(new Error("SQLITE_BUSY: C:/private/path"));
    await expect(service().getSnapshot()).rejects.toThrow("决策记录读取失败，请重新查看。");
    expect((await service().getSnapshot()).signals).toHaveLength(2);
  });

  for (const mode of ["SQLite", "preview"] as const) {
    it(`${mode} reads persisted resource state and shares metadata across fresh service instances`, async () => {
      const db = mode === "SQLite" ? new DatabaseSync(":memory:") : null;
      const sql = db ? nativeSqliteExecutor(db) : new MemorySqliteExecutor();
      let clockDate = new Date(oldUpdate);
      const clock = { now: () => clockDate };
      const ids = { next: () => "持久需求 &1" };
      try {
        db?.exec("PRAGMA foreign_keys=ON");
        await new MigrationRunner(sql, migrations, clock).run();
        const goalRepo = new SqliteGoalRepository(sql);
        const decisionRepo = new SqliteDecisionRepository(sql);
        await goalRepo.create({ ...goal, domainId: null, domainIds: [] });
        await decisionRepo.create({ ...decision, domainIds: [], resourceNeedIds: [] });
        const goals = {
          list: () => goalRepo.list(), findById: (id: string) => goalRepo.findById(id),
        } as unknown as GoalService;
        const resources = new ResourceService(new SqliteResourceNeedRepository(sql), goals,
          {} as LifeRecordsService, clock, ids, decisionRepo);
        const recorded = await resources.save({ ...need, goalId: null, decisionId: decision.id });
        clockDate = now;
        const system = new SqliteSystemRepository(sql, clock);
        const service = () => new AttentionService(goals,
          { list: async () => [], listPlanChanges: async () => [] } as unknown as ActionService,
          { list: async () => [] } as unknown as IssueService, system, clock,
          { listDefinitions: async () => [], listRecords: async () => [] } as unknown as DomainMetricService,
          { list: async () => [], listLogs: async () => [] }, resources,
          { list: () => decisionRepo.list() } as unknown as DecisionService, { list: async () => [] },
          { listEvents: async () => [] });
        expect((await service().getSnapshot()).signals[0].id).toBe(`resource-gap:decision:${decision.id}`);
        const saved: AttentionSettings = { ...settings, resourceIdleWeeks: 9, resourceNodeScope: "all" };
        await service().setSettings(saved);
        expect(await service().getSettings()).toEqual(saved);
        expect((await service().getSnapshot()).signals).toEqual([]);
        await service().setSettings({ ...settings });
        await resources.save({ ...recorded, met: true }, recorded.id);
        expect((await service().getSnapshot()).signals).toEqual([]);
        await resources.save({ ...recorded, met: false }, recorded.id);
        expect((await service().getSnapshot()).signals).toEqual([]);
        expect((await resources.list())[0]).toMatchObject({ met: false, updatedAt: now.toISOString() });
        await new MigrationRunner(sql, migrations, clock).run();
        expect(await service().getSettings()).toEqual(settings);
        expect(await resources.list()).toHaveLength(1);
        if (db) expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally { db?.close(); }
    });
  }

  it("shows Chinese facts and encoded source links, with a resource read failure retry", async () => {
    const { service, resources } = stubService();
    resources.list.mockRejectedValueOnce(new Error("private path"));
    const value = {
      attentionService: service(), lifeDomainService: { list: async () => [] },
    } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider, { value },
      createElement(AttentionPage))));
    await screen.findByRole("heading", { name: "暂时无法打开注意事项" });
    expect(screen.getByRole("alert").textContent).toBe("无法读取注意事项，请重试。已有记录不会被修改。");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("heading", { name: goal.title });
    expect(screen.getAllByText("当前待补齐与最后更新记录")).toHaveLength(2);
    for (const details of screen.getAllByText("查看依据")) fireEvent.click(details);
    const source = screen.getByRole("link", { name: "时间 · 每周准备时间（当前待补齐）" });
    expect(source.getAttribute("href")).toBe(`/resources#${encodeURIComponent(`resource-${need.id}`)}`);
    const owner = screen.getByRole("link", { name: decision.title });
    expect(owner.getAttribute("href")).toBe(`/decisions#${encodeURIComponent(`decision-${decision.id}`)}`);
    expect(screen.getAllByText(/不代表持续不足时长/)).toHaveLength(2);
  });

  it("decodes a Chinese resource fragment and ignores malformed fragments without losing the page", async () => {
    const scroll = vi.fn();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true, value: function(this: HTMLElement) { scroll(this.id); },
    });
    const value = {
      resourceService: { list: async () => [need] },
      lifeRecordsService: { listPeople: async () => [], listSkills: async () => [] },
      lifeDomainService: { list: async () => [] }, goalService: { list: async () => [goal] },
      actionService: { list: async () => [] }, decisionService: { list: async () => [] },
      domainMetricService: { listDefinitions: async () => [], listRecords: async () => [] },
    } as unknown as LifeOSContextValue;
    try {
      for (const hash of [`#${encodeURIComponent(`resource-${need.id}`)}`, "#%E0%A4%A"]) {
        scroll.mockClear();
        const page = render(createElement(MemoryRouter, { initialEntries: [`/resources${hash}`] },
          createElement(LifeOSContext.Provider, { value }, createElement(ResourcesPage))));
        await screen.findByRole("heading", { name: "资源总览" });
        expect(document.getElementById(`resource-${need.id}`)).toBeTruthy();
        if (hash === "#%E0%A4%A") expect(scroll).not.toHaveBeenCalled();
        else await waitFor(() => expect(scroll).toHaveBeenCalledWith(`resource-${need.id}`));
        page.unmount();
      }
    } finally {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  it("requires explicit saving, preserves a failed scope draft and restores defaults only on save", async () => {
    const { service } = stubService();
    const instance = service();
    const save = vi.spyOn(instance, "setSettings").mockRejectedValueOnce(new Error("private path"));
    const value = { attentionService: instance, lifeDomainService: { list: async () => [] } } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider, { value },
      createElement(AttentionSettingsEditor))));
    const rules = within(await screen.findByRole("region", { name: "提醒规则" }));
    const input = await rules.findByLabelText("资源记录未更新观察期（周）");
    const select = rules.getByLabelText("资源观察对象");
    expect((input as HTMLInputElement).value).toBe("4");
    expect((select as HTMLSelectElement).value).toBe("important");
    expect(rules.getByRole("checkbox", { name: "待补齐资源记录长期未更新" })).toBeTruthy();
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.change(select, { target: { value: "all" } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(rules.getByRole("button", { name: "保存规则" }));
    expect((await rules.findByRole("alert")).textContent).toBe("提醒规则保存失败，请重试。");
    expect((input as HTMLInputElement).value).toBe("8");
    expect((select as HTMLSelectElement).value).toBe("all");
    fireEvent.click(rules.getByRole("button", { name: "保存规则" }));
    await rules.findByText("已保存");
    expect(await instance.getSettings()).toMatchObject({ resourceIdleWeeks: 8, resourceNodeScope: "all" });
    fireEvent.click(rules.getByRole("button", { name: "恢复默认" }));
    expect((input as HTMLInputElement).value).toBe("4");
    expect((select as HTMLSelectElement).value).toBe("important");
    expect((await instance.getSettings()).resourceIdleWeeks).toBe(8);
    fireEvent.click(rules.getByRole("button", { name: "保存规则" }));
    await rules.findByText("已保存");
    expect(await instance.getSettings()).toEqual(settings);
  });
});
