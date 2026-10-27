import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import type { GoalTimelineEntry } from "../../src/domain/records/GoalTimeline";
import { GoalTimeline } from "../../src/pages/GoalTimeline";

afterEach(cleanup);
const entry: GoalTimelineEntry = { id: "goal-change-1", goalId: "goal /?#",
  changedAt: "2026-10-22T08:00:00Z", label: "目标调整", title: "规划调整",
  detail: "调整状态；进行中变为暂停", domainIds: ["former", "secondary"] };
function setup(list = vi.fn(async (): Promise<readonly GoalTimelineEntry[]> => [entry]), domainId = "") {
  const context = { goalTimelineService: { list } } as unknown as LifeOSContextValue;
  const page = render(<LifeOSContext.Provider value={context}><MemoryRouter>
    <GoalTimeline domainId={domainId} />
  </MemoryRouter></LifeOSContext.Provider>);
  return { ...page, list, context };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("V1 Chinese goal history timeline", () => {
  it("shows dated facts and encoded source links under historical secondary-domain scope", async () => {
    setup(undefined, "secondary");
    expect((await screen.findByRole("link", { name: entry.title })).getAttribute("href")).toBe(
      `/goals#goal-${encodeURIComponent(entry.goalId)}`);
    expect(screen.getByRole("link", { name: "版本历史" }).getAttribute("href")).toBe(
      `/history?type=goal&id=${encodeURIComponent(entry.goalId)}`);
    expect(screen.getByText(entry.detail)).toBeTruthy();
    expect(screen.getByText("2026-10-22").getAttribute("datetime")).toBe(entry.changedAt);
  });

  it("does not broaden an unmatched domain or invent facts in an empty history", async () => {
    setup(undefined, "other");
    expect(await screen.findByText("当前范围内暂无已记录的目标调整或阶段成果。")).toBeTruthy();
    expect(screen.queryByRole("link", { name: entry.title })).toBeNull();
  });

  it("sanitizes read failures, retries and hides old facts during explicit refresh", async () => {
    const next = deferred<readonly GoalTimelineEntry[]>();
    const list = vi.fn<() => Promise<readonly GoalTimelineEntry[]>>()
      .mockRejectedValueOnce(new Error("C:/private/db: SELECT secret"))
      .mockResolvedValueOnce([entry]).mockReturnValueOnce(next.promise);
    setup(list);
    expect((await screen.findByRole("alert")).textContent).toBe("目标历史读取失败，请重试。");
    expect(screen.queryByText(/SELECT secret/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试目标历史" }));
    await screen.findByRole("link", { name: entry.title });
    fireEvent.click(screen.getByRole("button", { name: "重新读取目标历史" }));
    expect(screen.queryByRole("link", { name: entry.title })).toBeNull();
    expect(screen.getByRole("button", { name: "重新读取目标历史" })).toHaveProperty("disabled", true);
    next.resolve([]);
    await screen.findByText("当前范围内暂无已记录的目标调整或阶段成果。");
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("ignores departed-page resolve and reject callbacks", async () => {
    for (const fail of [false, true]) {
      const next = deferred<readonly GoalTimelineEntry[]>();
      const page = setup(vi.fn(() => next.promise));
      await waitFor(() => expect(page.list).toHaveBeenCalledOnce());
      page.unmount();
      if (fail) next.reject(new Error("late private error")); else next.resolve([entry]);
      await next.promise.catch(() => {});
      expect(screen.queryByRole("alert")).toBeNull();
    }
  });
});
