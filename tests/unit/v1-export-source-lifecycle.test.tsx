import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import type { ExportRecord } from "../../src/domain/export/ContextExport";
import { builtInTemplates, type Template } from "../../src/domain/templates/Template";
import { ContextExportPage } from "../../src/pages/ContextExportPage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function record(type: ExportRecord["type"], id: string, title: string, domainIds: string[] = []): ExportRecord {
  return { type, id, title, date: "2026-10-21", domainIds, goalId: null,
    privacy: "normal", fields: [], links: [] };
}
const records = [
  record("domain", "d", "健康"), record("domain", "other", "学习"),
  record("goal", "g", "照看身体", ["d"]), record("goal", "other-g", "学习目标", ["other"]),
];
const template = builtInTemplates.find(item => item.id === "default-export-goal-analysis")!;
function context(items = records) {
  return {
    environment: "browser-preview",
    contextExportService: {
      loadRecords: vi.fn(async (): Promise<readonly ExportRecord[]> => items),
      setPrivacy: vi.fn(async () => {}),
    },
    templateService: { find: vi.fn(async (): Promise<Template | null> => template) },
  };
}
function Host() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output aria-label="当前位置">{location.pathname + location.search + location.hash}</output>
    <button onClick={() => navigate("/export?domain=other&keep=1&keep=2#source")}>切换领域入口</button>
    <button onClick={() => navigate("/export?domain=&keep=1&keep=2#source")}>空领域入口</button>
    <button onClick={() => navigate("/export")}>全局入口</button>
    <button onClick={() => navigate(`/export?template=${template.id}&keep=1&keep=2#source`)}>模板入口</button>
    <ContextExportPage />
  </>;
}
function mount(value: ReturnType<typeof context>, path = "/export?domain=d") {
  const tree = (next: ReturnType<typeof context>) =>
    <LifeOSContext.Provider value={next as unknown as LifeOSContextValue}>
      <MemoryRouter initialEntries={[path]}><Host /></MemoryRouter>
    </LifeOSContext.Provider>;
  const view = render(tree(value));
  return { ...view, replace: (next: ReturnType<typeof context>) => view.rerender(tree(next)) };
}
async function ready() {
  await screen.findByRole("heading", { name: "导出预览" });
}
function preview() { return screen.getByLabelText("导出预览").querySelector("pre")?.textContent ?? ""; }
function copy() { return screen.getByRole("button", { name: "复制", exact: true }); }
function params() {
  return new URL(screen.getByLabelText("当前位置").textContent ?? "", "http://localhost").searchParams;
}
function allowPrivate() {
  fireEvent.change(screen.getByLabelText("允许纳入的最高隐私等级"), { target: { value: "private" } });
  fireEvent.click(screen.getByLabelText(/我已查看预览/));
}
function privacy() { return screen.getByLabelText("目标 照看身体 的隐私等级"); }

