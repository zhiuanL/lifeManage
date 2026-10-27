import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { DomainMetricsSection } from "../../src/components/DomainMetricsSection";
import { buildAnalytics, type AnalyticsData } from "../../src/domain/analytics/Analytics";
import type { MetricDefinition, MetricRecord } from "../../src/domain/life/DomainMetric";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";
import { AnalyticsPage } from "../../src/pages/AnalyticsPage";
import { MetricsPage } from "../../src/pages/MetricsPage";
import { MorePage } from "../../src/pages/MorePage";
import { ResourcesPage } from "../../src/pages/ResourcesPage";

afterEach(cleanup);
const stamp = "2026-10-22T08:00:00.000Z";
const health: LifeDomain = { id: "health", name: "健康", description: "", focus: "",
  currentState: "", longTermExpectation: "", color: "fern", icon: "heart",
  status: "active", sortOrder: 0, createdAt: stamp, updatedAt: stamp };
const work: LifeDomain = { ...health, id: "work", name: "事业", sortOrder: 1 };
const globalMetric: MetricDefinition = { id: "m/中文%part", name: "独立状态", unit: "分",
  domainIds: [], archived: false, createdAt: stamp };
const reading: MetricRecord = { id: "r/中文%part", metricId: globalMetric.id,
  recordedOn: "2026-10-22", value: 0, note: "明确记录", createdAt: stamp, updatedAt: stamp };

function context(domains: readonly LifeDomain[] = [], initial: readonly MetricDefinition[] = [],
  records: readonly MetricRecord[] = []) {
  let definitions = [...initial];
  const create = vi.fn<LifeOSContextValue["domainMetricService"]["createDefinition"]>(
    async (name, unit, domainIds) => {
      const definition = { ...globalMetric, name, unit, domainIds };
      definitions = [...definitions, definition];
      return definition;
    });
  const save = vi.fn<LifeOSContextValue["domainMetricService"]["saveRecord"]>();
  const archive = vi.fn<LifeOSContextValue["domainMetricService"]["setArchived"]>();
  const app = {
    lifeDomainService: { list: vi.fn(async () => domains) },
    domainMetricService: {
      listDefinitions: vi.fn(async () => definitions), listRecords: vi.fn(async () => records),
      listSatisfactionLinks: vi.fn(async () => []),
      createDefinition: create, saveRecord: save, setArchived: archive,
    },
  } as unknown as LifeOSContextValue;
  return { app, create, save, archive };
}

function show(app: LifeOSContextValue, url = "/metrics") {
  return render(<LifeOSContext.Provider value={app}><MemoryRouter initialEntries={[url]}>
    <MetricsPage />
    <Link to={`/metrics#metric-${encodeURIComponent(globalMetric.id)}`}>定位指标</Link>
    <Link to={`/metrics#metric-record-${encodeURIComponent(reading.id)}`}>定位记录</Link>
    <Link to="/metrics#metric-record-%broken">无效来源</Link>
  </MemoryRouter></LifeOSContext.Provider>);
}

