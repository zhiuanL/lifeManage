import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { DomainMetricsSection } from "../../src/components/DomainMetricsSection";
import { buildAnalytics, type AnalyticsData } from "../../src/domain/analytics/Analytics";
import type { Issue } from "../../src/domain/issues/Issue";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";
import type { Action } from "../../src/domain/planning/Action";
import type { Goal } from "../../src/domain/planning/Goal";
import type { Review } from "../../src/domain/reviews/Review";
import { AnalyticsPage } from "../../src/pages/AnalyticsPage";
import type { AnalyticsService } from "../../src/services/analytics/AnalyticsService";
import type { LifeDomainService } from "../../src/services/life/LifeDomainService";

afterEach(cleanup);

const now = new Date("2026-09-23T12:00:00");
const filter = { weeks: 4 as const, domainId: "health", goalId: null };
const emptyMetrics = {
  listDefinitions: vi.fn().mockResolvedValue([]),
  listRecords: vi.fn().mockResolvedValue([]),
};

function goal(overrides: Partial<Goal> = {}): Goal {
  const domainId = overrides.domainId === undefined ? "health" : overrides.domainId;
  return {
    id: "goal", title: "健康目标", description: "", domainId,
    domainIds: domainId ? [domainId] : [],
    status: "completed", targetDate: null, sortOrder: 0,
    completedAt: "2026-09-23T09:00:00", createdAt: "2026-08-01T09:00:00",
    updatedAt: "2026-09-23T09:00:00", ...overrides,
  };
}

function action(overrides: Partial<Action> = {}): Action {
  const domainId = overrides.domainId === undefined ? "health" : overrides.domainId;
  return {
    id: "action", title: "散步", notes: "", goalId: "goal", domainId,
    domainIds: domainId ? [domainId] : [],
    status: "completed", scheduledFor: "2026-09-21", completedAt: "2026-09-23T09:00:00",
    sortOrder: 0, createdAt: "2026-09-01T09:00:00", updatedAt: "2026-09-23T09:00:00",
    ...overrides,
  };
}

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: "review", title: "本周回顾", reflection: "", insight: "",
    nextFocus: "", domainId: "health", domainIds: ["health"], reviewedOn: "2026-09-23",
    createdAt: "2026-09-23T09:00:00", updatedAt: "2026-09-23T09:00:00",
    ...overrides,
  };
}

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue", title: "睡眠问题", description: "", firstSeen: "2026-08-01",
    occurrenceCount: 2, causeHypothesis: "", attempts: "", followUp: "",
    status: "open", goalId: "goal", domainIds: ["health", "work"],
    createdAt: "2026-08-01T09:00:00", updatedAt: "2026-09-23T09:00:00",
    ...overrides,
  };
}

const data: AnalyticsData = {
  planChanges: [],
  completionPlans: [],
  stateEvents: [],
  goals: [goal(), goal({ id: "other", title: "工作目标", domainId: "work",
    completedAt: "2026-09-23T10:00:00" })],
  actions: [
    action(),
    action({ id: "late", title: "晚些完成", domainId: "work", scheduledFor: "2026-09-20",
      completedAt: "2026-09-22T09:00:00" }),
    action({ id: "unplanned", title: "临时行动", domainId: null, scheduledFor: null }),
    action({ id: "outside", goalId: "other", domainId: "work" }),
    action({ id: "future", status: "open", scheduledFor: "2026-09-24", completedAt: null }),
  ],
  reviews: [review(), review({ id: "edge", reviewedOn: "2026-08-31" }),
    review({ id: "earlier", reviewedOn: "2026-08-30" })],
  issues: [issue(), issue({ id: "linked", domainIds: [] }),
    issue({ id: "resolved", status: "resolved" }),
    issue({ id: "other", domainIds: ["work"], goalId: "other" })],
};

