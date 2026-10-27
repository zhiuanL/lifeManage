import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { buildAnalytics, type AnalyticsData } from "../../src/domain/analytics/Analytics";
import { buildAnalyticsComparison } from "../../src/domain/analytics/AnalyticsComparison";
import type { MetricDefinition, MetricRecord } from "../../src/domain/life/DomainMetric";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";
import type { Action } from "../../src/domain/planning/Action";
import type { Goal } from "../../src/domain/planning/Goal";
import { AnalyticsPage } from "../../src/pages/AnalyticsPage";
import { AnalyticsService } from "../../src/services/analytics/AnalyticsService";

afterEach(cleanup);
const now = new Date("2026-10-22T12:00:00");
const timestamp = "2026-10-22T09:00:00";
const healthId = "health/中文";
const workId = "work";
const domains: LifeDomain[] = [healthId, workId].map((id, index) => ({
  id, name: index ? "工作" : "健康", description: "", focus: "", currentState: "",
  longTermExpectation: "", color: "fern", icon: "heart", status: "active",
  sortOrder: index, createdAt: timestamp, updatedAt: timestamp,
}));
const goal: Goal = {
  id: "goal/中文", title: "恢复节奏", description: "", domainId: healthId, domainIds: [healthId],
  status: "completed", targetDate: null, sortOrder: 0, completedAt: timestamp,
  createdAt: timestamp, updatedAt: timestamp,
};
function action(id: string, domainIds: string[], goalId: string | null = null): Action {
  return { id, title: id, notes: "", domainId: domainIds[0] ?? null, domainIds, goalId,
    status: "completed", scheduledFor: "2026-10-21", completedAt: timestamp,
    sortOrder: 0, createdAt: timestamp, updatedAt: timestamp };
}
const data: AnalyticsData = {
  goals: [goal], actions: [
    action("共享行动/中文", [healthId, workId]), action("关联目标行动", [], goal.id),
    action("全局行动", []), action("工作行动", [workId]),
  ], reviews: [], issues: [], habits: [], habitLogs: [],
  planChanges: [], completionPlans: [], stateEvents: [],
};
const definitions: MetricDefinition[] = [
  { id: "sleep", name: "睡眠", unit: "小时", domainIds: [healthId, workId], archived: false, createdAt: timestamp },
  { id: "mood", name: "情绪", unit: "分", domainIds: [healthId], archived: false, createdAt: timestamp },
  { id: "empty", name: "活动", unit: "分钟", domainIds: [workId], archived: false, createdAt: timestamp },
  { id: "global", name: "全局指标", unit: "次", domainIds: [], archived: false, createdAt: timestamp },
];
const records: MetricRecord[] = [
  { id: "record/中文", metricId: "sleep", recordedOn: "2026-10-21", value: 7,
    note: "原始说明", createdAt: timestamp, updatedAt: timestamp },
  { id: "mood-record", metricId: "mood", recordedOn: "2026-10-22", value: 3,
    note: "", createdAt: timestamp, updatedAt: timestamp },
  { id: "future", metricId: "sleep", recordedOn: "2026-10-23", value: 8,
    note: "", createdAt: timestamp, updatedAt: timestamp },
];

function context() {
  const loadData = vi.fn(async () => data);
  const summarize = vi.fn<LifeOSContextValue["analyticsService"]["summarize"]>(
    (facts, filter) => buildAnalytics(facts, filter, now));
  const compare = vi.fn<LifeOSContextValue["analyticsService"]["compare"]>(
    (facts, filter) => buildAnalyticsComparison(facts, filter, now));
  return {
    loadData, summarize, compare,
    app: { analyticsService: { loadData, summarize, compare },
      lifeDomainService: { list: vi.fn(async () => domains) },
      domainMetricService: { listDefinitions: vi.fn(async () => definitions),
        listRecords: vi.fn(async () => records) },
    } as unknown as LifeOSContextValue,
  };
}
function LocationProbe() {
  const location = useLocation();
  return <output aria-label="当前位置">{location.pathname}{location.search}{location.hash}</output>;
}
const comparisonUrl = `/analytics?view=compare&compareDomain=${encodeURIComponent(healthId)}&compareDomain=work&weeks=4`;
function Frame({ app, url = comparisonUrl }: { app: LifeOSContextValue; url?: string }) {
  return <MemoryRouter initialEntries={[url]}>
    <LifeOSContext.Provider value={app}><AnalyticsPage /><LocationProbe /></LifeOSContext.Provider>
  </MemoryRouter>;
}