describe("V1 global daily metrics", () => {
  it("allows explicit editable starting points with no domains and writes only after confirmation", async () => {
    const { app, create, save, archive } = context();
    show(app);
    expect(await screen.findByRole("heading", { name: "状态指标" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "每日状态与指标" })).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "添加指标" }));
    expect(screen.getByLabelText("指标名称")).toHaveProperty("value", "");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("指标起点"), { target: { value: "sleep" } });
    expect(screen.getByLabelText("指标名称")).toHaveProperty("value", "睡眠时长");
    expect(screen.getByLabelText("计量单位")).toHaveProperty("value", "小时");
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("指标名称"), { target: { value: "午睡时长" } });
    fireEvent.change(screen.getByLabelText("计量单位"), { target: { value: "分钟" } });
    fireEvent.change(screen.getByLabelText("指标起点"), { target: { value: "" } });
    expect(screen.getByLabelText("指标名称")).toHaveProperty("value", "午睡时长");
    expect(screen.getByLabelText("计量单位")).toHaveProperty("value", "分钟");
    fireEvent.click(screen.getByRole("button", { name: "创建指标" }));
    expect(await screen.findByRole("heading", { name: "午睡时长 (分钟)" })).toBeTruthy();
    expect(create).toHaveBeenCalledExactlyOnceWith("午睡时长", "分钟", []);
    expect(screen.getByText("未关联领域")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    expect(archive).not.toHaveBeenCalled();
  });

  it("starts with no domain selected, permits multiple explicit links and leaves cancellation empty", async () => {
    const { app, create } = context([health, work]);
    show(app);
    fireEvent.click(await screen.findByRole("button", { name: "添加指标" }));
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toHaveProperty("checked", false);
      expect(checkbox.matches(":disabled")).toBe(false);
    }
    fireEvent.change(screen.getByLabelText("指标起点"), { target: { value: "mood" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "添加指标" }));
    expect(screen.getByLabelText("指标名称")).toHaveProperty("value", "");
    fireEvent.change(screen.getByLabelText("指标起点"), { target: { value: "energy" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "健康" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "事业" }));
    fireEvent.click(screen.getByRole("button", { name: "创建指标" }));
    expect(await screen.findByRole("heading", { name: "精力 (分)" })).toBeTruthy();
    expect(create).toHaveBeenCalledExactlyOnceWith("精力", "分", [health.id, work.id]);
    expect(screen.getByText("健康 · 事业")).toBeTruthy();
  });

  it("keeps the domain view scoped and its current domain selected", async () => {
    const scoped = { ...globalMetric, id: "linked", name: "领域状态", domainIds: [health.id] };
    const { app, create } = context([health, work], [globalMetric, scoped]);
    render(<LifeOSContext.Provider value={app}><MemoryRouter>
      <DomainMetricsSection domain={health} />
    </MemoryRouter></LifeOSContext.Provider>);
    expect(await screen.findByRole("heading", { name: "领域状态 (分)" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "独立状态 (分)" })).toBeNull();
    expect(screen.getByRole("link", { name: "全部指标" }).getAttribute("href")).toBe("/metrics");
    fireEvent.click(screen.getByRole("button", { name: "添加指标" }));
    const selected = screen.getByRole("checkbox", { name: "健康" });
    expect(selected).toHaveProperty("checked", true);
    expect(selected.matches(":disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("指标起点"), { target: { value: "activity" } });
    fireEvent.click(screen.getByRole("button", { name: "创建指标" }));
    await waitFor(() => expect(create).toHaveBeenCalledExactlyOnceWith("活动时长", "分钟", [health.id]));
  });

  it("locates exact encoded definition and record identities and ignores malformed sources", async () => {
    const { app, create, save, archive } = context([], [globalMetric], [reading]);
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    const scrolled: HTMLElement[] = [];
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true, value: function (this: HTMLElement) { scrolled.push(this); },
    });
    try {
      show(app, `/metrics#metric-${encodeURIComponent(globalMetric.id)}`);
      await waitFor(() => expect(scrolled.at(-1)?.id).toBe(`metric-${globalMetric.id}`));
      expect(document.getElementById(`metric-${globalMetric.id}`)?.classList.contains("metric-source")).toBe(true);
      fireEvent.click(screen.getByRole("link", { name: "定位记录" }));
      await waitFor(() => expect(scrolled.at(-1)?.id).toBe(`metric-record-${reading.id}`));
      expect(document.getElementById(`metric-record-${reading.id}`)?.closest("details")?.open).toBe(true);
      expect(screen.getByText("0 分")).toBeTruthy();
      fireEvent.click(screen.getByRole("link", { name: "无效来源" }));
      expect(document.querySelector(".metric-source")).toBeNull();
      expect(scrolled.at(-1)?.id).toBe(`metric-record-${reading.id}`);
      expect(create).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(archive).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", original);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  it("keeps metrics globally accessible when analytics is disabled", async () => {
    const { app } = context();
    app.modulePreference = { disabledModules: ["analytics"] };
    const page = render(<LifeOSContext.Provider value={app}><MemoryRouter>
      <MorePage />
    </MemoryRouter></LifeOSContext.Provider>);
    expect(screen.getByRole("link", { name: "每日状态与指标" }).getAttribute("href")).toBe("/metrics");
    page.unmount();
    show(app);
    expect(await screen.findByRole("heading", { name: "状态指标" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "查看趋势" })).toBeNull();
  });

  it("opens global trend evidence at the original unlinked daily record", async () => {
    const { app } = context([], [globalMetric], [reading]);
    const data: AnalyticsData = { goals: [], actions: [], reviews: [], issues: [],
      planChanges: [], completionPlans: [], stateEvents: [] };
    app.analyticsService = {
      loadData: vi.fn(async () => data),
      summarize: (source, selected) => buildAnalytics(source, selected, new Date(stamp)),
    } as LifeOSContextValue["analyticsService"];
    render(<LifeOSContext.Provider value={app}><MemoryRouter initialEntries={["/analytics"]}>
      <Routes>
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/metrics" element={<MetricsPage />} />
      </Routes>
    </MemoryRouter></LifeOSContext.Provider>);
    expect(await screen.findByRole("heading", { name: "独立状态 (分)" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "状态指标" }).getAttribute("href")).toBe("/metrics");
    fireEvent.click(screen.getByText("查看来源 (1)"));
    const source = screen.getByRole("link", { name: /2026-10-22 · 0 分/ });
    expect(source.getAttribute("href")).toBe(`/metrics#metric-record-${encodeURIComponent(reading.id)}`);
    fireEvent.click(source);
    expect(await screen.findByRole("heading", { name: "每日状态与指标" })).toBeTruthy();
    await waitFor(() => expect(document.getElementById(`metric-record-${reading.id}`)?.closest("details")?.open).toBe(true));
    expect(screen.getByText("明确记录")).toBeTruthy();
  });

  it("opens standalone resource state clues without fabricating a domain link", async () => {
    const empty = { ...globalMetric, id: "empty", name: "尚未记录的状态" };
    const { app } = context([], [globalMetric, empty], [{ ...reading, recordedOn: "2026-09-21" }]);
    const value = { ...app,
      resourceService: { list: async () => [] },
      goalService: { list: async () => [] },
      actionService: { list: async () => [] },
      lifeRecordsService: { listPeople: async () => [], listSkills: async () => [] },
    } as unknown as LifeOSContextValue;
    render(<LifeOSContext.Provider value={value}><MemoryRouter>
      <ResourcesPage />
    </MemoryRouter></LifeOSContext.Provider>);
    expect((await screen.findByRole("link", { name: "独立状态" })).getAttribute("href"))
      .toBe(`/metrics#metric-record-${encodeURIComponent(reading.id)}`);
    expect(screen.getByRole("link", { name: "尚未记录的状态" }).getAttribute("href"))
      .toBe(`/metrics#metric-${encodeURIComponent(empty.id)}`);
    expect(screen.queryByRole("link", { name: "健康指标" })).toBeNull();
  });
});
