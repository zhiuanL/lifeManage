import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { VersionHistoryPage } from "../../src/pages/VersionHistoryPage";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import { LifeNavigationPage } from "../../src/pages/LifeNavigationPage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteLifeNavigationRepository } from "../../src/repositories/sqlite/SqliteLifeNavigationRepository";
import { LifeNavigationService } from "../../src/services/life/LifeNavigationService";
const clock = { now: () => new Date("2026-10-12T08:00:00Z") };
afterEach(cleanup);
function page() {
  let sequence = 0;
  const sql = new MemorySqliteExecutor();
  const service = new LifeNavigationService(new SqliteLifeNavigationRepository(sql), clock, { next: () => "nav-" + ++sequence });
  const value = { lifeNavigationService: service, versionHistoryService: new VersionHistoryService(new SqliteObjectVersionRepository(sql)) } as unknown as LifeOSContextValue;
  const mount = (path = "/navigation", component = LifeNavigationPage) => render(createElement(MemoryRouter, { initialEntries: [path] },
    createElement(LifeOSContext.Provider, { value }, createElement(component))));
  return { service, mount };
}
describe("Life navigation page", () => {
  it("shows Chinese read-only navigation history and links back to an archived record", async () => {
    const { service, mount } = page();
    const record = await service.create("vision", { title: "原方向", description: "原内容" });
    await service.update(record.id, { title: "新方向", description: "新内容" });
    await service.setArchived(record.id, true);
    mount("/navigation#navigation-" + record.id);
    const link = await screen.findByRole("link", { name: "查看新方向的版本历史" });
    expect(link.getAttribute("href")).toBe("/history?type=navigation&id=" + record.id);
    cleanup(); mount(link.getAttribute("href")!, VersionHistoryPage);
    await screen.findByText("人生导航 · 新方向");
    expect(screen.getAllByText("修改前版本")).toHaveLength(2);
    expect(screen.getAllByText("愿景与长期方向")).toHaveLength(2);
    expect(screen.getByText("原内容")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "返回原记录" }).getAttribute("href"))
      .toBe("/navigation#navigation-" + record.id);
  });
  it("handles empty, missing and failed navigation history reads", async () => {
    const { service, mount } = page();
    const record = await service.create("mission", { title: "使命", description: "" });
    mount("/history?type=navigation&id=" + record.id, VersionHistoryPage);
    await screen.findByText("尚无修改记录。");
    cleanup(); mount("/history?type=navigation&id=missing", VersionHistoryPage);
    await screen.findByText("人生导航 · 记录已不可用");
    cleanup(); vi.spyOn(service, "findById").mockRejectedValueOnce(new Error("历史读取失败"));
    mount("/history?type=navigation&id=" + record.id, VersionHistoryPage);
    expect((await screen.findByRole("alert")).textContent).toBe("修改历史读取失败，请重试。");
  });
  it("opens four read-only sections and returns focus after Escape", async () => {
    const { mount } = page(); mount();
    const add = await screen.findByRole("button", { name: "添加使命" });
    expect(screen.queryByRole("textbox")).toBeNull();
    for (const name of ["使命", "核心价值观", "愿景与长期方向", "个人原则"]) expect(screen.getByRole("region", { name })).toBeTruthy();
    fireEvent.click(add); fireEvent.change(screen.getByLabelText("标题"), { target: { value: "不保存" } });
    fireEvent.keyDown(screen.getByLabelText("标题"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(add);
  });
  it("keeps drafts after failed save, edits, archives read-only and restores", async () => {
    const { service, mount } = page(); mount();
    fireEvent.click(await screen.findByRole("button", { name: "添加愿景与长期方向" }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "长期方向" } });
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "保持成长" } });
    vi.spyOn(service, "create").mockRejectedValueOnce(new Error("保存失败"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect((await screen.findByRole("alert")).textContent).toContain("保存失败");
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("长期方向");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    const edit = await screen.findByRole("button", { name: "编辑长期方向" });
    fireEvent.click(edit); fireEvent.change(screen.getByLabelText("内容"), { target: { value: "持续学习" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("持续学习");
    fireEvent.click(screen.getByRole("button", { name: "归档长期方向" }));
    await waitFor(() => expect(screen.queryByText("持续学习")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("显示已归档")));
    fireEvent.click(screen.getByLabelText("显示已归档"));
    expect(screen.getByText("持续学习")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "编辑长期方向" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "恢复长期方向" }));
    await screen.findByRole("button", { name: "编辑长期方向" });
    expect((await service.list())[0]).toMatchObject({ description: "持续学习", archivedAt: null });
  });
  it("reveals only the linked archived record and focuses it without writing", async () => {
    const { service, mount } = page();
    const selected = await service.create("vision", { title: "归档方向", description: "原内容" });
    const other = await service.create("principle", { title: "其他归档", description: "" });
    await service.setArchived(selected.id, true); await service.setArchived(other.id, true);
    const update = vi.spyOn(service, "update"), archive = vi.spyOn(service, "setArchived");
    mount("/navigation#navigation-" + encodeURIComponent(selected.id));
    const heading = await screen.findByRole("heading", { name: "归档方向" });
    expect(screen.queryByText("其他归档")).toBeNull();
    expect((screen.getByLabelText("显示已归档") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("textbox")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(heading.closest("article")));
    expect(update).not.toHaveBeenCalled(); expect(archive).not.toHaveBeenCalled();
  });
  it("restores the command focus after editing a linked record", async () => {
    const { service, mount } = page();
    const record = await service.create("vision", { title: "链接方向", description: "原内容" });
    mount("/navigation#navigation-" + record.id);
    const edit = await screen.findByRole("button", { name: "编辑链接方向" });
    await waitFor(() => expect(document.activeElement).toBe(edit.closest("article")));
    fireEvent.click(edit);
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "更新内容" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("更新内容");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "编辑链接方向" })));
  });
  it("reports a missing link and tolerates malformed fragments", async () => {
    const { mount } = page(); mount("/navigation#navigation-missing");
    await screen.findByText("链接对应的导航记录不存在。");
    cleanup(); mount("/navigation#navigation-%ZZ");
    await screen.findByRole("button", { name: "添加使命" });
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("retries a read failure", async () => {
    const { service, mount } = page();
    vi.spyOn(service, "list").mockRejectedValueOnce(new Error("读取失败")); mount();
    expect((await screen.findByRole("alert")).textContent).toContain("读取失败");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("button", { name: "添加个人原则" });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
