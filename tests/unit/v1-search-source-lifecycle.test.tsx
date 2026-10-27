import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import type { SearchEntry } from "../../src/domain/search/Search";
import { SearchPage } from "../../src/pages/SearchPage";

afterEach(cleanup);
const entries: readonly SearchEntry[] = [
  { type: "goal", id: "health-goal", title: "健康目标", content: "保留原文", status: "active",
    domainIds: ["health"], date: "2026-10-22", href: "/goals#goal-health-goal" },
  { type: "goal", id: "work-goal", title: "工作目标", content: "", status: "active",
    domainIds: ["work"], date: "2026-10-21", href: "/goals#goal-work-goal" },
];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function services() {
  return { searchService: { list: vi.fn(async () => entries) },
    lifeDomainService: { list: vi.fn(async () => [{ id: "health", name: "健康" }, { id: "work", name: "工作" }]) } };
}
function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output aria-label="当前位置">{location.pathname + location.search + location.hash}</output>
    <button type="button" onClick={() => navigate("/search?domain=work&keep=1#source")}>切换领域入口</button></>;
}
function frame(value: ReturnType<typeof services>, path = "/search") {
  return <MemoryRouter initialEntries={[path]}><LifeOSContext.Provider value={value as unknown as LifeOSContextValue}>
    <SearchPage /><Navigation />
  </LifeOSContext.Provider></MemoryRouter>;
}

