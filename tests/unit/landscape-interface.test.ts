import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../../src/app/AppShell";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { DomainEditorDialog } from "../../src/components/DomainEditorDialog";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { LandscapePage } from "../../src/pages/LandscapePage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { LandscapePreferenceService } from "../../src/services/system/LandscapePreferenceService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { LandscapeFactService } from "../../src/services/life/LandscapeFactService";

afterEach(cleanup);

async function showLandscape(domainCount = 0) {
  const executor = new MemorySqliteExecutor();
  const clock = { now: () => new Date("2026-09-29T08:00:00.000Z") };
  await new MigrationRunner(executor, migrations, clock).run();
  let nextId = 0;
  const service = new LifeDomainService(new SqliteLifeDomainRepository(executor), clock, {
    next: () => `domain-${++nextId}`,
  });

  for (let index = 0; index < domainCount; index++) {
    await service.create({
      name: `领域${index + 1}`,
      description: "",
      focus: index === 0 ? "正在调整生活节奏" : "",
      color: "fern",
      icon: "heart",
    });
  }

  renderLandscape(service);
  return service;
}

function renderLandscape(service: LifeDomainService) {
  const context = {
    lifeDomainService: service,
    landscapeContextService: { get: async () => null },
    landscapeFactService: new LandscapeFactService(
      { list: async () => [] }, { list: async () => [] }, { list: async () => [] },
      { getSnapshot: async () => ({ settings: { idleWeeks: 4, issueOccurrences: 3, planAdjustments: 3, metricDrops: 2 }, signals: [] }) },
      { listDefinitions: async () => [], listRecords: async () => [] }, { list: async () => [] },
      { now: () => new Date("2026-10-14T08:00:00Z") },
    ),
    landscapePreferenceService: new LandscapePreferenceService({ getMetadata: async () => null, setMetadata: async () => {}, completeFirstInitialization: async () => {} }),
    theme: "mist",
    setTheme: async () => {},
  } as LifeOSContextValue;

  render(createElement(MemoryRouter, null,
    createElement(LifeOSContext.Provider, { value: context },
      createElement(Routes, null,
        createElement(Route, { element: createElement(AppShell) },
          createElement(Route, { index: true, element: createElement(LandscapePage) }),
          createElement(Route, {
            path: "domains/:domainId",
            element: createElement("p", null, "领域上下文已打开"),
          }),
          createElement(Route, {
            path: "search",
            element: createElement("p", null, "搜索页面已打开"),
          }),
        ),
      ),
    ),
  ));
}