describe("V1 domain comparison facts", () => {
  it("reuses the single-domain rules at one instant, deduplicates selections, and has no global total", () => {
    const rows = buildAnalyticsComparison(data,
      { domainIds: [healthId, workId, healthId], goalId: null, weeks: 4 }, now);
    expect(rows.map(row => row.domainId)).toEqual([healthId, workId]);
    for (const row of rows) expect(row.snapshot).toEqual(buildAnalytics(data,
      { domainId: row.domainId, goalId: null, weeks: 4 }, now));
    expect(rows[0].snapshot.weeks.at(-1)?.completed.map(item => item.id))
      .toEqual(["共享行动/中文", "关联目标行动"]);
    expect(rows[1].snapshot.weeks.at(-1)?.completed.map(item => item.id))
      .toEqual(["共享行动/中文", "工作行动"]);
    expect(rows[0].snapshot.weeks.map(week => [week.start, week.end]))
      .toEqual(rows[1].snapshot.weeks.map(week => [week.start, week.end]));
    expect(buildAnalyticsComparison(data, { domainIds: [], goalId: null, weeks: 4 }, now)).toEqual([]);
    expect(() => buildAnalyticsComparison(data, { domainIds: [""], goalId: null, weeks: 4 }, now))
      .toThrow("明确的对比领域");
  });

  it("reads the service clock once and never reloads or persists records while comparing", () => {
    const dependencies = {
      goals: { list: vi.fn() }, actions: { list: vi.fn() }, reviews: { list: vi.fn() },
      issues: { list: vi.fn() }, habits: { list: vi.fn() },
    };
    const clock = { now: vi.fn().mockReturnValueOnce(now)
      .mockReturnValue(new Date("2026-10-26T00:01:00")) };
    type Args = ConstructorParameters<typeof AnalyticsService>;
    const service = new AnalyticsService(dependencies.goals as unknown as Args[0],
      dependencies.actions as unknown as Args[1], dependencies.reviews as unknown as Args[2],
      dependencies.issues as unknown as Args[3], clock, dependencies.habits as unknown as Args[5]);
    const rows = service.compare(data, { domainIds: [healthId, workId], goalId: null, weeks: 4 });
    expect(clock.now).toHaveBeenCalledTimes(1);
    expect(rows[0].snapshot.weeks).toHaveLength(4);
    expect(rows[0].snapshot.weeks.at(-1)?.end).toBe("2026-10-22");
    expect(rows[1].snapshot.weeks.at(-1)?.end).toBe("2026-10-22");
    for (const dependency of Object.values(dependencies)) expect(dependency.list).not.toHaveBeenCalled();
  });

  it("does not attribute a selected goal to an unrelated compared domain", () => {
    const rows = buildAnalyticsComparison(data,
      { domainIds: [healthId, workId], goalId: goal.id, weeks: 4 }, now);
    expect(rows[0].snapshot.weeks.at(-1)?.completed.map(item => item.id)).toEqual(["关联目标行动"]);
    expect(rows[1].snapshot.weeks.every(week => week.completed.length === 0)).toBe(true);
  });
});

