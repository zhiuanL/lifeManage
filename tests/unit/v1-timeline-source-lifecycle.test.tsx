import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { buildDomainTimeline } from "../../src/domain/life/DomainHistory";
import { buildPersonRelationshipTimeline } from "../../src/domain/records/PersonRelationshipHistory";
import { DomainTimeline } from "../../src/pages/DomainTimeline";
import { GoalTimeline } from "../../src/pages/GoalTimeline";
import { PersonRelationshipTimeline } from "../../src/pages/PersonRelationshipTimeline";

afterEach(cleanup);
const stamp = "2026-10-22T08:00:00Z";
const before = { name: "原领域", description: "", focus: "", color_key: "fern", icon_key: "heart",
  current_state: "", long_term_expectation: "", status: "active" };
const cases = [
  { key: "goalTimelineService", label: "目标历史", Page: GoalTimeline,
    entries: [{ id: "goal-change", goalId: "goal", changedAt: stamp, label: "目标调整",
      title: "原历史", detail: "调整方向", domainIds: ["health"] }] },
  { key: "domainTimelineService", label: "领域历史", Page: DomainTimeline,
    entries: buildDomainTimeline([{ id: 1, domainId: "health", changedAt: stamp, before,
      after: { ...before, name: "原历史" } }]) },
  { key: "personRelationshipTimelineService", label: "关系历史", Page: PersonRelationshipTimeline,
    entries: buildPersonRelationshipTimeline([{ id: 1, personId: "person", changedAt: stamp,
      before: { name: "原历史", relationshipType: "朋友", state: "", domainIds: ["health"] },
      after: { name: "原历史", relationshipType: "朋友", state: "保持联系", domainIds: ["health"] } }]) },
] as const;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe.each(cases)("$label source isolation", entry => {
  const { key, Page, label, entries } = entry;
  const frame = (source: { list(): Promise<unknown> }) =>
    <MemoryRouter><LifeOSContext.Provider value={{ [key]: source } as unknown as LifeOSContextValue}>
      <Page domainId="" personId="" />
    </LifeOSContext.Provider></MemoryRouter>;

  it("hides previous facts on replacement, sanitizes failure and retries the new source", async () => {
    const original = { list: vi.fn(async () => entries) };
    const reading = deferred<typeof entries>();
    const replacement = { list: vi.fn(async () => entries)
      .mockReturnValueOnce(reading.promise).mockResolvedValueOnce([] as unknown as typeof entries) };
    const view = render(frame(original));
    await screen.findByRole("link", { name: "原历史" });
    view.rerender(frame(replacement));
    expect(screen.queryByRole("link", { name: "原历史" })).toBeNull();
    expect(screen.getByText(`正在读取${label}`)).toBeTruthy();
    await act(async () => reading.reject(new Error("SQL C:\\private\\life.db")));
    expect((await screen.findByRole("alert")).textContent).toBe(`${label}读取失败，请重试。`);
    fireEvent.click(screen.getByRole("button", { name: `重试${label}` }));
    await screen.findByText(/当前范围内暂无已记录/);
    expect(original.list).toHaveBeenCalledTimes(1);
    expect(replacement.list).toHaveBeenCalledTimes(2);
  });

  it.each(["resolve", "reject"] as const)("ignores replaced pending read %s", async outcome => {
    const reading = deferred<typeof entries>();
    const original = { list: vi.fn(() => reading.promise) };
    const replacement = { list: vi.fn(async () => [] as unknown as typeof entries) };
    const view = render(frame(original));
    view.rerender(frame(replacement));
    await screen.findByText(/当前范围内暂无已记录/);
    await act(async () => {
      if (outcome === "resolve") reading.resolve(entries);
      else reading.reject(new Error("old secret"));
    });
    expect(screen.queryByRole("link", { name: "原历史" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