describe("人生景观与全局导航", () => {
  it("五个默认领域保持景观入口，新增操作与领域节点分开", async () => {
    const service = await showLandscape();
    await service.addRecommended(["事业", "成长", "健康", "关系", "财务"]);
    cleanup();
    renderLandscape(service);

    await screen.findByRole("heading", { name: "我的生活" });
    const map = screen.getByRole("region", { name: "生活领域" });
    expect(within(map).getByRole("heading", { name: "我的生活" })).toBeTruthy();
    expect(within(map).getByText("5 个生活领域")).toBeTruthy();
    expect(within(map).getAllByRole("link", { name: /进入.*领域/ })).toHaveLength(5);
    expect(within(map).queryByRole("button", { name: "添加领域" })).toBeNull();
    expect(screen.getByRole("button", { name: "添加领域" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "添加推荐领域" })).toBeNull();
    expect(screen.queryByText("从学习走向实践")).toBeNull();
    expect((await screen.findByRole("link", { name: "查看复盘" })).getAttribute("href"))
      .toBe("/reviews");
  });

  it("从空白景观新增领域，保存后立即出现在节点中", async () => {
    const service = await showLandscape();
    expect(await screen.findByRole("heading", { name: "从这里开始" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /进入.*领域/ })).toBeNull();
    expect(within(screen.getByRole("region", { name: "生活领域" }))
      .queryByRole("button", { name: "添加领域" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "添加领域" }));
    const dialog = screen.getByRole("dialog", { name: "添加生活领域" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "领域名称" }), {
      target: { value: "健康" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "长期期待" }), {
      target: { value: "长期保持充沛精力" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建领域" }));

    expect(await screen.findByRole("link", { name: "进入健康领域" })).toBeTruthy();
    expect((await service.list())[0]).toMatchObject({
      name: "健康", longTermExpectation: "长期保持充沛精力", status: "active",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("已有空间主动勾选缺少的推荐领域，不重建已有领域", async () => {
    const service = await showLandscape();
    await service.create({
      name: "健康", description: "", focus: "我自己的关注", color: "fern", icon: "heart",
    });
    cleanup();
    renderLandscape(service);

    fireEvent.click(await screen.findByRole("button", { name: "添加推荐领域" }));
    const dialog = screen.getByRole("dialog", { name: "添加推荐领域" });
    expect(within(dialog).queryByRole("checkbox", { name: "健康" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "关系" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "财务" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "添加所选领域" }));

    expect(await screen.findByRole("link", { name: "进入事业领域" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "进入成长领域" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "进入健康领域" })).toBeTruthy();
    expect((await service.list()).map((domain) => domain.name))
      .toEqual(["健康", "事业", "成长"]);
    expect((await service.list())[0].focus).toBe("我自己的关注");
    expect(screen.getByRole("button", { name: "添加推荐领域" })).toBeTruthy();
  });

  it("从表单新增未启用领域并在编辑后归档，仍可进入上下文", async () => {
    const service = await showLandscape();
    fireEvent.click(await screen.findByRole("button", { name: "添加领域" }));
    const dialog = screen.getByRole("dialog", { name: "添加生活领域" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "领域名称" }),
      { target: { value: "休息" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "长期期待" }),
      { target: { value: "留出真正的休息时间" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "启用领域" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "创建领域" }));

    const inactive = await screen.findByRole("region", { name: "已暂停或归档的领域" });
    expect(within(screen.getByRole("region", { name: "生活领域" }))
      .queryByRole("link", { name: "进入休息领域" })).toBeNull();
    expect(within(inactive).getByRole("link", { name: "进入休息领域" })).toBeTruthy();
    expect((await service.list())[0]).toMatchObject({
      status: "paused", longTermExpectation: "留出真正的休息时间",
    });
    cleanup();
    const domain = (await service.list())[0];
    const context = { lifeDomainService: service } as LifeOSContextValue;
    const onSaved = vi.fn();
    render(createElement(LifeOSContext.Provider, { value: context },
      createElement(DomainEditorDialog, {
        domain, onClose: () => {}, onSaved,
      })));
    const editor = screen.getByRole("dialog", { name: "调整领域上下文" });
    fireEvent.change(within(editor).getByRole("textbox", { name: "当前状态" }),
      { target: { value: "正在腾出时间" } });
    fireEvent.change(within(editor).getByRole("combobox", { name: "领域状态" }),
      { target: { value: "archived" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(await service.findById(domain.id)).toMatchObject({
      status: "archived", currentState: "正在腾出时间",
    });
    cleanup();
    renderLandscape(service);
    const archived = await screen.findByRole("region", { name: "已暂停或归档的领域" });
    expect(within(archived).getByRole("link", { name: "进入休息领域" })).toBeTruthy();
    expect(within(archived).getByText("已归档")).toBeTruthy();
  });

  it("领域节点进入原有领域路由，并保留可见的全局搜索入口", async () => {
    await showLandscape(1);
    const node = await screen.findByRole("link", { name: "进入领域1领域" });
    expect(node.getAttribute("href")).toBe("/domains/domain-1");
    expect(screen.getByRole("navigation", { name: "主要页面" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "搜索本地记录" })).toBeTruthy();

    fireEvent.click(node);
    expect(await screen.findByText("领域上下文已打开")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "搜索本地记录" }));
    expect(await screen.findByText("搜索页面已打开")).toBeTruthy();
  });

  it("主景观容纳八个领域，第九个领域仍有可点击的入口", async () => {
    await showLandscape(9);
    await screen.findByRole("link", { name: "进入领域9领域" });
    const map = screen.getByRole("region", { name: "生活领域" });
    const more = screen.getByRole("region", { name: "更多生活领域" });
    expect(within(map).getAllByRole("link", { name: /进入.*领域/ })).toHaveLength(8);
    expect(within(more).getByRole("link", { name: "进入领域9领域" })
      .getAttribute("href")).toBe("/domains/domain-9");
    expect(within(map).getByText("正在调整生活节奏")).toBeTruthy();
  });

  it("暂停及归档从主景观移出，但保留可进入和恢复的领域", async () => {
    const service = await showLandscape(2);
    await screen.findByRole("link", { name: "进入领域1领域" });
    const original = (await service.list())[0];
    await service.update(original.id, { ...original, status: "paused" });
    cleanup();
    renderLandscape(service);
    await screen.findByRole("region", { name: "已暂停或归档的领域" });
    const map = screen.getByRole("region", { name: "生活领域" });
    const inactive = screen.getByRole("region", { name: "已暂停或归档的领域" });
    expect(within(map).queryByRole("link", { name: "进入领域1领域" })).toBeNull();
    expect(within(inactive).getByRole("link", { name: "进入领域1领域" })
      .getAttribute("href")).toBe("/domains/domain-1");
    expect(within(inactive).getByText("已暂停")).toBeTruthy();
    const paused = (await service.findById(original.id))!;
    await service.update(paused.id, { ...paused, status: "archived" });
    expect((await service.findById(paused.id))?.status).toBe("archived");
    cleanup();
    renderLandscape(service);
    expect(await screen.findByText("已归档")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "已暂停或归档的领域" }))
      .getByRole("link", { name: "进入领域1领域" })).toBeTruthy();
  });
});
