import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { IdentityRolesPage } from "../../src/pages/IdentityRolesPage";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { VersionHistoryPage } from "../../src/pages/VersionHistoryPage";
import { searchEntries } from "../../src/domain/search/Search";

afterEach(cleanup);
async function page() {
  const dependencies = createApplicationDependencies();
  const result = await dependencies.bootstrapApplicationService.bootstrap();
  const value = dependencies as unknown as LifeOSContextValue;
  render(createElement(MemoryRouter, { initialEntries: ["/roles"] },
    createElement(LifeOSContext.Provider, { value }, createElement(IdentityRolesPage))));
  await screen.findByRole("button", { name: "添加身份角色" });
  return { ...dependencies, result };
}

describe("Chinese identity role management", () => {
  it("creates and rereads a linked role, retains links when inactive, archives and restores", async () => {
    const { identityRoleService, lifeDomainService } = await page();
    const domain = (await lifeDomainService.list())[0];
    fireEvent.click(screen.getByRole("button", { name: "添加身份角色" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "学习者专项" } });
    fireEvent.change(screen.getByLabelText("说明"), { target: { value: "保持好奇心" } });
    fireEvent.click(screen.getByText("关联领域与目标"));
    fireEvent.click(screen.getByLabelText(domain.name));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    const edit = await screen.findByRole("button", { name: "编辑学习者专项" });
    const role = (await identityRoleService.list()).find(item => item.name === "学习者专项")!;
    expect(role).toMatchObject({ privacyLevel: "private", domainIds: [domain.id], active: true });
    fireEvent.click(edit);
    fireEvent.click(screen.getByLabelText("启用角色"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("已停用");
    expect(await identityRoleService.findById(role.id)).toMatchObject({ active: false, domainIds: [domain.id], version: 2 });
    fireEvent.click(screen.getByRole("button", { name: "归档学习者专项" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "学习者专项" })).toBeNull());
    fireEvent.click(screen.getByLabelText("显示已归档"));
    fireEvent.click(screen.getByRole("button", { name: "恢复学习者专项" }));
    await screen.findByRole("button", { name: "编辑学习者专项" });
    expect(await identityRoleService.findById(role.id)).toMatchObject({ archivedAt: null, active: false, domainIds: [domain.id] });
  });
  it("keeps a failed creation draft and returns keyboard focus after cancelling", async () => {
    const { identityRoleService } = await page();
    const add = screen.getByRole("button", { name: "添加身份角色" });
    fireEvent.click(add);
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "家长专项" } });
    vi.spyOn(identityRoleService, "create").mockRejectedValueOnce(new Error("保存失败，请重试。"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect((await screen.findByRole("alert")).textContent).toBe("保存失败，请重试。");
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("家长专项");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("button", { name: "编辑家长专项" });
    fireEvent.click(add);
    fireEvent.keyDown(screen.getByLabelText("名称"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(add);
  });
  it("searches role status and shows read-only old fields and links with retry", async () => {
    const dependencies = await page();
    const domain = (await dependencies.lifeDomainService.list())[0];
    const role = await dependencies.identityRoleService.create({ name: "历史学习者专项", description: "原始说明",
      active: true, privacyLevel: "private", domainIds: [domain.id], goalIds: [] });
    await dependencies.identityRoleService.update(role.id, { ...role, name: "停用学习者专项",
      description: "当前说明", active: false, domainIds: [] });
    const entries = await dependencies.searchService.list();
    const filter = { query: "停用学习者", types: ["role"] as const, from: "", to: "", status: "inactive", domainId: "" };
    expect(searchEntries(entries, filter).map(entry => entry.href)).toEqual(["/roles#role-" + role.id]);
    expect(searchEntries(entries, { ...filter, domainId: domain.id })).toEqual([]);
    await dependencies.identityRoleService.setArchived(role.id, true);
    expect(searchEntries(await dependencies.searchService.list(), { ...filter, status: "archived" })).toHaveLength(1);
    cleanup();
    vi.spyOn(dependencies.versionHistoryService, "list").mockRejectedValueOnce(new Error("历史读取失败，请重试。"));
    render(createElement(MemoryRouter, { initialEntries: ["/history?type=role&id=" + role.id] },
      createElement(LifeOSContext.Provider, { value: dependencies as unknown as LifeOSContextValue },
        createElement(VersionHistoryPage))));
    expect((await screen.findByRole("alert")).textContent).toBe("修改历史读取失败，请重试。");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("修改前版本 v1");
    fireEvent.click(screen.getByText("修改前版本 v1"));
    expect(screen.getByText("历史学习者专项")).toBeTruthy();
    expect(screen.getByText("原始说明")).toBeTruthy();
    expect(screen.getByText("已启用")).toBeTruthy();
    expect(screen.getByText(domain.id)).toBeTruthy();
    expect(screen.getByRole("link", { name: "返回原记录" }).getAttribute("href")).toBe("/roles#role-" + role.id);
    expect(document.querySelector("form, input, textarea, select")).toBeNull();
  });
});