describe("M5 factual analysis", () => {
  it("uses local Monday boundaries, stops at today, and keeps planned dates separate from completion", () => {
    const summary = buildAnalytics(data, filter, now);
    expect(summary.weeks).toHaveLength(4);
    expect(summary.weeks[0]).toMatchObject({ start: "2026-08-31", end: "2026-09-06" });
    expect(summary.weeks[3]).toMatchObject({ start: "2026-09-21", end: "2026-09-23" });
    expect(summary.weeks[0].reviews.map((item) => item.id)).toEqual(["edge"]);
    expect(summary.weeks[2].planned.map((item) => item.id)).toEqual(["late"]);
    expect(summary.weeks[3].planned.map((item) => item.id)).toEqual(["action"]);
    expect(summary.weeks[3].completed.map((item) => item.id)).toEqual([
      "action", "late", "unplanned",
    ]);
    expect(summary.weeks[3].goalsCompleted.map((item) => item.id)).toEqual(["goal"]);
    expect(summary.weeks[3].reviews.map((item) => item.to)).toEqual(["/reviews#review-review"]);
    expect(summary.openIssues.map((item) => item.id)).toEqual(["issue", "linked"]);
  });

  it("keeps goal scope explicit; an unlinked review is not attributed to a goal", () => {
    const result = buildAnalytics(data, { ...filter, goalId: "goal" }, now);
    expect(result.weeks.every((week) => week.reviews.length === 0)).toBe(true);
    expect(result.weeks[3].planned.map((item) => item.id)).toEqual(["action"]);
    expect(result.weeks[3].completed.map((item) => item.id)).toEqual([
      "action", "late", "unplanned",
    ]);
    expect(result.openIssues.map((item) => item.id)).toEqual(["issue", "linked"]);
    const invalidGoal = buildAnalytics(data, { ...filter, goalId: "other" }, now);
    expect(invalidGoal.weeks.every((week) => !week.planned.length && !week.completed.length)).toBe(true);
    expect(invalidGoal.openIssues).toEqual([]);
  });

  it("shows unscheduled completions and counts neither future dates nor absent completion timestamps", () => {
    const sample = buildAnalytics({
      goals: [goal({ completedAt: null })], planChanges: [], completionPlans: [], stateEvents: [],
      actions: [action({ scheduledFor: null }),
        action({ id: "unknown", completedAt: null }),
        action({ id: "future", scheduledFor: "2026-09-24", status: "open", completedAt: null })],
      reviews: [], issues: [],
    }, filter, now);
    expect(sample.weeks[3].planned.map((item) => item.id)).toEqual(["unknown"]);
    expect(sample.weeks[3].completed.map((item) => item.id)).toEqual(["action"]);
    expect(sample.weeks[3].goalsCompleted).toEqual([]);
    expect(() => buildAnalytics(data, { ...filter, weeks: 2 as 4 }, now))
      .toThrow("观察周期");
  });

  it("uses the last recorded plan at completion and excludes subsequent edits or unknown old plans", () => {
    const summary = buildAnalytics({
      goals: [], reviews: [], issues: [], stateEvents: [],
      actions: [action({ id: "tracked", goalId: null, completedAt: "2026-09-23T08:00:00.000Z" }),
        action({ id: "old", goalId: null, completedAt: "2026-09-23T08:00:00.000Z" })],
      completionPlans: [{
        actionId: "tracked", completedAt: "2026-09-23T08:00:00.000Z",
        plannedDate: "2026-09-22",
      }],
      planChanges: [
        { id: 1, actionId: "tracked", beforeDate: null, afterDate: "2026-09-21",
          reason: "initial", note: "", changedAt: "2026-09-20T08:00:00.000Z",
          completedAtAtChange: null, domainId: "health", goalId: null },
        { id: 2, actionId: "tracked", beforeDate: "2026-09-21", afterDate: "2026-09-22",
          reason: "personal", note: "补一天", changedAt: "2026-09-22T08:00:00.000Z",
          completedAtAtChange: null, domainId: "health", goalId: null },
        { id: 3, actionId: "tracked", beforeDate: "2026-09-22", afterDate: "2026-09-24",
          reason: "external", note: "", changedAt: "2026-09-23T09:00:00.000Z",
          completedAtAtChange: "2026-09-23T08:00:00.000Z", domainId: "health", goalId: null },
        { id: 4, actionId: "tracked", beforeDate: "2026-09-24", afterDate: "2026-09-25",
          reason: "personal", note: "未来调整", changedAt: "2026-09-23T13:00:00.000Z",
          completedAtAtChange: "2026-09-23T08:00:00.000Z", domainId: "health", goalId: null },
      ],
    }, filter, new Date("2026-09-23T12:00:00Z"));
    expect(summary.comparisons).toEqual([expect.objectContaining({
      id: "tracked", plannedDate: "2026-09-22", actualDate: "2026-09-23",
      differenceDays: 1,
    })]);
    expect(summary.changes.map((change) => change.reason)).toEqual([
      "主动调整", "外部变化",
    ]);
    expect(summary.changes[0].to).toBe("/goals#action-tracked");
    expect(summary.changes.map((change) => change.id)).toEqual(["2", "3"]);
  });

  it("keeps plan changes in the action's current context and uses a completion snapshot at equal timestamps", () => {
    const completedAt = "2026-09-23T08:00:00.000Z";
    const source: AnalyticsData = {
      goals: [goal({ status: "active", completedAt: null })], stateEvents: [],
      reviews: [], issues: [],
      actions: [action({ id: "moved", goalId: "goal", domainId: "health", completedAt,
        scheduledFor: "2026-09-29" })],
      planChanges: [
        { id: 1, actionId: "moved", beforeDate: "2026-09-21", afterDate: "2026-09-22",
          reason: "external", note: "", changedAt: completedAt,
          completedAtAtChange: null, domainId: "work", goalId: null },
        { id: 2, actionId: "moved", beforeDate: "2026-09-22", afterDate: "2026-09-29",
          reason: "personal", note: "", changedAt: completedAt,
          completedAtAtChange: completedAt, domainId: "health", goalId: "goal" },
      ],
      completionPlans: [{ actionId: "moved", completedAt, plannedDate: "2026-09-22" }],
    };
    const observationTime = new Date("2026-09-23T12:00:00Z");
    const summary = buildAnalytics(source, { ...filter, goalId: "goal" }, observationTime);
    expect(summary.changes.map((change) => change.id)).toEqual(["1", "2"]);
    expect(summary.comparisons[0]).toMatchObject({
      plannedDate: "2026-09-22", actualDate: "2026-09-23", differenceDays: 1,
    });
    expect(buildAnalytics({ ...source, completionPlans: [] }, filter, observationTime).comparisons)
      .toEqual([]);
  });

  it("groups verified due dates separately, excludes today and respects current domain and goal links", async () => {
    const source: AnalyticsData = {
      ...data,
      actions: [
        action({ id: "done", completedAt: "2026-09-21T17:00:00" }),
        action({ id: "missed", status: "open", completedAt: null, scheduledFor: "2026-09-22" }),
        action({ id: "today", status: "open", completedAt: null, scheduledFor: "2026-09-23" }),
        action({ id: "elsewhere", goalId: "other", domainId: "work",
          status: "open", completedAt: null, scheduledFor: "2026-09-21" }),
      ],
      stateEvents: [
        { id: 1, actionId: "done", beforeStatus: null, afterStatus: "open",
          scheduledFor: "2026-09-21", changedAt: "2026-09-20T10:00:00" },
        { id: 2, actionId: "done", beforeStatus: "open", afterStatus: "completed",
          scheduledFor: "2026-09-21", changedAt: "2026-09-21T17:00:00" },
        { id: 3, actionId: "missed", beforeStatus: null, afterStatus: "open",
          scheduledFor: "2026-09-22", changedAt: "2026-09-20T10:00:00" },
        { id: 4, actionId: "today", beforeStatus: null, afterStatus: "open",
          scheduledFor: "2026-09-23", changedAt: "2026-09-20T10:00:00" },
        { id: 5, actionId: "elsewhere", beforeStatus: null, afterStatus: "open",
          scheduledFor: "2026-09-21", changedAt: "2026-09-20T10:00:00" },
      ],
    };
    const week = buildAnalytics(source, { ...filter, goalId: "goal" }, now).weeks[3];
    expect(week.due.map((item) => item.id)).toEqual(["done:2026-09-21", "missed:2026-09-22"]);
    expect(week.onTime.map((item) => item.to)).toEqual(["/goals#action-done"]);
    const value = {
      analyticsService: {
        loadData: vi.fn().mockResolvedValue(source),
        summarize: (records: AnalyticsData, selected: typeof filter) =>
          buildAnalytics(records, selected, now),
      },
      lifeDomainService: { list: vi.fn().mockResolvedValue([{ id: "health", name: "健康" }]) },
      domainMetricService: emptyMetrics,
    } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, { initialEntries: ["/analytics?domain=health&goal=goal&weeks=4"] },
      createElement(LifeOSContext.Provider, { value }, createElement(AnalyticsPage))));
    const heading = await screen.findByRole("heading", { name: "行动到期完成率" });
    const section = heading.closest("section")!;
    expect(section.textContent).toContain("50%");
    const evidence = section.querySelectorAll("summary");
    expect(evidence).toHaveLength(1);
    fireEvent.click(evidence[0]);
    expect(section.querySelectorAll('a[href="/goals#action-done"]')).toHaveLength(1);
    expect(section.querySelectorAll('a[href="/goals#action-missed"]')).toHaveLength(1);
  });

  it("offers date evidence and domain/goal controls in the Chinese workspace", async () => {
    const analyticsService = {
      loadData: vi.fn().mockResolvedValue(data),
      summarize: vi.fn().mockImplementation((source, selected) =>
        buildAnalytics(source, selected, now)),
    };
    const lifeDomainService = { list: vi.fn().mockResolvedValue([
      { id: "health", name: "健康" }, { id: "work", name: "事业" },
    ]) };
    const value = { analyticsService: analyticsService as Partial<AnalyticsService>,
      lifeDomainService: lifeDomainService as Partial<LifeDomainService>,
      domainMetricService: emptyMetrics,
    } as LifeOSContextValue;
    render(createElement(MemoryRouter, { initialEntries: ["/analytics?domain=health&weeks=4"] },
      createElement(LifeOSContext.Provider, { value }, createElement(AnalyticsPage))));

    expect(await screen.findByRole("heading", { name: "行动的排期与完成" })).toBeTruthy();
    expect((screen.getByLabelText("生活领域") as HTMLSelectElement).value).toBe("health");
    expect((screen.getByLabelText("观察周期") as HTMLSelectElement).value).toBe("4");
    expect(screen.queryByRole("option", { name: "工作目标" })).toBeNull();
    const evidence = screen.getAllByText("查看记录");
    fireEvent.click(evidence[evidence.length - 1]);
    expect(screen.getAllByRole("link", { name: "本周回顾" })
      .some((link) => link.getAttribute("href") === "/reviews#review-review")).toBe(true);
    fireEvent.change(screen.getByLabelText("关联目标"), { target: { value: "goal" } });
    await waitFor(() => expect(analyticsService.summarize).toHaveBeenCalledWith(
      data, { domainId: "health", goalId: "goal", weeks: 4 },
    ));
    expect(screen.getByRole("columnheader", { name: "回顾" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("生活领域"), { target: { value: "work" } });
    expect((screen.getByLabelText("关联目标") as HTMLSelectElement).value).toBe("");
  });

  it("shows no rate for old actions without state history", async () => {
    const source = { ...data, planChanges: [] };
    const value = {
      analyticsService: {
        loadData: vi.fn().mockResolvedValue(source),
        summarize: (records: AnalyticsData, selected: typeof filter) =>
          buildAnalytics(records, selected, now),
      },
      lifeDomainService: { list: vi.fn().mockResolvedValue([]) },
      domainMetricService: emptyMetrics,
    } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, null,
      createElement(LifeOSContext.Provider, { value }, createElement(AnalyticsPage))));
    expect(await screen.findByRole("heading", { name: "行动排期变化" })).toBeTruthy();
    expect(screen.getByText(/旧行动的原计划未知/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "行动到期完成率" })).toBeTruthy();
    expect(screen.getByText(/暂不显示完成率/)).toBeTruthy();
  });

  it.each([
    { url: "/analytics?domain=missing&weeks=4", reason: /链接中的生活领域已不存在/,
      expectedDomain: "" },
    { url: "/analytics?domain=health&goal=other&weeks=4", reason: /不属于当前领域/,
      expectedDomain: "health" },
  ])("never expands stale filters into an all-record analysis: $url", async ({
    url, reason, expectedDomain,
  }) => {
    const analyticsService = {
      loadData: vi.fn().mockResolvedValue(data),
      summarize: vi.fn().mockImplementation((source, selected) =>
        buildAnalytics(source, selected, now)),
    };
    const value = {
      analyticsService,
      lifeDomainService: { list: vi.fn().mockResolvedValue([
        { id: "health", name: "健康" }, { id: "work", name: "事业" },
      ]) },
      domainMetricService: {
        listDefinitions: vi.fn().mockResolvedValue([
          { id: "sleep", name: "睡眠时长", unit: "小时", domainIds: ["health"],
            archived: false, createdAt: "" },
        ]),
        listRecords: vi.fn().mockResolvedValue([
          { id: "first", metricId: "sleep", recordedOn: "2026-09-21", value: 7,
            note: "", createdAt: "", updatedAt: "" },
        ]),
      },
    } as unknown as LifeOSContextValue;
    render(createElement(MemoryRouter, { initialEntries: [url] },
      createElement(LifeOSContext.Provider, { value }, createElement(AnalyticsPage))));
    expect(await screen.findByRole("heading", { name: "无法按当前条件分析" })).toBeTruthy();
    expect(screen.getByText(reason)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "睡眠时长 (小时)" })).toBeNull();
    expect(analyticsService.summarize).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
    expect(await screen.findByRole("heading", { name: "睡眠时长 (小时)" })).toBeTruthy();
    expect((screen.getByLabelText("生活领域") as HTMLSelectElement).value).toBe(expectedDomain);
    expect((screen.getByLabelText("观察周期") as HTMLSelectElement).value).toBe("4");
  });

  it("shows dated metric evidence in the selected domain without assigning it to a goal", async () => {
    const metricService = {
      listSatisfactionLinks: vi.fn(async () => []),
      listDefinitions: vi.fn().mockResolvedValue([
        { id: "sleep", name: "睡眠时长", unit: "小时", domainIds: ["health", "work"],
          archived: false, createdAt: "" },
        { id: "other", name: "其他指标", unit: "次", domainIds: ["work"],
          archived: false, createdAt: "" },
      ]),
      listRecords: vi.fn().mockResolvedValue([
        { id: "first/part", metricId: "sleep", recordedOn: "2026-09-21", value: 7,
          note: "夜间休息", createdAt: "", updatedAt: "" },
        { id: "last", metricId: "sleep", recordedOn: "2026-09-23", value: 8,
          note: "", createdAt: "", updatedAt: "" },
        { id: "elsewhere", metricId: "other", recordedOn: "2026-09-22", value: 2,
          note: "", createdAt: "", updatedAt: "" },
      ]),
    };
    const value = {
      analyticsService: {
        loadData: vi.fn().mockResolvedValue(data),
        summarize: (source: AnalyticsData, selected: typeof filter) =>
          buildAnalytics(source, selected, now),
      },
      lifeDomainService: { list: vi.fn().mockResolvedValue([
        { id: "health", name: "健康" }, { id: "work", name: "事业" },
      ]) },
      domainMetricService: metricService,
    } as unknown as LifeOSContextValue;
    const health: LifeDomain = {
      id: "health", name: "健康", description: "", focus: "", color: "fern", icon: "heart",
      longTermExpectation: "", currentState: "", status: "active",
      sortOrder: 0, createdAt: "", updatedAt: "",
    };
    render(createElement(MemoryRouter, { initialEntries: ["/analytics?domain=health&weeks=4"] },
      createElement(LifeOSContext.Provider, { value },
        createElement(Routes, null,
          createElement(Route, { path: "/analytics", element: createElement(AnalyticsPage) }),
          createElement(Route, { path: "/domains/:domainId",
            element: createElement(DomainMetricsSection, { domain: health }) })))));
    expect(await screen.findByRole("heading", { name: "领域指标趋势" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "睡眠时长 (小时)" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "其他指标 (次)" })).toBeNull();
    const chart = screen.getByRole("img", { name: /睡眠时长：/ });
    const points = chart.querySelectorAll("circle");
    expect(points).toHaveLength(2);
    expect(Number(points[1].getAttribute("cx"))).toBeGreaterThan(Number(points[0].getAttribute("cx")));
    fireEvent.click(screen.getByText("查看来源 (2)"));
    const sourceLink = screen.getByRole("link", { name: /2026-09-21 · 7 小时/ });
    expect(sourceLink.getAttribute("href")).toBe("/domains/health#metric-record-first%2Fpart");
    expect(screen.getByText("夜间休息")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("关联目标"), { target: { value: "goal" } });
    expect(screen.getByText("当前选择了目标；领域指标不归属于目标。")).toBeTruthy();
    expect(screen.queryByRole("img", { name: /睡眠时长：/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("关联目标"), { target: { value: "" } });

    const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView",
      { configurable: true, value: scrollIntoView });
    try {
      fireEvent.click(screen.getByRole("link", { name: /2026-09-21 · 7 小时/ }));
      const note = await screen.findByText("夜间休息");
      expect(note.closest("li")?.id).toBe("metric-record-first/part");
      expect(note.closest("details")?.open).toBe(true);
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    } finally {
      if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  it("shows a retry on read failure and an honest empty state after recovery", async () => {
    const analyticsService = {
      loadData: vi.fn().mockRejectedValueOnce(new Error("读取失败")).mockResolvedValue({
        goals: [], actions: [], reviews: [], issues: [], planChanges: [],
        completionPlans: [], stateEvents: [],
      }),
      summarize: vi.fn().mockImplementation((source, selected) =>
        buildAnalytics(source, selected, now)),
    };
    const value = {
      analyticsService: analyticsService as Partial<AnalyticsService>,
      lifeDomainService: { list: vi.fn().mockResolvedValue([]) } as Partial<LifeDomainService>,
      domainMetricService: emptyMetrics,
    } as LifeOSContextValue;
    render(createElement(MemoryRouter, null,
      createElement(LifeOSContext.Provider, { value }, createElement(AnalyticsPage))));
    expect(await screen.findByRole("heading", { name: "暂时无法打开分析" })).toBeTruthy();
    expect(screen.getByText("分析数据读取失败，请重试。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText(/这段时间还没有可按日期汇总的记录/)).toBeTruthy();
  });
});
