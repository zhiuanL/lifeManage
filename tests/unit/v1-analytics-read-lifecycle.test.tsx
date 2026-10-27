import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { buildAnalytics, type AnalyticsData } from "../../src/domain/analytics/Analytics";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";
import { AnalyticsPage } from "../../src/pages/AnalyticsPage";

afterEach(cleanup);
const now = new Date("2026-10-22T08:00:00.000Z");
const health: LifeDomain = { id: "health", name: "健康", description: "", focus: "",
  currentState: "", longTermExpectation: "", color: "fern", icon: "heart", status: "active",
  sortOrder: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() };
const empty: AnalyticsData = { goals: [], actions: [], reviews: [], issues: [],
  planChanges: [], completionPlans: [], stateEvents: [] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function context() {
  const load = vi.fn<LifeOSContextValue["analyticsService"]["loadData"]>(async () => empty);
  const summarize = vi.fn<LifeOSContextValue["analyticsService"]["summarize"]>(
    (data, selected) => buildAnalytics(data, selected, now));
  const listDomains = vi.fn<LifeOSContextValue["lifeDomainService"]["list"]>(async () => [health]);
  const listDefinitions = vi.fn<LifeOSContextValue["domainMetricService"]["listDefinitions"]>(async () => []);
  const listRecords = vi.fn<LifeOSContextValue["domainMetricService"]["listRecords"]>(async () => []);
  const app = { analyticsService: { loadData: load, summarize },
    lifeDomainService: { list: listDomains },
    domainMetricService: { listDefinitions, listRecords },
  } as unknown as LifeOSContextValue;
  return { app, load, summarize, listDomains, listDefinitions, listRecords };
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="当前位置">{location.pathname}{location.search}{location.hash}</output>;
}

function Frame({ app, url = "/analytics?domain=health&weeks=4" }: {
  app: LifeOSContextValue; url?: string;
}) {
  return <MemoryRouter initialEntries={[url]}>
    <LifeOSContext.Provider value={app}><AnalyticsPage /><LocationProbe /></LifeOSContext.Provider>
  </MemoryRouter>;
}

describe("V1 analytics read lifecycle", () => {
  it("hides old data during service replacement and rejects a late initial response", async () => {
    const previous = context(), current = context();
    const oldRead = deferred<AnalyticsData>(), newRead = deferred<AnalyticsData>();
    previous.load.mockReturnValueOnce(oldRead.promise);
    current.load.mockReturnValueOnce(newRead.promise);
    const page = render(<Frame app={previous.app} />);
    page.rerender(<Frame app={current.app} />);
    expect(screen.getByText("正在整理已有记录")).toBeTruthy();
    await act(async () => oldRead.resolve(empty));
    expect(screen.queryByRole("heading", { name: "分析", level: 1 })).toBeNull();
    expect(previous.summarize).not.toHaveBeenCalled();
    expect(current.summarize).not.toHaveBeenCalled();
    const newData = { ...empty };
    await act(async () => newRead.resolve(newData));
    expect(await screen.findByRole("heading", { name: "分析", level: 1 })).toBeTruthy();
    expect(current.summarize).toHaveBeenLastCalledWith(newData,
      { domainId: health.id, goalId: null, weeks: 4 });
  });

  it.each(["success", "failure"] as const)(
    "ignores late reload %s after replacement without using the old snapshot", async outcome => {
      const previous = context(), current = context();
      const reload = deferred<AnalyticsData>(), replacement = deferred<AnalyticsData>();
      const page = render(<Frame app={previous.app} />);
      await screen.findByRole("heading", { name: "分析", level: 1 });
      previous.load.mockReturnValueOnce(reload.promise);
      fireEvent.click(screen.getByRole("button", { name: "重新读取分析" }));
      current.load.mockReturnValueOnce(replacement.promise);
      page.rerender(<Frame app={current.app} />);
      expect(screen.getByText("正在整理已有记录")).toBeTruthy();
      expect(current.summarize).not.toHaveBeenCalled();
      await act(async () => replacement.resolve(empty));
      await screen.findByRole("heading", { name: "分析", level: 1 });
      const calls = current.summarize.mock.calls.length;
      await act(async () => {
        if (outcome === "success") reload.resolve({ ...empty, goals: [] });
        else reload.reject(new Error("SQLITE_BUSY C:\\private\\lifeos.db"));
      });
      expect(screen.getByRole("heading", { name: "分析", level: 1 })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
      expect(current.summarize).toHaveBeenCalledTimes(calls);
      expect(previous.load).toHaveBeenCalledTimes(2);
    });

  for (const phase of ["initial", "reload"] as const) {
    it.each(["success", "failure"] as const)(
      `ignores late ${phase} %s after unmount`, async outcome => {
        const previous = context(), current = context();
        const pending = deferred<AnalyticsData>();
        if (phase === "initial") previous.load.mockReturnValueOnce(pending.promise);
        const page = render(<Frame app={previous.app} />);
        if (phase === "reload") {
          await screen.findByRole("heading", { name: "分析", level: 1 });
          previous.load.mockReturnValueOnce(pending.promise);
          fireEvent.click(screen.getByRole("button", { name: "重新读取分析" }));
        }
        page.unmount();
        render(<Frame app={current.app} />);
        await screen.findByRole("heading", { name: "分析", level: 1 });
        const calls = current.summarize.mock.calls.length;
        await act(async () => {
          if (outcome === "success") pending.resolve(empty);
          else pending.reject("C:\\private\\lifeos.db");
        });
        expect(current.summarize).toHaveBeenCalledTimes(calls);
        expect(screen.getByRole("heading", { name: "分析", level: 1 })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
      });
  }

  it.each(["load", "listDomains", "listDefinitions", "listRecords"] as const)(
    "sanitizes %s failures and preserves exact URL filters on retry", async source => {
      const services = context();
      services[source].mockRejectedValueOnce(new Error("SQLITE_BUSY C:\\private\\lifeos.db"));
      const url = "/analytics?domain=health&weeks=12&extra=a&extra=b#analytics-metrics-heading";
      render(<Frame app={services.app} url={url} />);
      expect(await screen.findByText("分析数据读取失败，请重试。")).toBeTruthy();
      expect(screen.queryByText(/SQLITE_BUSY/)).toBeNull();
      expect(services.summarize).not.toHaveBeenCalled();
      expect(screen.getByLabelText("当前位置").textContent).toBe(url);
      fireEvent.click(screen.getByRole("button", { name: "重试" }));
      await screen.findByRole("heading", { name: "分析", level: 1 });
      expect(screen.getByLabelText("观察周期")).toHaveProperty("value", "12");
      expect(screen.getByLabelText("生活领域")).toHaveProperty("value", health.id);
      await waitFor(() => expect(services.summarize).toHaveBeenCalledWith(empty,
        { domainId: health.id, goalId: null, weeks: 12 }));
      expect(screen.getByLabelText("当前位置").textContent).toBe(url);
    });
});