describe("V1 Chinese comparison interface", () => {
  it("keeps shared records and original metric units without a combined total or missing-value fill", async () => {
    const services = context();
    render(<Frame app={services.app} />);
    await screen.findByRole("heading", { name: "同周期领域记录" });
    expect(services.summarize).not.toHaveBeenCalled();
    expect(services.compare).toHaveBeenCalledWith(data,
      { domainIds: [healthId, workId], goalId: null, weeks: 4 });
    const table = screen.getByRole("table", { name: /同一观察周期的领域事实/ });
    expect(within(table).queryByText("合计")).toBeNull();
    expect(within(table).getAllByText("无可核验安排")).toHaveLength(2);
    expect(screen.getAllByRole("heading", { name: "睡眠 (小时)" })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "情绪 (分)" })).toBeTruthy();
    expect(screen.getByText("活动（分钟）· 本周期未记录")).toBeTruthy();
    expect(screen.queryByText("全局指标")).toBeNull();
    expect(screen.queryByText(/2026-10-23/)).toBeNull();
    const sleep = screen.getByRole("heading", { name: "睡眠 (小时)" }).closest(".metric-trend")!;
    fireEvent.click(within(sleep as HTMLElement).getByText("查看来源 (1)"));
    expect(screen.getByRole("link", { name: "2026-10-21 · 7 小时" }).getAttribute("href"))
      .toBe(`/metrics#metric-record-${encodeURIComponent("record/中文")}`);
    fireEvent.click(screen.getAllByText("查看记录")[0]);
    expect(screen.getAllByRole("link", { name: "共享行动/中文" })[0].getAttribute("href"))
      .toBe(`/goals#action-${encodeURIComponent("共享行动/中文")}`);
  });

  it("preserves encoded domain selections, repeated unrelated parameters and hash when changing filters", async () => {
    const services = context();
    render(<Frame app={services.app} url={`${comparisonUrl}&extra=a&extra=b#comparison-weeks-heading`} />);
    await screen.findByRole("heading", { name: "同周期领域记录" });
    fireEvent.change(screen.getByLabelText("观察周期"), { target: { value: "12" } });
    const location = new URL(screen.getByLabelText("当前位置").textContent!, "http://localhost");
    expect(location.searchParams.getAll("compareDomain")).toEqual([healthId, workId]);
    expect(location.searchParams.getAll("extra")).toEqual(["a", "b"]);
    expect(location.searchParams.get("weeks")).toBe("12");
    expect(location.hash).toBe("#comparison-weeks-heading");
    fireEvent.click(screen.getByRole("button", { name: "多领域对比" }));
    expect(screen.getByLabelText("健康")).toHaveProperty("checked", true);
    expect(screen.getByLabelText("工作")).toHaveProperty("checked", true);
    fireEvent.click(screen.getByLabelText("工作"));
    expect(screen.getByText("尚未选择两个对比领域。")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByLabelText("健康"));
    expect(services.compare).toHaveBeenLastCalledWith(data, { domainIds: [], goalId: null, weeks: 12 });
    expect(screen.queryByRole("table")).toBeNull();
  });

  it.each(["missing", ""])( "blocks an invalid compared domain %j until explicitly cleared", async missing => {
    const services = context();
    render(<Frame app={services.app}
      url={`${comparisonUrl}&compareDomain=${missing}&extra=a&extra=b#source`} />);
    await screen.findByRole("heading", { name: "无法按当前条件分析" });
    expect(services.compare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
    await screen.findByRole("heading", { name: "同周期领域记录" });
    const location = new URL(screen.getByLabelText("当前位置").textContent!, "http://localhost");
    expect(location.searchParams.getAll("compareDomain")).toEqual([healthId, workId]);
    expect(location.searchParams.getAll("extra")).toEqual(["a", "b"]);
    expect(location.hash).toBe("#source");
  });

  it("marks unassociated domains explicitly and clears a goal only when its final selected domain is removed", async () => {
    const services = context();
    render(<Frame app={services.app} url={`${comparisonUrl}&goal=${encodeURIComponent(goal.id)}`} />);
    await screen.findByRole("heading", { name: "同周期领域记录" });
    expect(screen.getAllByText("目标未关联该领域").length).toBeGreaterThan(0);
    expect(screen.getByText("当前选择了目标；领域指标不归属于目标。")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("工作"));
    expect(screen.getByLabelText("关联目标")).toHaveProperty("value", goal.id);
    fireEvent.click(screen.getByLabelText("健康"));
    expect(screen.getByLabelText("关联目标")).toHaveProperty("value", "");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("enters comparison with only the explicit single domain and restores ordinary analysis deliberately", async () => {
    const services = context();
    render(<Frame app={services.app}
      url={`/analytics?domain=${encodeURIComponent(healthId)}&goal=${encodeURIComponent(goal.id)}&weeks=4&extra=a&extra=b#source`} />);
    await screen.findByRole("heading", { name: "分析", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "多领域对比" }));
    expect(screen.getByLabelText("健康")).toHaveProperty("checked", true);
    expect(screen.getByLabelText("工作")).toHaveProperty("checked", false);
    expect(screen.getByLabelText("关联目标")).toHaveProperty("value", "");
    fireEvent.click(screen.getByLabelText("工作"));
    expect(screen.getByRole("heading", { name: "同周期领域记录" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "记录分析" }));
    expect(screen.getByLabelText("生活领域")).toHaveProperty("value", "");
    const location = new URL(screen.getByLabelText("当前位置").textContent!, "http://localhost");
    expect(location.searchParams.has("compareDomain")).toBe(false);
    expect(location.searchParams.getAll("extra")).toEqual(["a", "b"]);
    expect(location.hash).toBe("#source");
  });

  it("retains comparison selection through a failed read and retry without exposing storage details", async () => {
    const services = context();
    services.loadData.mockRejectedValueOnce(new Error("SQLITE_BUSY C:\\private\\lifeos.db"));
    render(<Frame app={services.app} />);
    await screen.findByText("分析数据读取失败，请重试。");
    expect(screen.queryByText(/SQLITE_BUSY/)).toBeNull();
    expect(services.compare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("heading", { name: "同周期领域记录" });
    expect(screen.getByLabelText("健康")).toHaveProperty("checked", true);
    expect(screen.getByLabelText("工作")).toHaveProperty("checked", true);
  });

  it("does not render an old comparison after service replacement", async () => {
    const previous = context(), current = context();
    let resolve!: (facts: AnalyticsData) => void;
    current.loadData.mockReturnValueOnce(new Promise<AnalyticsData>(done => { resolve = done; }));
    const page = render(<Frame app={previous.app} />);
    await screen.findByRole("heading", { name: "同周期领域记录" });
    page.rerender(<Frame app={current.app} />);
    expect(screen.queryByRole("heading", { name: "同周期领域记录" })).toBeNull();
    expect(current.compare).not.toHaveBeenCalled();
    await act(async () => resolve(data));
    await screen.findByRole("heading", { name: "同周期领域记录" });
    expect(current.compare).toHaveBeenCalledWith(data,
      { domainIds: [healthId, workId], goalId: null, weeks: 4 });
  });
});
