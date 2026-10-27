import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Outlet, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { findSearchCommands, searchCommandTarget } from "../../src/app/searchCommands";
import { defaultModulePreference } from "../../src/domain/system/ModulePreference";
import { SearchPage } from "../../src/pages/SearchPage";

afterEach(cleanup);

describe("V1 中文搜索动作", () => {
  it("keeps ordinary queries as search and shows explicit action candidates", () => {
    const preference = defaultModulePreference();
    expect(findSearchCommands("睡眠", preference)).toEqual({ mode: "none", commands: [] });
    expect(findSearchCommands("/", preference).mode).toBe("commands");
    expect(findSearchCommands("新建行动", preference).commands.map(command => command.id))
      .toEqual(["create-action"]);
    expect(findSearchCommands("/打开复盘", preference).commands.map(command => command.id))
      .toEqual(["open-reviews"]);
    expect(findSearchCommands("快速记录", preference).commands.map(command => command.id))
      .toEqual(["capture"]);
    expect(findSearchCommands("记录", preference).commands.map(command => command.id))
      .toEqual(["capture"]);
    expect(findSearchCommands("/不存在的命令", preference).commands).toEqual([]);
  });

  it("respects disabled modules and carries domain context only to capability pages", () => {
    const result = findSearchCommands("/", { disabledModules: ["goals", "inbox"] });
    expect(result.commands.some(command => command.to.startsWith("/goals"))).toBe(false);
    expect(result.commands.some(command => command.id === "capture")).toBe(false);
    const create = findSearchCommands("创建复盘", defaultModulePreference()).commands[0];
    expect(searchCommandTarget(create, "中文 & 领域")).toBe(
      "/reviews?create=review&domain=%E4%B8%AD%E6%96%87+%26+%E9%A2%86%E5%9F%9F");
    const settings = findSearchCommands("打开设置", defaultModulePreference()).commands[0];
    expect(searchCommandTarget(settings, "health")).toBe("/settings");
  });

  it("opens global daily metrics without creating data or imposing a domain", () => {
    const preference = { disabledModules: ["analytics"] as const };
    for (const query of ["打开每日状态与指标", "/metrics", "/打开指标"]) {
      const commands = findSearchCommands(query, { disabledModules: [...preference.disabledModules] }).commands;
      expect(commands).toEqual([expect.objectContaining({
        id: "open-metrics", kind: "navigate", to: "/metrics",
      })]);
      expect(searchCommandTarget(commands[0], "health")).toBe("/metrics");
    }
    expect(findSearchCommands("新建指标", defaultModulePreference()).commands).toEqual([]);
  });

  it("opens the shared capture only after confirmation and supports keyboard candidates", async () => {
    const openQuickCapture = vi.fn();
    const context = {
      modulePreference: defaultModulePreference(),
      searchService: { list: vi.fn().mockResolvedValue([]) },
      lifeDomainService: { list: vi.fn().mockResolvedValue([]) },
    } as unknown as LifeOSContextValue;
    render(<LifeOSContext.Provider value={context}>
      <MemoryRouter initialEntries={["/search"]}><Routes>
        <Route element={<Outlet context={{ openQuickCapture }} />}>
          <Route path="/search" element={<SearchPage />} />
          <Route path="/goals" element={<p>目标表单入口</p>} />
        </Route>
      </Routes></MemoryRouter>
    </LifeOSContext.Provider>);
    const input = screen.getByRole("textbox", { name: "搜索本地记录" });
    await waitFor(() => expect(screen.getByText("0 条结果")).toBeTruthy());
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "/快速记录" } });
    expect(openQuickCapture).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const capture = screen.getByRole("button", { name: "快速记录" });
    expect(document.activeElement).toBe(capture);
    fireEvent.keyDown(capture, { key: "Escape" });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(openQuickCapture).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(openQuickCapture).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "搜索本地记录" })).toBe(input);
    fireEvent.change(input, { target: { value: "/新建行动" } });
    fireEvent.click(screen.getByRole("button", { name: "新建行动" }));
    expect(screen.getByText("目标表单入口")).toBeTruthy();
  });
});
