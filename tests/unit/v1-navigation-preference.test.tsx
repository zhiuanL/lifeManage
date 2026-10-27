import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { AppShell } from "../../src/app/AppShell";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { currentNavigationModule, secondaryNavigation } from "../../src/app/NavigationCatalog";
import { NavigationSettings } from "../../src/components/NavigationSettings";
import { defaultModulePreference } from "../../src/domain/system/ModulePreference";
import { defaultNavigationPreference, movePinnedCapability, togglePinnedCapability,
  validateNavigationPreference, type NavigationPreference } from "../../src/domain/system/NavigationPreference";
import { MorePage } from "../../src/pages/MorePage";
import { CalendarPage } from "../../src/pages/CalendarPage";
import { NavigationPreferenceService } from "../../src/services/system/NavigationPreferenceService";
import { SqliteSystemRepository } from "../../src/repositories/sqlite/SqliteSystemRepository";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(cleanup);

it("preserves secondary route filters without URLSearchParams.size", () => {
  const size = vi.spyOn(URLSearchParams.prototype, "size", "get")
    .mockReturnValue(undefined as unknown as number);
  try {
    const goals = secondaryNavigation("/goals", "?domain=health");
    expect(goals.find(item => item.label === "全部记录")?.to)
      .toBe("/goals?goalStatus=all&actionStatus=all&domain=health");
    expect(goals.find(item => item.label === "已完成")?.to)
      .toBe("/goals?goalStatus=completed&actionStatus=completed&domain=health");
    expect(secondaryNavigation("/reviews", "?domain=health")
      .find(item => item.label === "周复盘")?.to).toBe("/reviews?cycle=weekly&domain=health");
    expect(secondaryNavigation("/calendar", "?domain=health")
      .find(item => item.label === "月视图")?.to).toBe("/calendar?view=month&domain=health");
    expect(secondaryNavigation("/settings", "")[0].to).toBe("/settings");
  } finally { size.mockRestore(); }
});

function LocationProbe() {
  const { search, hash } = useLocation();
  return <output aria-label="当前位置">{search + hash}</output>;
}

it("starts empty, preserves order, validates keys and never mutates the old preference", () => {
  const original = { pinnedCapabilities: ["habits", "metrics"] } as const;
  expect(defaultNavigationPreference()).toEqual({ pinnedCapabilities: [] });
  expect(movePinnedCapability(original, "metrics", -1)).toEqual({ pinnedCapabilities: ["metrics", "habits"] });
  expect(movePinnedCapability(original, "habits", -1)).toEqual(original);
  expect(togglePinnedCapability(original, "habits")).toEqual({ pinnedCapabilities: ["metrics"] });
  expect(togglePinnedCapability(original, "people")).toEqual({ pinnedCapabilities: ["habits", "metrics", "people"] });
  expect(original.pinnedCapabilities).toEqual(["habits", "metrics"]);
  for (const value of [null, [], {}, { pinnedCapabilities: ["unknown"] },
    { pinnedCapabilities: ["habits", "habits"] }]) expect(() => validateNavigationPreference(value)).toThrow();
});

it("persists in SQLite metadata without replacing other settings or advancing schema", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const executor = nativeSqliteExecutor(db);
    const clock = { now: () => new Date("2026-10-22T08:00:00Z") };
    await new MigrationRunner(executor, migrations, clock).run();
    const repository = new SqliteSystemRepository(executor, clock);
    await repository.setMetadata("v1_module_preference", '{"disabledModules":["habits"]}');
    const service = new NavigationPreferenceService(repository);
    expect(await service.get()).toEqual(defaultNavigationPreference());
    await service.update(current => togglePinnedCapability(current, "habits"));
    await service.update(current => togglePinnedCapability(current, "metrics"));
    expect(await new NavigationPreferenceService(repository).get()).toEqual({ pinnedCapabilities: ["habits", "metrics"] });
    expect(await repository.getMetadata("v1_module_preference")).toBe('{"disabledModules":["habits"]}');
    const writes = vi.spyOn(repository, "setMetadata");
    await expect(service.update(() => ({ pinnedCapabilities: ["invalid"] } as unknown as NavigationPreference))).rejects.toThrow();
    expect(writes).not.toHaveBeenCalled();
    await repository.setMetadata("v1_navigation_preference", "broken");
    await expect(service.get()).rejects.toThrow("导航设置读取失败");
    expect(await repository.getMetadata("v1_navigation_preference")).toBe("broken");
  } finally { db.close(); }
});