describe("export source and scope boundaries", () => {
  it("hides old facts immediately on source replacement and ignores late source reads", async () => {
    const old = context();
    const pending = deferred<readonly ExportRecord[]>();
    old.contextExportService.loadRecords.mockReturnValueOnce(pending.promise);
    const view = mount(old);
    const next = context([records[0], record("goal", "new-g", "新来源", ["d"])]);
    const newRead = deferred<readonly ExportRecord[]>();
    next.contextExportService.loadRecords.mockReturnValueOnce(newRead.promise);
    view.replace(next);
    await act(async () => pending.resolve(records));
    expect(screen.queryByRole("heading", { name: "导出预览" })).toBeNull();
    await act(async () => newRead.resolve([records[0], record("goal", "new-g", "新来源", ["d"])]));
    await ready();
    expect(preview()).toContain("新来源");
    expect(preview()).not.toContain("照看身体");
  });
  it("keeps the draft but invalidates private confirmation even for identical replacement facts", async () => {
    const value = context();
    const view = mount(value);
    await ready();
    fireEvent.change(screen.getByLabelText("希望讨论的问题"), { target: { value: "原草稿" } });
    allowPrivate();
    const before = preview();
    expect(copy()).toHaveProperty("disabled", false);
    const next = context();
    const pending = deferred<readonly ExportRecord[]>();
    next.contextExportService.loadRecords.mockReturnValueOnce(pending.promise);
    view.replace(next);
    expect(screen.queryByRole("heading", { name: "导出预览" })).toBeNull();
    await act(async () => pending.resolve(records));
    await ready();
    expect(preview()).toBe(before);
    expect(screen.getByLabelText("希望讨论的问题")).toHaveProperty("value", "原草稿");
    expect(screen.getByLabelText(/我已查看预览/)).toHaveProperty("checked", false);
    expect(copy()).toHaveProperty("disabled", true);
  });
  it("rereads without stale previews and requires a new confirmation after refresh", async () => {
    const value = context();
    mount(value);
    await ready();
    allowPrivate();
    const pending = deferred<readonly ExportRecord[]>();
    value.contextExportService.loadRecords.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "重新读取导出记录" }));
    expect(screen.queryByRole("heading", { name: "导出预览" })).toBeNull();
    await act(async () => pending.resolve(records));
    await ready();
    expect(screen.getByLabelText(/我已查看预览/)).toHaveProperty("checked", false);
    expect(copy()).toHaveProperty("disabled", true);
  });
  it("follows same-page domain links without silently clearing a now unavailable goal", async () => {
    mount(context());
    await ready();
    fireEvent.change(screen.getByLabelText("关联目标"), { target: { value: "g" } });
    fireEvent.click(screen.getByRole("button", { name: "切换领域入口" }));
    expect(screen.getByRole("combobox", { name: "生活领域", exact: true })).toHaveProperty("value", "other");
    expect(screen.getByText(/所选目标在当前范围不可用/)).toBeTruthy();
    expect(preview()).not.toContain("照看身体");
    expect(preview()).not.toContain("学习目标");
    expect(copy()).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "清除目标筛选" }));
    expect(preview()).toContain("学习目标");
    expect(preview()).not.toContain("照看身体");
    expect(params().getAll("keep")).toEqual(["1", "2"]);
    expect(screen.getByLabelText("当前位置").textContent).toContain("#source");
    fireEvent.click(screen.getByRole("button", { name: "全局入口" }));
    expect(preview()).toContain("照看身体");
    expect(preview()).toContain("学习目标");
  });
  it.each(["", "missing"])("does not expand invalid domain %j into global exports", async domain => {
    mount(context(), `/export?domain=${domain}&keep=1&keep=2#source`);
    await ready();
    expect(screen.getByText(/链接中的领域不可用/)).toBeTruthy();
    expect(preview()).not.toContain("照看身体");
    expect(copy()).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "清除领域筛选" }));
    expect(preview()).toContain("照看身体");
    expect(params().has("domain")).toBe(false);
    expect(params().getAll("keep")).toEqual(["1", "2"]);
    expect(screen.getByLabelText("当前位置").textContent).toContain("#source");
  });
  it("retains an invalid inherited scope when consuming a template-only request", async () => {
    const value = context();
    mount(value, "/export?domain=");
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "模板入口" }));
    // No user draft: a valid template may apply automatically, but never clears the invalid scope.
    await waitFor(() => expect(params().has("template")).toBe(false));
    expect(params().get("domain")).toBe("");
    expect(screen.getByText(/链接中的领域不可用/)).toBeTruthy();
    expect(copy()).toHaveProperty("disabled", true);
  });
  it("treats a blank template link as invalid instead of keeping the page indefinitely locked", async () => {
    const value = context();
    mount(value, "/export?domain=d&template=&keep=1#source");
    await screen.findByText("导出模板链接无效，请取消请求后重新选择。");
    expect(value.templateService.find).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消模板请求" }));
    expect(params().get("domain")).toBe("d");
    expect(params().has("template")).toBe(false);
    expect(preview()).not.toContain("学习目标");
  });
  it("retains the inherited domain, duplicate parameters and hash when a staged template is cancelled", async () => {
    mount(context());
    await ready();
    fireEvent.change(screen.getByLabelText("希望讨论的问题"), { target: { value: "保留的问题" } });
    fireEvent.click(screen.getByRole("button", { name: "模板入口" }));
    await screen.findByRole("button", { name: "应用模板" });
    fireEvent.click(screen.getByRole("button", { name: "取消模板请求" }));
    await waitFor(() => expect(params().has("template")).toBe(false));
    expect(params().get("domain")).toBe("d");
    expect(params().getAll("keep")).toEqual(["1", "2"]);
    expect(screen.getByLabelText("当前位置").textContent).toContain("#source");
    expect(screen.getByLabelText("希望讨论的问题")).toHaveProperty("value", "保留的问题");
    expect(preview()).not.toContain("学习目标");
  });
  it("does not apply a ready template from a replaced template service", async () => {
    const value = context();
    const view = mount(value);
    await ready();
    fireEvent.change(screen.getByLabelText("希望讨论的问题"), { target: { value: "保留的问题" } });
    fireEvent.click(screen.getByText("模板入口", { selector: "button" }));
    const staged = await screen.findByText(template.name, { selector: ".export-template-request p" });
    expect(within(staged.parentElement!).getByRole("button", { name: "应用模板" }))
      .toHaveProperty("disabled", false);
    const pending = deferred<Template | null>();
    const next = { ...value, templateService: { find: vi.fn(() => pending.promise) } };
    view.replace(next);
    expect(screen.queryByText("应用模板", { selector: "button" })).toBeNull();
    expect(screen.getByLabelText("希望讨论的问题")).toHaveProperty("value", "保留的问题");
    await waitFor(() => expect(next.templateService.find).toHaveBeenCalledWith(template.id));
    await act(async () => pending.resolve({ ...template, name: "新来源模板",
      defaults: { ...template.defaults, question: "新来源问题" } }));
    const replacement = await screen.findByText("新来源模板", { selector: ".export-template-request p" });
    fireEvent.click(within(replacement.parentElement!).getByRole("button", { name: "应用模板" }));
    await waitFor(() => expect(params().has("template")).toBe(false));
    expect(screen.getByLabelText("希望讨论的问题")).toHaveProperty("value", "新来源问题");
    expect(params().get("domain")).toBe("d");
  });
  it("suppresses clipboard feedback from a different preview context", async () => {
    const pending = deferred<void>();
    const writeText = vi.fn(() => pending.promise);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    mount(context());
    await ready();
    fireEvent.click(copy());
    fireEvent.click(screen.getByRole("button", { name: "切换领域入口" }));
    await act(async () => pending.resolve(undefined));
    expect(screen.queryByText("已复制当前预览。")).toBeNull();
    expect(writeText.mock.calls[0]).toBeDefined();
    expect(preview()).toContain("学习目标");
  });
});

