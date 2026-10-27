import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { DomainMetricsSection } from "../../src/components/DomainMetricsSection";
import { buildDomainMetricTrends, recentMetricWindow } from "../../src/domain/analytics/DomainMetricTrend";
import type { MetricDefinition, MetricRecord } from "../../src/domain/life/DomainMetric";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const stamp = "2026-10-22T08:00:00Z";
const domain: LifeDomain = {
  id: "健康/中文", name: "健康", description: "", focus: "", currentState: "",
  longTermExpectation: "", color: "fern", icon: "heart", status: "active",
  sortOrder: 0, createdAt: stamp, updatedAt: stamp,
};
const definition: MetricDefinition = {
  id: "score", name: "舒适程度", unit: "自定单位", domainIds: [domain.id], archived: true, createdAt: stamp,
};
const record = (id: string, recordedOn: string, value: number, metricId = definition.id): MetricRecord => ({
  id, metricId, recordedOn, value, note: "", createdAt: stamp, updatedAt: stamp,
});

it("uses thirty inclusive calendar dates across month/year/leap-day boundaries, never a fabricated window", () => {
  expect(recentMetricWindow("2026-10-22")).toEqual({ start: "2026-09-23", end: "2026-10-22" });
  expect(recentMetricWindow("2026-01-02")).toEqual({ start: "2025-12-04", end: "2026-01-02" });
  expect(recentMetricWindow("2024-03-01")).toEqual({ start: "2024-02-01", end: "2024-03-01" });
  expect(recentMetricWindow("2026-02-30")).toBeNull();
});

it("filters by explicit domain and observed dates, preserving zero, units, gaps and input order", () => {
  const records = [
    record("latest", "2026-10-22", 2.5), record("future", "2026-10-23", 99),
    record("zero", "2026-09-23", 0), record("old", "2026-09-22", -1),
    record("other", "2026-10-22", 100, "other"),
  ];
  const before = [...records];
  const definitions = [definition, { ...definition, id: "other", domainIds: [] }];
  const trends = buildDomainMetricTrends(definitions, records, domain.id, null, "2026-09-23", "2026-10-22");
  expect(trends).toHaveLength(1);
  expect(trends[0].records.map(item => [item.id, item.value])).toEqual([["zero", 0], ["latest", 2.5]]);
  expect(trends[0].definition.unit).toBe("自定单位");
  expect(records).toEqual(before);
});

it("shows compact observed domain trends and encoded sources, without scoring or manufacturing an empty chart", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T08:00:00Z"));
  const emptyDefinition = { ...definition, id: "empty", name: "无记录指标" };
  const app = {
    domainMetricService: {
      listDefinitions: async () => [definition, emptyDefinition],
      listRecords: async () => [
        record("零/中文", "2026-09-23", 0), record("旧", "2026-09-22", -1),
        record("最近", "2026-10-22", 2.5), record("将来", "2026-10-23", 99),
      ],
      listSatisfactionLinks: async () => [],
    },
    lifeDomainService: { list: async () => [domain] },
  } as unknown as LifeOSContextValue;
  render(<MemoryRouter><LifeOSContext.Provider value={app}>
    <DomainMetricsSection domain={domain} />
  </LifeOSContext.Provider></MemoryRouter>);
  const chart = await screen.findByRole("img");
  expect(screen.getAllByRole("img")).toHaveLength(1);
  expect(chart.getAttribute("aria-label")).toBe("舒适程度：2026-09-23 0 自定单位，2026-10-22 2.5 自定单位");
  expect(chart.querySelectorAll("circle")).toHaveLength(2);
  expect(chart.querySelectorAll(".metric-trend-grid")).toHaveLength(0);
  expect(screen.getByText("不评分")).toBeTruthy();
  expect(screen.getByText("近 30 天")).toBeTruthy();
  expect(screen.getByRole("link", { name: "2026-09-23 · 0 自定单位" }).getAttribute("href"))
    .toBe(`/domains/${encodeURIComponent(domain.id)}#metric-record-${encodeURIComponent("零/中文")}`);
  expect(chart.innerHTML).not.toMatch(/NaN|Infinity/);
});
