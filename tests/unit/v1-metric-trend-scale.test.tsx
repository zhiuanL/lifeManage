import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { MetricTrendView } from "../../src/components/analytics/MetricTrendView";
import type { DomainMetricTrend } from "../../src/domain/analytics/DomainMetricTrend";

afterEach(cleanup);
function plot(values: number[]) {
  const trend: DomainMetricTrend = {
    definition: { id: "metric", name: "精力", unit: "自评", domainIds: [], archived: false, createdAt: "2026-10-22" },
    records: values.map((value, index) => ({
      id: `记录/中文${index}`, metricId: "metric", recordedOn: `2026-10-${20 + index}`,
      value, note: "", createdAt: "2026-10-22", updatedAt: "2026-10-22",
    })),
  };
  return render(<MemoryRouter><MetricTrendView trend={trend} domainId={null}
    start="2026-10-01" end="2026-10-22" /></MemoryRouter>);
}

it("shows exact observed scale ticks, dates, units and independently encoded original records", () => {
  plot([1.25, 3.75]);
  const chart = screen.getByRole("img");
  expect(chart.getAttribute("aria-label")).toContain("刻度 3.75、1.25 自评");
  expect([...chart.querySelectorAll("text")].map(node => node.childNodes[0].textContent))
    .toEqual(["3.75", "1.25", "2026-10-01", "2026-10-22"]);
  expect(chart.querySelector(".metric-trend-zero")).toBeNull();
  expect(chart.querySelectorAll("circle")).toHaveLength(2);
  expect(screen.getByRole("link", { name: "2026-10-20 · 1.25 自评" }).getAttribute("href"))
    .toBe("/metrics#metric-record-" + encodeURIComponent("记录/中文0"));
  expect(screen.getByRole("region", { name: "精力趋势图" }).getAttribute("tabindex")).toBe("0");
});

it("uses a numeric zero reference only when the displayed range actually includes zero", () => {
  plot([-2, 3]);
  const chart = screen.getByRole("img");
  expect(chart.getAttribute("aria-label")).toContain("刻度 3、0、-2 自评");
  expect(chart.querySelectorAll(".metric-trend-zero")).toHaveLength(1);
});

it.each([{ values: [0] }, { values: [5, 5] }, { values: [1e9] }, { values: [0.0000001] }])("keeps constant or single-point scales finite: $values", ({ values }) => {
  plot(values);
  const chart = screen.getByRole("img");
  expect(chart.innerHTML).not.toMatch(/NaN|Infinity/);
  expect(chart.querySelectorAll("circle")).toHaveLength(values.length);
  for (const circle of chart.querySelectorAll("circle")) {
    expect(Number(circle.getAttribute("cy"))).toBeGreaterThanOrEqual(18);
    expect(Number(circle.getAttribute("cy"))).toBeLessThanOrEqual(118);
  }
});

it("does not manufacture a scale or observations for an empty trend", () => {
  const { container } = plot([]);
  expect(container.querySelector("svg")).toBeNull();
});