describe("export privacy write lifecycle", () => {
  it("keeps a failed selection and permits explicit cancellation without another write", async () => {
    const value = context();
    value.contextExportService.setPrivacy.mockRejectedValueOnce(new Error("C:\\private\\data.db SELECT"));
    mount(value);
    await ready();
    fireEvent.change(privacy(), { target: { value: "private" } });
    await screen.findByText("隐私等级保存失败，已保留本次选择。请重试或撤销。");
    expect(privacy()).toHaveProperty("value", "private");
    expect(screen.getByLabelText("希望讨论的问题").matches(":disabled")).toBe(true);
    fireEvent.change(privacy(), { target: { value: "highly_sensitive" } });
    expect(value.contextExportService.setPrivacy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "撤销未保存选择" }));
    expect(privacy()).toHaveProperty("value", "normal");
    expect(value.contextExportService.loadRecords).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("希望讨论的问题").matches(":disabled")).toBe(false);
  });
  it("retries the original selection on its original service after replacement", async () => {
    const value = context();
    value.contextExportService.setPrivacy.mockRejectedValueOnce(new Error("disk"));
    const view = mount(value);
    await ready();
    fireEvent.change(privacy(), { target: { value: "private" } });
    await screen.findByRole("button", { name: "重试保存隐私等级" });
    const next = context();
    view.replace(next);
    await ready();
    expect(screen.getByText(/另一数据来源的隐私选择/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试保存隐私等级" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "重试保存隐私等级" })).toBeNull());
    expect(value.contextExportService.setPrivacy.mock.calls).toEqual([
      ["goal", "g", "private"], ["goal", "g", "private"],
    ]);
    expect(next.contextExportService.setPrivacy).not.toHaveBeenCalled();
    expect(value.contextExportService.loadRecords).toHaveBeenCalledTimes(1);
    expect(next.contextExportService.loadRecords).toHaveBeenCalledTimes(1);
  });
  it("does not reread the replacement source after an old successful save", async () => {
    const value = context();
    const pending = deferred<void>();
    value.contextExportService.setPrivacy.mockReturnValueOnce(pending.promise);
    const view = mount(value);
    await ready();
    fireEvent.change(privacy(), { target: { value: "private" } });
    const next = context([records[0], record("goal", "new", "新目标", ["d"])]);
    view.replace(next);
    await ready();
    await act(async () => pending.resolve(undefined));
    expect(value.contextExportService.loadRecords).toHaveBeenCalledTimes(1);
    expect(next.contextExportService.loadRecords).toHaveBeenCalledTimes(1);
    expect(preview()).toContain("新目标");
  });
  it("only rereads after committed privacy settings when the following read fails", async () => {
    const value = context();
    mount(value);
    await ready();
    value.contextExportService.loadRecords.mockRejectedValueOnce(new Error("database"));
    fireEvent.change(privacy(), { target: { value: "private" } });
    await screen.findByText("隐私等级已保存，但记录读取失败。请重新读取，不要重复保存。");
    expect(screen.queryByRole("button", { name: "重试保存隐私等级" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试", exact: true }));
    await ready();
    expect(value.contextExportService.setPrivacy).toHaveBeenCalledTimes(1);
    expect(value.contextExportService.loadRecords).toHaveBeenCalledTimes(3);
  });
  it("drops an unmounted initial read", async () => {
    const value = context();
    const pending = deferred<readonly ExportRecord[]>();
    value.contextExportService.loadRecords.mockReturnValueOnce(pending.promise);
    const view = mount(value);
    view.unmount();
    await act(async () => pending.resolve(records));
    expect(screen.queryByRole("heading", { name: "导出预览" })).toBeNull();
  });
});
