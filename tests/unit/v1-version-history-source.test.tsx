import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { VersionHistoryPage } from "../../src/pages/VersionHistoryPage";
import type { ObjectVersion } from "../../src/services/history/VersionHistoryService";

afterEach(cleanup);
const row: ObjectVersion = { id: 1, type: "goal", objectId: "goal",
  changedAt: "2026-10-22T08:00:00Z", snapshot: { title: "旧版本原文", description: "保留原文" } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function services() {
  return {
    versionHistoryService: { list: vi.fn(async () => [row] as readonly ObjectVersion[]) },
    goalService: { findById: vi.fn(async (): Promise<{ title: string } | null> => ({ title: "当前目标" })) },
  };
}
function Navigation() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate("/history?type=goal&id=other")}>切换记录</button>;
}
function frame(value: ReturnType<typeof services>, path = "/history?type=goal&id=goal") {
  return <MemoryRouter initialEntries={[path]}>
    <LifeOSContext.Provider value={value as unknown as LifeOSContextValue}>
      <VersionHistoryPage /><Navigation />
    </LifeOSContext.Provider>
  </MemoryRouter>;
}

describe("version history source lifecycle", () => {
  it.each(["versionHistoryService", "goalService"] as const)("hides stale title and history when only %s changes", async key => {
    const original = services();
    const replacement = services();
    const pending = deferred<readonly ObjectVersion[]>();
    replacement.versionHistoryService.list.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([]);
    const view = render(frame(original));
    await screen.findByText("旧版本原文");
    const next = key === "versionHistoryService" ? { ...original,
      versionHistoryService: replacement.versionHistoryService } : { ...original, goalService: replacement.goalService };
    const pendingTitle = deferred<{ title: string } | null>();
    if (key === "goalService") replacement.goalService.findById.mockReturnValueOnce(pendingTitle.promise);
    view.rerender(frame(next));
    expect(screen.queryByText("旧版本原文")).toBeNull();
    expect(screen.queryByText("目标 · 当前目标")).toBeNull();
    expect(screen.getByText("正在读取修改记录…")).toBeTruthy();
    await act(async () => {
      if (key === "versionHistoryService") pending.reject(new Error("C:\\private\\SQL.db"));
      else pendingTitle.reject(new Error("C:\\private\\SQL.db"));
    });
    expect((await screen.findByRole("alert")).textContent).toBe("修改历史读取失败，请重试。");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText(key === "versionHistoryService" ? "尚无修改记录。" : "旧版本原文");
  });

  it.each(["resolve", "reject"] as const)("ignores replaced pending history %s", async outcome => {
    const original = services();
    const pending = deferred<readonly ObjectVersion[]>();
    original.versionHistoryService.list.mockReturnValueOnce(pending.promise);
    const replacement = services();
    replacement.versionHistoryService.list.mockResolvedValue([]);
    replacement.goalService.findById.mockResolvedValue({ title: "新来源" });
    const view = render(frame(original));
    view.rerender(frame(replacement));
    await screen.findByText("目标 · 新来源");
    await act(async () => {
      if (outcome === "resolve") pending.resolve([row]);
      else pending.reject(new Error("old private"));
    });
    expect(screen.queryByText("旧版本原文")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a route replacement isolated and returns to the exact encoded source", async () => {
    const value = services();
    const pending = deferred<readonly ObjectVersion[]>();
    value.versionHistoryService.list.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([]);
    value.goalService.findById.mockResolvedValueOnce({ title: "旧对象" }).mockResolvedValueOnce({ title: "新对象" });
    render(frame(value));
    fireEvent.click(screen.getByRole("button", { name: "切换记录" }));
    await screen.findByText("目标 · 新对象");
    await act(async () => pending.resolve([row]));
    expect(screen.queryByText("旧版本原文")).toBeNull();
    expect(screen.getByRole("link", { name: "返回原记录" }).getAttribute("href")).toBe("/goals#goal-other");
    expect(value.versionHistoryService.list.mock.calls).toEqual([["goal", "goal"], ["goal", "other"]]);
  });

  it.each(["/history?type=invalid&id=goal", "/history?type=goal&id=", "/history?id=goal"])(
    "does not query or broaden an invalid history request %s", async path => {
      const value = services();
      render(frame(value, path));
      expect(screen.getByText("请选择要查看历史的记录。")).toBeTruthy();
      expect(value.versionHistoryService.list).not.toHaveBeenCalled();
      expect(value.goalService.findById).not.toHaveBeenCalled();
    });

  it("keeps historical versions available when the current object no longer exists", async () => {
    const value = services();
    value.goalService.findById.mockResolvedValue(null);
    render(frame(value, "/history?type=goal&id=a%2Fb%20%E4%B8%AD"));
    await screen.findByText("目标 · 记录已不可用");
    expect(screen.getByText("旧版本原文")).toBeTruthy();
    expect(screen.getByRole("link", { name: "返回原记录" }).getAttribute("href")).toBe("/goals#goal-a%2Fb%20%E4%B8%AD");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("contains a damaged action snapshot without crashing other history entries", async () => {
    const value = services();
    value.versionHistoryService.list.mockResolvedValue([
      { ...row, type: "action", snapshot: { title: "损坏快照", details_json: "{" } },
      { ...row, id: 2, type: "action", snapshot: { title: "完整行动", details_json: '{"actualMinutes":0}', status: "completed" } },
    ]);
    render(<MemoryRouter initialEntries={["/history?type=action&id=action"]}>
      <LifeOSContext.Provider value={{ versionHistoryService: value.versionHistoryService,
        actionService: value.goalService } as unknown as LifeOSContextValue}>
        <VersionHistoryPage />
      </LifeOSContext.Provider>
    </MemoryRouter>);
    await screen.findByText("这份行动历史数据不完整，无法展示正文。");
    expect(screen.getByText("完整行动")).toBeTruthy();
    expect(screen.getByText("0 分钟")).toBeTruthy();
    expect(screen.getAllByText("修改前版本")).toHaveLength(2);
  });

  it("does not revive history or query again after unmount", async () => {
    const value = services();
    const pending = deferred<readonly ObjectVersion[]>();
    value.versionHistoryService.list.mockReturnValueOnce(pending.promise);
    const view = render(frame(value));
    view.unmount();
    await act(async () => pending.reject(new Error("private")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(value.versionHistoryService.list).toHaveBeenCalledTimes(1);
  });
});
