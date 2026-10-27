import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { buildPersonRelationshipTimeline } from "../../src/domain/records/PersonRelationshipHistory";
import { PersonRelationshipTimeline } from "../../src/pages/PersonRelationshipTimeline";

afterEach(cleanup);
const entries = buildPersonRelationshipTimeline([{
  id: 1, personId: "person /甲", changedAt: "2026-10-22T08:00:00.000Z",
  before: { name: "老朋友", relationshipType: "朋友", state: "保持联系", domainIds: ["health"] },
  after: { name: "老朋友", relationshipType: "同事", state: "暂时疏远", domainIds: ["career"] },
}, {
  id: 2, personId: "other", changedAt: "2026-10-21T08:00:00.000Z",
  before: { name: "另一位人物", relationshipType: "朋友", state: "", domainIds: ["elsewhere"] },
  after: { name: "另一位人物", relationshipType: "朋友", state: "恢复联系", domainIds: ["elsewhere"] },
}]);

function setup(list = vi.fn(async () => entries), domainId = "", personId = "") {
  const context = { personRelationshipTimelineService: { list } } as unknown as LifeOSContextValue;
  const view = (domain: string, person: string) =>
    <LifeOSContext.Provider value={context}><MemoryRouter>
      <PersonRelationshipTimeline domainId={domain} personId={person} />
    </MemoryRouter></LifeOSContext.Provider>;
  const page = render(view(domainId, personId));
  return { ...page, list, scope: (domain: string, person: string) => page.rerender(view(domain, person)) };
}

describe("V1 Chinese relationship history timeline", () => {
  it("reads original relationships without write actions and intersects person and historical domain scope", async () => {
    const { scope, list } = setup(undefined, "health", "person /甲");
    const source = await screen.findByRole("link", { name: "老朋友" });
    expect(source.getAttribute("href")).toBe("/people#person-person%20%2F%E7%94%B2");
    expect(screen.queryByRole("link", { name: "另一位人物" })).toBeNull();
    expect(screen.getByText("2026-10-22")).toBeTruthy();
    expect(screen.getByText("关系类型：朋友 → 同事；关系状态：保持联系 → 暂时疏远")).toBeTruthy();
    fireEvent.click(screen.getByText("变更前后"));
    expect(screen.getByText("保持联系")).toBeTruthy();
    expect(screen.getByText("暂时疏远")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "保存记录" })).toBeNull();
    scope("career", "person /甲");
    expect(screen.getByRole("link", { name: "老朋友" })).toBeTruthy();
    scope("elsewhere", "person /甲");
    expect(screen.getByText("当前范围内暂无已记录的关系变化。")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "老朋友" })).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("shows sanitized errors and retries and explicitly reloads persisted facts", async () => {
    const list = vi.fn(async () => entries).mockRejectedValueOnce(new Error("SELECT C:\\private\\lifeos.db"));
    setup(list);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "关系历史读取失败，请重试。");
    expect(screen.queryByText(/SELECT/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试关系历史" }));
    expect(await screen.findByRole("link", { name: "老朋友" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新读取关系历史" }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
  });

  it("ignores a pending read after leaving the timeline", async () => {
    let finish!: (value: typeof entries) => void;
    const list = vi.fn(() => new Promise<typeof entries>(resolve => { finish = resolve; }));
    const { unmount } = setup(list);
    expect(screen.getByText("正在读取关系历史")).toBeTruthy();
    unmount();
    finish(entries);
    await Promise.resolve();
    expect(screen.queryByRole("link", { name: "老朋友" })).toBeNull();
  });
});
