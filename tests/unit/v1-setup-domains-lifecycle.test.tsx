import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { SetupDomains } from "../../src/components/SetupDomains";
import type { LifeDomain, LifeDomainDraft } from "../../src/domain/life/LifeDomain";
import { builtInTemplates, type Template } from "../../src/domain/templates/Template";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function domain(name: string, index: number): LifeDomain {
  return { id: `${name}-${index}`, name, sortOrder: index, status: "active", color: "fern", icon: "heart",
    description: "", focus: "", currentState: "", longTermExpectation: "",
    createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z" };
}
function services(names = ["健康", "成长"]) {
  const domains = names.map(domain);
  return { domains, lifeDomainService: {
    list: vi.fn(async () => domains),
    reorder: vi.fn<(ids: readonly string[]) => Promise<void>>(async () => {}),
    create: vi.fn(async (draft: LifeDomainDraft) => ({ ...domain(draft.name, 2), ...draft, status: draft.status ?? "active" })),
    update: vi.fn(async (id: string, draft: LifeDomainDraft) => ({ ...domain(draft.name, 0), ...draft, id, status: draft.status ?? "active" })),
  }, templateService: { find: vi.fn<(id: string) => Promise<Template | null>>(async () => null) } };
}
function Location() {
  const location = useLocation();
  return <output aria-label="当前位置">{location.pathname + location.search + location.hash}</output>;
}
function view(source: ReturnType<typeof services>, changed = vi.fn(), path = "/settings") {
  return <MemoryRouter initialEntries={[path]}>
    <LifeOSContext.Provider value={source as unknown as LifeOSContextValue}>
      <SetupDomains onDomainsChanged={changed} /><Location />
    </LifeOSContext.Provider>
  </MemoryRouter>;
}
async function list() { return screen.findByRole("list", { name: "领域全局顺序" }); }
function orderedNames() {
  return within(screen.getByRole("list", { name: "领域全局顺序" })).getAllByRole("listitem")
    .map(item => item.querySelector("strong")?.textContent);
}

it("hides old domains while reading a replacement source", async () => {
  const original = services(), replacement = services(["财务", "关系"]);
  const pending = deferred<LifeDomain[]>();
  replacement.lifeDomainService.list.mockReturnValueOnce(pending.promise);
  const page = render(view(original)); await list();
  page.rerender(view(replacement));
  expect(screen.queryByRole("list", { name: "领域全局顺序" })).toBeNull();
  expect(screen.getByRole("button", { name: "添加领域" })).toHaveProperty("disabled", true);
  await act(async () => pending.resolve(replacement.domains));
  await list();
  expect(orderedNames()).toEqual(["财务", "关系"]);
});

it("does not publish a late old list or read error after replacement", async () => {
  const original = services(), replacement = services(["财务", "关系"]), changed = vi.fn();
  const pending = deferred<LifeDomain[]>();
  original.lifeDomainService.list.mockReturnValueOnce(pending.promise);
  const page = render(view(original, changed));
  page.rerender(view(replacement, changed)); await list();
  const calls = changed.mock.calls.length;
  await act(async () => pending.resolve(original.domains));
  expect(orderedNames()).toEqual(["财务", "关系"]);
  expect(changed).toHaveBeenCalledTimes(calls);
});

it("requires a fresh list after switching away and back to the same service", async () => {
  const original = services(), replacement = services(["财务", "关系"]);
  const page = render(view(original)); await list();
  page.rerender(view(replacement)); await screen.findByRole("button", { name: "下移财务" });
  const pending = deferred<LifeDomain[]>();
  original.lifeDomainService.list.mockReturnValueOnce(pending.promise);
  page.rerender(view(original));
  expect(screen.queryByRole("list", { name: "领域全局顺序" })).toBeNull();
  await act(async () => pending.resolve(original.domains));
  await list();
  expect(original.lifeDomainService.list).toHaveBeenCalledTimes(2);
});

it("retains the original ordering draft and retries only its original service", async () => {
  const original = services(), replacement = services(["财务", "关系"]);
  original.lifeDomainService.reorder.mockRejectedValueOnce(new Error("SQLITE private path"));
  const page = render(view(original)); await list();
  fireEvent.click(screen.getByRole("button", { name: "下移健康" }));
  page.rerender(view(replacement));
  await waitFor(() => expect(replacement.lifeDomainService.list).toHaveBeenCalledOnce());
  expect(orderedNames()).toEqual(["成长", "健康"]);
  expect(screen.getByText("领域顺序草稿仍属于原生活空间，可继续保存或取消。").getAttribute("role")).toBe("status");
  fireEvent.click(screen.getByRole("button", { name: "保存顺序" }));
  expect((await screen.findByRole("alert")).textContent).toContain("领域顺序保存失败");
  expect(orderedNames()).toEqual(["成长", "健康"]);
  fireEvent.click(screen.getByRole("button", { name: "保存顺序" }));
  await waitFor(() => expect(orderedNames()).toEqual(["财务", "关系"]));
  expect(original.lifeDomainService.reorder).toHaveBeenNthCalledWith(2, ["成长-1", "健康-0"]);
  expect(replacement.lifeDomainService.reorder).not.toHaveBeenCalled();
  expect(screen.queryByText("领域顺序已保存")).toBeNull();
});

it("blocks competing controls during a write and never publishes old saved order to the replacement", async () => {
  const original = services(), replacement = services(["财务", "关系"]), changed = vi.fn();
  const pending = deferred<void>();
  original.lifeDomainService.reorder.mockReturnValueOnce(pending.promise);
  const page = render(view(original, changed)); await list();
  fireEvent.click(screen.getByRole("button", { name: "下移健康" }));
  const save = screen.getByRole("button", { name: "保存顺序" });
  fireEvent.click(save); fireEvent.click(save);
  expect(original.lifeDomainService.reorder).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "取消" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "下移成长" })).toHaveProperty("disabled", true);
  page.rerender(view(replacement, changed));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(replacement.domains));
  const calls = changed.mock.calls.length;
  await act(async () => pending.resolve());
  expect(orderedNames()).toEqual(["财务", "关系"]);
  expect(changed).toHaveBeenCalledTimes(calls);
  expect(replacement.lifeDomainService.list).toHaveBeenCalledOnce();
});

