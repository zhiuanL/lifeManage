import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { buildDomainTimeline, type DomainTimelineEntry } from "../../src/domain/life/DomainHistory";
import { DomainTimeline } from "../../src/pages/DomainTimeline";

afterEach(cleanup);
const before = { name: "健康", description: "", focus: "", color_key: "fern", icon_key: "heart",
  current_state: "原状态", long_term_expectation: "", status: "active" };
const entry = buildDomainTimeline([{ id: 1, domainId: "domain /?#", changedAt: "2026-10-22T08:00:00Z",
  before, after: { ...before, name: "健康与体能", status: "paused", current_state: "舒适活动" } }])[0];
function setup(list = vi.fn(async (): Promise<readonly DomainTimelineEntry[]> => [entry]), domainId = "") {
  const context = { domainTimelineService: { list } } as unknown as LifeOSContextValue;
  return { list, ...render(<LifeOSContext.Provider value={context}><MemoryRouter>
    <DomainTimeline domainId={domainId} />
  </MemoryRouter></LifeOSContext.Provider>) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("V1 Chinese domain timeline", () => {
  it("shows scoped recorded facts, before/after and encoded original domain link", async () => {
    setup(undefined, entry.domainId);
    expect((await screen.findByRole("link", { name: entry.title })).getAttribute("href")).toBe(
      `/domains/${encodeURIComponent(entry.domainId)}`);
    expect(screen.getByText("2026-10-22").getAttribute("datetime")).toBe(entry.changedAt);
    fireEvent.click(screen.getByText("变更前后"));
    expect(screen.getByText("原状态", { exact: false })).toBeTruthy();
    expect(screen.getByText("舒适活动", { exact: false })).toBeTruthy();
    expect(screen.getByText(entry.detail)).toBeTruthy();
  });
  it("does not broaden a different domain", async () => {
    setup(undefined, "other");
    expect(await screen.findByText("当前范围内暂无已记录的领域变化。")).toBeTruthy();
    expect(screen.queryByRole("link", { name: entry.title })).toBeNull();
  });
  it("sanitizes errors, retries, hides old facts while refreshing and disables concurrent reload", async () => {
    const next = deferred<readonly DomainTimelineEntry[]>();
    const list = vi.fn<() => Promise<readonly DomainTimelineEntry[]>>()
      .mockRejectedValueOnce(new Error("C:/private/db SELECT secret"))
      .mockResolvedValueOnce([entry]).mockReturnValueOnce(next.promise);
    setup(list);
    expect((await screen.findByRole("alert")).textContent).toBe("领域历史读取失败，请重试。");
    expect(screen.queryByText(/SELECT secret/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试领域历史" }));
    await screen.findByRole("link", { name: entry.title });
    fireEvent.click(screen.getByRole("button", { name: "重新读取领域历史" }));
    expect(screen.queryByRole("link", { name: entry.title })).toBeNull();
    expect(screen.getByRole("button", { name: "重新读取领域历史" })).toHaveProperty("disabled", true);
    next.resolve([]);
    await screen.findByText("当前范围内暂无已记录的领域变化。");
    expect(list).toHaveBeenCalledTimes(3);
  });
  it("ignores resolve and rejection after unmount", async () => {
    for (const fail of [false, true]) {
      const next = deferred<readonly DomainTimelineEntry[]>();
      const page = setup(vi.fn(() => next.promise));
      await waitFor(() => expect(page.list).toHaveBeenCalledOnce());
      page.unmount();
      if (fail) next.reject(new Error("late error")); else next.resolve([entry]);
      await next.promise.catch(() => {});
      expect(screen.queryByRole("alert")).toBeNull();
    }
  });
});