it("serializes independent commands and recovers after a failed save without losing committed pins", async () => {
  let value: string | null = null;
  const setMetadata = vi.fn(async (_key: string, next: string) => { value = next; });
  const service = new NavigationPreferenceService({
    getMetadata: async () => value, setMetadata, completeFirstInitialization: vi.fn(),
  });
  const first = service.update(current => togglePinnedCapability(current, "habits"));
  const second = service.update(current => togglePinnedCapability(current, "people"));
  await Promise.all([first, second]);
  expect(await service.get()).toEqual({ pinnedCapabilities: ["habits", "people"] });
  setMetadata.mockRejectedValueOnce(new Error("private storage path"));
  const failed = service.update(current => togglePinnedCapability(current, "metrics"));
  const retry = service.update(current => togglePinnedCapability(current, "skills"));
  await expect(failed).rejects.toThrow();
  await retry;
  expect(await service.get()).toEqual({ pinnedCapabilities: ["habits", "people", "skills"] });
});

it("builds only real module views and retains explicit domain without forwarding creation commands", () => {
  expect(currentNavigationModule("/goals/a")?.path).toBe("/goals");
  expect(currentNavigationModule("/goals-other")).toBeUndefined();
  expect(secondaryNavigation("/", "")).toEqual([]);
  const items = secondaryNavigation("/goals/a", "?domain=a%2Fb&create=action&template=old&goal=other");
  const all = new URL(items.find(item => item.label === "全部记录")!.to, "http://local");
  expect(all.searchParams.get("domain")).toBe("a/b");
  expect(all.searchParams.get("goalStatus")).toBe("all");
  expect(all.searchParams.has("create")).toBe(false);
  expect(all.searchParams.has("template")).toBe(false);
  expect(all.searchParams.has("goal")).toBe(false);
  expect(items.some(item => item.active)).toBe(false);
  expect(items.find(item => item.label === "返回领域")?.to).toBe("/domains/a%2Fb");
  expect(items.find(item => item.label === "全部领域")?.to).toBe("/goals");
  expect(secondaryNavigation("/inbox", "?domain=x")).toEqual([{ label: "全部记录", to: "/inbox", active: true }]);
  expect(secondaryNavigation("/reviews", "?cycle=daily")[1]).toEqual({
    label: "日复盘", to: "/reviews?cycle=daily", active: true,
  });
  expect(secondaryNavigation("/calendar", "?view=month&domain=x").find(item => item.active)?.label).toBe("月视图");
});

it("preserves comparison choices and observation period and never invents extra selected domains", () => {
  const start = secondaryNavigation("/analytics", "?domain=a&weeks=8&goal=g");
  expect(start.find(item => item.label === "多领域对比")?.to).toBe("/analytics?view=compare&weeks=8&compareDomain=a");
  const compare = secondaryNavigation("/analytics", "?view=compare&compareDomain=a&compareDomain=b&weeks=12&goal=g");
  const next = new URL(compare.find(item => item.active)!.to, "http://local");
  expect(next.searchParams.getAll("compareDomain")).toEqual(["a", "b"]);
  expect(next.searchParams.get("weeks")).toBe("12");
  expect(next.searchParams.get("goal")).toBe("g");
  expect(new URL(compare[0].to, "http://local").searchParams.has("domain")).toBe(false);
});

async function fixture() {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  await app.navigationPreferenceService.update(() => defaultNavigationPreference());
  return app;
}

it("retries failed pins, synchronously blocks duplicate commands, updates sidebar and allows ordering", async () => {
  const app = await fixture();
  const save = vi.spyOn(app.navigationPreferenceService, "update").mockRejectedValueOnce(new Error("raw path"));
  function Harness() {
    const [navigationPreference, setPreference] = useState(defaultNavigationPreference());
    const context = { ...app, theme: "night", setTheme: vi.fn(),
      modulePreference: defaultModulePreference(), navigationPreference,
      updateNavigationPreference: async change => setPreference(await app.navigationPreferenceService.update(change)),
    } satisfies LifeOSContextValue;
    return <LifeOSContext.Provider value={context}>
      <Routes><Route element={<AppShell />}><Route path="more" element={<><MorePage /><NavigationSettings /></>} /></Route></Routes>
    </LifeOSContext.Provider>;
  }
  render(<MemoryRouter initialEntries={["/more"]}><Harness /></MemoryRouter>);
  expect(screen.getByRole("button", { name: "展开侧栏" }).getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("navigation", { name: "常用能力" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "固定习惯", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "固定习惯", exact: true }));
  await screen.findByText("导航设置保存失败，请重试。");
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("navigation", { name: "常用能力" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "固定习惯", exact: true }));
  await screen.findByRole("navigation", { name: "常用能力" });
  fireEvent.click(screen.getByRole("button", { name: "固定人物", exact: true }));
  await waitFor(() => expect(within(screen.getByRole("navigation", { name: "常用能力" })).getAllByRole("link")).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "上移人物", exact: true }));
  await waitFor(() => expect(within(screen.getByRole("navigation", { name: "常用能力" })).getAllByRole("link")[0].getAttribute("href")).toBe("/people"));
  fireEvent.click(screen.getByRole("button", { name: "展开侧栏" }));
  expect(screen.getByRole("button", { name: "收起侧栏" }).getAttribute("aria-expanded")).toBe("true");
  expect(await app.navigationPreferenceService.get()).toEqual({ pinnedCapabilities: ["people", "habits"] });
});