describe("search source and context lifecycle", () => {
  it("hides old results during refresh, preserves filters and retries without stale facts", async () => {
    const value = services();
    const pending = deferred<readonly SearchEntry[]>();
    value.searchService.list.mockResolvedValueOnce(entries).mockReturnValueOnce(pending.promise);
    render(frame(value));
    await screen.findByRole("link", { name: /健康目标/ });
    fireEvent.change(screen.getByLabelText("起始日期"), { target: { value: "2026-10-22" } });
    expect(screen.queryByRole("link", { name: /工作目标/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "刷新搜索" }));
    expect(screen.queryByRole("link", { name: /健康目标/ })).toBeNull();
    expect(screen.getByText("正在读取本地记录…")).toBeTruthy();
    expect(screen.getByLabelText("起始日期")).toHaveProperty("value", "2026-10-22");
    await act(async () => pending.reject(new Error("SQL C:\\private\\data.db")));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "无法读取本地记录，请点击刷新重试。已有记录不会被修改。");
    fireEvent.click(screen.getByRole("button", { name: "刷新搜索" }));
    await screen.findByRole("link", { name: /健康目标/ });
    expect(screen.queryByRole("link", { name: /工作目标/ })).toBeNull();
    expect(value.searchService.list).toHaveBeenCalledTimes(3);
  });

  it.each(["searchService", "lifeDomainService"] as const)("hides old facts immediately when only %s changes", async key => {
    const original = services();
    const replacement = services();
    const pendingEntries = deferred<readonly SearchEntry[]>();
    const pendingDomains = deferred<{ id: string; name: string }[]>();
    replacement.searchService.list.mockReturnValueOnce(pendingEntries.promise);
    replacement.lifeDomainService.list.mockReturnValueOnce(pendingDomains.promise);
    const view = render(frame(original));
    await screen.findByRole("link", { name: /健康目标/ });
    const next = key === "searchService" ? { ...original, searchService: replacement.searchService }
      : { ...original, lifeDomainService: replacement.lifeDomainService };
    view.rerender(frame(next));
    expect(screen.queryByRole("link", { name: /健康目标/ })).toBeNull();
    await act(async () => {
      if (key === "searchService") pendingEntries.resolve([]);
      else pendingDomains.resolve([{ id: "work", name: "工作" }]);
    });
    await screen.findByText(key === "searchService" ? "0 条结果" : "2 条结果");
    const option = screen.getByRole("combobox", { name: "生活领域" }).querySelector('option[value="health"]');
    if (key === "lifeDomainService") expect(option).toBeNull();
    else expect(option).toBeTruthy();
  });

  it.each(["resolve", "reject"] as const)("ignores a replaced pending search %s", async outcome => {
    const original = services();
    const pending = deferred<readonly SearchEntry[]>();
    original.searchService.list.mockReturnValueOnce(pending.promise);
    const replacement = services();
    replacement.searchService.list.mockResolvedValue([]);
    const view = render(frame(original));
    view.rerender(frame(replacement));
    await screen.findByText("0 条结果");
    await act(async () => {
      if (outcome === "resolve") pending.resolve(entries);
      else pending.reject(new Error("old private"));
    });
    expect(screen.queryByRole("link", { name: /健康目标/ })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("follows same-page domain navigation without resetting other filters or rereading data", async () => {
    const value = services();
    render(frame(value, "/search?domain=health"));
    await screen.findByRole("link", { name: /健康目标/ });
    expect(screen.queryByRole("link", { name: /工作目标/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("状态"), { target: { value: "active" } });
    fireEvent.click(screen.getByRole("button", { name: "切换领域入口" }));
    await screen.findByRole("link", { name: /工作目标/ });
    expect(screen.queryByRole("link", { name: /健康目标/ })).toBeNull();
    expect(screen.getByRole("combobox", { name: "生活领域" })).toHaveProperty("value", "work");
    expect(screen.getByLabelText("状态")).toHaveProperty("value", "active");
    expect(value.searchService.list).toHaveBeenCalledTimes(1);
  });

  it.each(["", "missing"])("requires explicit recovery for invalid domain '%s' and preserves unrelated URL state", async domain => {
    const value = services();
    render(frame(value, `/search?domain=${domain}&keep=1&keep=2#source`));
    await screen.findByText("链接中的领域不可用，请明确清除领域筛选后继续。");
    expect(screen.queryByRole("link", { name: /健康目标/ })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索本地记录" }), { target: { value: "/新建行动" } });
    const command = screen.getByRole("button", { name: "新建行动" });
    expect(command).toHaveProperty("disabled", true);
    fireEvent.click(command);
    expect(screen.getByLabelText("当前位置").textContent).toContain("/search?");
    fireEvent.click(screen.getByRole("button", { name: "清除领域筛选" }));
    expect(screen.getByLabelText("当前位置").textContent).toBe(
      "/search?keep=1&keep=2&q=%2F%E6%96%B0%E5%BB%BA%E8%A1%8C%E5%8A%A8#source");
    expect(screen.getByRole("button", { name: "新建行动" })).toHaveProperty("disabled", false);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索本地记录" }), { target: { value: "" } });
    await screen.findByRole("link", { name: /健康目标/ });
    expect(screen.getByLabelText("当前位置").textContent).toBe("/search?keep=1&keep=2#source");
  });

  it("writes only query UI state, preserving hash, duplicates and the selected domain", async () => {
    const value = services();
    render(frame(value, "/search?domain=health&keep=1&keep=2#source"));
    await screen.findByRole("link", { name: /健康目标/ });
    fireEvent.change(screen.getByRole("textbox", { name: "搜索本地记录" }), { target: { value: "目标" } });
    const query = screen.getByLabelText("当前位置").textContent!;
    expect(query).toContain("domain=health&keep=1&keep=2");
    expect(query.endsWith("#source")).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "生活领域" }), { target: { value: "work" } });
    await screen.findByRole("link", { name: /工作目标/ });
    expect(screen.getByLabelText("当前位置").textContent).toContain("domain=work&keep=1&keep=2");
    expect(screen.getByRole("textbox", { name: "搜索本地记录" })).toHaveProperty("value", "目标");
    expect(value.searchService.list).toHaveBeenCalledTimes(1);
  });

  it("waits for a domain context before allowing a create command", async () => {
    const value = services();
    const pending = deferred<readonly SearchEntry[]>();
    value.searchService.list.mockReturnValueOnce(pending.promise);
    render(frame(value, "/search?domain=health&q=%2F新建行动"));
    const command = screen.getByRole("button", { name: "新建行动" });
    expect(command).toHaveProperty("disabled", true);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "搜索本地记录" }), { key: "Enter" });
    expect(screen.getByLabelText("当前位置").textContent).toContain("/search?");
    await act(async () => pending.resolve(entries));
    expect(command).toHaveProperty("disabled", false);
    fireEvent.click(command);
    expect(screen.getByLabelText("当前位置").textContent).toBe("/goals?create=action&domain=health");
  });

  it("does not show late errors or trigger another read after leaving", async () => {
    const value = services();
    const pending = deferred<readonly SearchEntry[]>();
    value.searchService.list.mockReturnValueOnce(pending.promise);
    const view = render(frame(value));
    view.unmount();
    await act(async () => pending.reject(new Error("private")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(value.searchService.list).toHaveBeenCalledTimes(1);
  });
});