it("cancels an original draft explicitly and reads only the current source", async () => {
  const original = services(), replacement = services(["财务", "关系"]);
  const page = render(view(original)); await list();
  fireEvent.click(screen.getByRole("button", { name: "下移健康" }));
  page.rerender(view(replacement));
  await waitFor(() => expect(replacement.lifeDomainService.list).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(orderedNames()).toEqual(["财务", "关系"]));
  expect(replacement.lifeDomainService.list).toHaveBeenCalledTimes(2);
  expect(original.lifeDomainService.reorder).not.toHaveBeenCalled();
});

it("keeps an original domain editor and its failed draft without contaminating the replacement list", async () => {
  const original = services(), replacement = services(["财务", "关系"]), changed = vi.fn();
  original.lifeDomainService.update.mockRejectedValueOnce(new Error("private failure"));
  const page = render(view(original, changed)); await list();
  fireEvent.click(screen.getByRole("button", { name: "编辑健康" }));
  const dialog = screen.getByRole("dialog");
  const name = within(dialog).getByRole("textbox", { name: "领域名称" });
  fireEvent.change(name, { target: { value: "自己的健康" } });
  page.rerender(view(replacement, changed));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(replacement.domains));
  expect(within(screen.getByRole("dialog")).getByRole("textbox", { name: "领域名称" })).toBe(name);
  fireEvent.click(within(dialog).getByRole("button", { name: "保存修改" }));
  await screen.findByText("保存领域失败，请重试。");
  expect(name).toHaveProperty("value", "自己的健康");
  const calls = changed.mock.calls.length;
  fireEvent.click(within(dialog).getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(orderedNames()).toEqual(["财务", "关系"]);
  expect(changed).toHaveBeenCalledTimes(calls);
  expect(original.lifeDomainService.update).toHaveBeenCalledTimes(2);
  expect(replacement.lifeDomainService.update).not.toHaveBeenCalled();
});

it("sanitizes a current read failure without allowing edits until explicit retry", async () => {
  const original = services();
  original.lifeDomainService.list.mockRejectedValueOnce("C:\\private\\db");
  render(view(original));
  expect((await screen.findByRole("alert")).textContent).toContain("人生领域读取失败，请重试。");
  expect(screen.queryByRole("list", { name: "领域全局顺序" })).toBeNull();
  expect(screen.getByRole("button", { name: "添加领域" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  await list();
  expect(original.lifeDomainService.list).toHaveBeenCalledTimes(2);
});

it("rejects an explicitly empty template request and preserves other parameters on cancellation", async () => {
  const original = services();
  render(view(original, vi.fn(), "/settings?template=&keep=1&keep=2#position"));
  expect((await screen.findByRole("alert")).textContent).toContain("领域模板入口无效");
  expect(screen.getByRole("button", { name: "添加领域" })).toHaveProperty("disabled", true);
  expect(original.templateService.find).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消模板请求" }));
  await waitFor(() => expect(screen.getByLabelText("当前位置").textContent).toBe("/settings?keep=1&keep=2#position"));
  expect(original.lifeDomainService.create).not.toHaveBeenCalled();
});

it("ignores a late template read after source replacement and consumes only the current request", async () => {
  const original = services(), replacement = services(["财务", "关系"]);
  const template = builtInTemplates.find(item => item.id === "default-domain-heart")!;
  const pending = deferred<Template | null>();
  original.templateService.find.mockReturnValueOnce(pending.promise);
  replacement.templateService.find.mockResolvedValueOnce({ ...template, defaults: { ...template.defaults, name: "当前模板" } });
  const path = "/settings?template=default-domain-heart&keep=1#position";
  const page = render(view(original, vi.fn(), path));
  await waitFor(() => expect(original.templateService.find).toHaveBeenCalledOnce());
  page.rerender(view(replacement, vi.fn(), path));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("textbox", { name: "领域名称" })).toHaveProperty("value", "当前模板");
  await act(async () => pending.resolve(template));
  expect(within(dialog).getByRole("textbox", { name: "领域名称" })).toHaveProperty("value", "当前模板");
  await waitFor(() => expect(screen.getByLabelText("当前位置").textContent).toBe("/settings?keep=1#position"));
  expect(original.lifeDomainService.create).not.toHaveBeenCalled();
  expect(replacement.lifeDomainService.create).not.toHaveBeenCalled();
});