it("hides stopped pins without deleting their position and keeps pinned entries global", async () => {
  const app = await fixture();
  const context = { ...app, theme: "night", setTheme: vi.fn(), navigationPreference: {
    pinnedCapabilities: ["habits", "metrics"],
  }, modulePreference: { disabledModules: ["habits"] } } as LifeOSContextValue;
  const page = render(<MemoryRouter initialEntries={["/metrics?domain=x&create=metric"]}>
    <LifeOSContext.Provider value={context}><AppShell /></LifeOSContext.Provider>
  </MemoryRouter>);
  const pins = screen.getByRole("navigation", { name: "常用能力" });
  expect(within(pins).queryByRole("link", { name: "习惯" })).toBeNull();
  expect(within(pins).getByRole("link", { name: "每日状态与指标" }).getAttribute("href")).toBe("/metrics");
  expect(screen.getByRole("link", { name: "更多", exact: true }).classList.contains("active")).toBe(false);
  page.rerender(<MemoryRouter initialEntries={["/metrics?domain=x&create=metric"]}>
    <LifeOSContext.Provider value={{ ...context, modulePreference: defaultModulePreference() }}><AppShell /></LifeOSContext.Provider>
  </MemoryRouter>);
  expect(within(screen.getByRole("navigation", { name: "常用能力" })).getAllByRole("link")
    .map(link => link.getAttribute("href"))).toEqual(["/habits", "/metrics"]);
  expect(context.navigationPreference?.pinnedCapabilities).toEqual(["habits", "metrics"]);
});

it("opens calendar URL views and changing view preserves unrelated parameters and explicit domain", async () => {
  const app = await fixture();
  const domains = await app.lifeDomainService.list();
  const domain = domains[0].id;
  render(<MemoryRouter initialEntries={[`/calendar?domain=${encodeURIComponent(domain)}&view=month&extra=one&extra=two`]}>
    <LifeOSContext.Provider value={{ ...app, theme: "night", setTheme: vi.fn() }}>
      <Routes><Route element={<AppShell />}><Route path="calendar" element={<><CalendarPage /><LocationProbe /></>} /></Route></Routes>
    </LifeOSContext.Provider>
  </MemoryRouter>);
  await screen.findByRole("region", { name: "月视图" });
  fireEvent.click(screen.getByRole("button", { name: "周", exact: true }));
  await screen.findByRole("region", { name: "周视图" });
  const nav = screen.getByRole("navigation", { name: "日历二级导航" });
  expect(within(nav).getByRole("link", { name: "周视图" }).getAttribute("aria-current")).toBe("page");
  expect(within(nav).getByRole("link", { name: "月视图" }).getAttribute("href")).toContain(encodeURIComponent(domain));
  const location = new URLSearchParams(screen.getByLabelText("当前位置").textContent!);
  expect(location.getAll("extra")).toEqual(["one", "two"]);
  expect(location.get("domain")).toBe(domain);
  expect(location.get("view")).toBe("week");
});

it("requires explicit recovery from an invalid calendar view without discarding other URL values", async () => {
  const app = await fixture();
  render(<MemoryRouter initialEntries={["/calendar?view=unknown&extra=keep#source"]}>
    <LifeOSContext.Provider value={{ ...app, theme: "night", setTheme: vi.fn() }}>
      <CalendarPage /><LocationProbe />
    </LifeOSContext.Provider>
  </MemoryRouter>);
  await screen.findByRole("heading", { name: "日历视图不存在" });
  expect(screen.queryByRole("region", { name: "议程" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "返回议程" }));
  await screen.findByRole("region", { name: "议程" });
  expect(screen.getByLabelText("当前位置").textContent).toBe("?extra=keep#source");
});
