import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { TemplateDefaultsEditor } from "../../src/components/TemplateDefaultsEditor";
import { builtInTemplates, cloneTemplateDefaults, TemplateValidationError, type Template } from "../../src/domain/templates/Template";
import { TemplatesPage } from "../../src/pages/TemplatesPage";
import { TemplateSavedReadError } from "../../src/services/templates/TemplateService";

afterEach(cleanup);
const custom: Template = { id: "custom", category: "domain", name: "自定义领域",
  defaults: { name: "原领域" }, version: 1, builtIn: false, createdAt: "", updatedAt: "" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function service(rows: readonly Template[] = [...builtInTemplates, custom]) {
  return {
    list: vi.fn(async () => rows),
    save: vi.fn<(category: string, name: string, defaults: Template["defaults"], id?: string) => Promise<Template>>()
      .mockResolvedValue(custom),
    getDefaultTemplate: vi.fn<(category: string, cycle: string) => Promise<Template | null>>().mockResolvedValue(null),
    setDefaultTemplate: vi.fn<(category: string, id: string | null, cycle: string) => Promise<void>>().mockResolvedValue(),
  };
}
function Location() {
  const location = useLocation();
  return <output aria-label="当前位置">{location.pathname + location.search}</output>;
}
function page(source: ReturnType<typeof service>, category = "domain") {
  return <MemoryRouter initialEntries={[`/templates?category=${category}`]}>
    <LifeOSContext.Provider value={{ templateService: source } as unknown as LifeOSContextValue}>
      <TemplatesPage /><Location />
    </LifeOSContext.Provider>
  </MemoryRouter>;
}
function defaults(source: ReturnType<typeof service>, options: {
  category?: "goal" | "review"; disabled?: boolean; onPendingChange?(value: boolean): void;
} = {}) {
  return <LifeOSContext.Provider value={{ templateService: source } as unknown as LifeOSContextValue}>
    <TemplateDefaultsEditor category={options.category ?? "goal"} templates={builtInTemplates}
      disabled={options.disabled} onPendingChange={options.onPendingChange} />
  </LifeOSContext.Provider>;
}
async function open() {
  fireEvent.click(await screen.findByRole("button", { name: "编辑自定义领域" }));
  const editor = screen.getByRole("region", { name: "编辑模板" });
  fireEvent.change(within(editor).getByRole("textbox", { name: "模板名称" }), { target: { value: "保留草稿" } });
  return editor;
}

describe("template editor save lifecycle", () => {
  it("does not replace an open draft by new, category, copy, edit or use", async () => {
    render(page(service()));
    const editor = await open();
    fireEvent.click(screen.getByRole("button", { name: "新建模板" }));
    fireEvent.click(screen.getByRole("tab", { name: "目标" }));
    fireEvent.click(screen.getByRole("button", { name: "复制健康领域" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑自定义领域" }));
    const row = screen.getByText("自定义领域").closest("li")!;
    fireEvent.click(within(row).getByRole("link", { name: "使用" }));
    expect(screen.getByRole("region", { name: "编辑模板" })).toBe(editor);
    expect(within(editor).getByRole("textbox", { name: "模板名称" })).toHaveProperty("value", "保留草稿");
    expect(screen.getByLabelText("当前位置").textContent).toBe("/templates?category=domain");
  });

  it("locks all fields and dismiss actions, sanitizes write failure and keeps the original draft", async () => {
    const saving = deferred<Template>();
    const source = service();
    source.save.mockReturnValueOnce(saving.promise);
    render(page(source));
    const editor = await open();
    fireEvent.click(within(editor).getByRole("button", { name: "保存模板" }));
    fireEvent.click(within(editor).getByRole("button", { name: "正在保存" }));
    fireEvent.change(within(editor).getByRole("textbox", { name: "模板名称" }), { target: { value: "错误覆盖" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "领域名称" }), { target: { value: "错误领域" } });
    fireEvent.click(within(editor).getByRole("button", { name: "选择珊瑚" }));
    fireEvent.click(within(editor).getByRole("button", { name: "关闭编辑" }));
    fireEvent.click(within(editor).getByRole("button", { name: "取消" }));
    expect(editor.getAttribute("aria-busy")).toBe("true");
    expect(within(editor).getByRole("textbox", { name: "模板名称" })).toHaveProperty("value", "保留草稿");
    expect(source.save).toHaveBeenCalledExactlyOnceWith("domain", "保留草稿", { name: "原领域" }, "custom");
    await act(async () => saving.reject(new Error("SQL C:\\private\\life.db")));
    expect((await screen.findByRole("alert")).textContent).toBe("保存模板失败，请重试。");
    expect(screen.getByRole("region", { name: "编辑模板" })).toBe(editor);
    fireEvent.click(within(editor).getByRole("button", { name: "保存模板" }));
    await screen.findByRole("button", { name: "编辑自定义领域" });
    expect(source.save).toHaveBeenCalledTimes(2);
  });

  it("preserves the opening service and draft while a replacement list fails", async () => {
    const original = service();
    const replacement = service();
    replacement.list.mockRejectedValueOnce(new Error("private"));
    const view = render(page(original));
    const editor = await open();
    view.rerender(page(replacement));
    await screen.findByText("模板读取失败，请重试。");
    expect(screen.getByRole("region", { name: "编辑模板" })).toBe(editor);
    fireEvent.click(within(editor).getByRole("button", { name: "保存模板" }));
    await screen.findByRole("button", { name: "编辑自定义领域" });
    expect(original.save).toHaveBeenCalledExactlyOnceWith("domain", "保留草稿", { name: "原领域" }, "custom");
    expect(replacement.save).not.toHaveBeenCalled();
    expect(original.list).toHaveBeenCalledTimes(1);
    expect(replacement.list).toHaveBeenCalledTimes(2);
  });

  it.each(["resolve", "reject"] as const)("ignores a replaced pending list %s", async outcome => {
    const reading = deferred<readonly Template[]>();
    const original = service();
    original.list.mockReturnValueOnce(reading.promise);
    const replacement = service([]);
    const view = render(page(original));
    view.rerender(page(replacement));
    await screen.findByRole("button", { name: "新建模板" });
    await act(async () => {
      if (outcome === "resolve") reading.resolve([custom]);
      else reading.reject(new Error("old private"));
    });
    expect(screen.queryByText("自定义领域")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("recovers a committed new template by reading only, even when the recovery list fails", async () => {
    const source = service();
    source.save.mockRejectedValueOnce(new TemplateSavedReadError("created"));
    source.list.mockResolvedValueOnce(builtInTemplates).mockRejectedValueOnce(new Error("private"))
      .mockResolvedValueOnce([...builtInTemplates, { ...custom, id: "created", name: "新模板" }]);
    render(page(source));
    fireEvent.click(await screen.findByRole("button", { name: "复制健康领域" }));
    const editor = screen.getByRole("region", { name: "编辑模板" });
    fireEvent.click(within(editor).getByRole("button", { name: "保存模板" }));
    await screen.findByText("模板读取失败，请重试。");
    expect(screen.queryByRole("region", { name: "编辑模板" })).toBeNull();
    expect(screen.getByText(/模板已保存，但读取失败/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试读取模板" }));
    await screen.findByText("新模板");
    expect(source.save).toHaveBeenCalledTimes(1);
    expect(source.list).toHaveBeenCalledTimes(3);
  });

  it("shows typed validation without discarding the draft", async () => {
    const source = service();
    source.save.mockRejectedValueOnce(new TemplateValidationError("请选择有效的模板默认计算方式。"));
    render(page(source));
    const editor = await open();
    fireEvent.click(within(editor).getByRole("button", { name: "保存模板" }));
    await screen.findByText("请选择有效的模板默认计算方式。");
    expect(within(editor).getByRole("textbox", { name: "模板名称" })).toHaveProperty("value", "保留草稿");
  });

  it("locks export scenario, sections, field order and question during saving", async () => {
    const saving = deferred<Template>();
    const source = service();
    source.save.mockReturnValueOnce(saving.promise);
    render(page(source, "export"));
    const preset = builtInTemplates.find(row => row.id === "default-export-goal-analysis")!;
    fireEvent.click(await screen.findByRole("button", { name: `复制${preset.name}` }));
    const editor = screen.getByRole("region", { name: "编辑模板" });
    const before = cloneTemplateDefaults(preset.defaults);
    fireEvent.click(within(editor).getByRole("button", { name: "保存模板" }));
    fireEvent.change(within(editor).getByRole("combobox", { name: "导出场景" }), { target: { value: "issue-diagnosis" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "希望讨论的问题" }), { target: { value: "错误覆盖" } });
    for (const checkbox of editor.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      fireEvent.click(checkbox);
    }
    for (const button of within(editor).getAllByRole("button", { name: /上移|下移/, hidden: true })) {
      fireEvent.click(button);
    }
    expect(source.save).toHaveBeenCalledExactlyOnceWith("export", `${preset.name}（副本）`, before, undefined);
    expect(within(editor).getByRole("combobox", { name: "导出场景" })).toHaveProperty("value", before.scenario);
    await act(async () => saving.reject(new Error("failed")));
    expect(within(editor).getByRole("textbox", { name: "希望讨论的问题" })).toHaveProperty("value", before.question);
  });

  it.each(["resolve", "reject"] as const)("does not reload after leaving a pending save %s", async outcome => {
    const saving = deferred<Template>();
    const source = service();
    source.save.mockReturnValueOnce(saving.promise);
    const view = render(page(source));
    const editor = await open();
    fireEvent.click(within(editor).getByRole("button", { name: "保存模板" }));
    view.unmount();
    await act(async () => {
      if (outcome === "resolve") saving.resolve(custom);
      else saving.reject(new TemplateSavedReadError("custom"));
    });
    expect(source.list).toHaveBeenCalledTimes(1);
  });
});

describe("default template source and retry lifecycle", () => {
  it("requires an explicit replacement of an unavailable default, without clearing it on read", async () => {
    const source = service();
    const pending = vi.fn();
    source.getDefaultTemplate.mockRejectedValueOnce(new TemplateValidationError("默认模板不可用，请在模板中心重新选择。"));
    render(defaults(source, { onPendingChange: pending }));
    const select = await screen.findByRole("combobox", { name: /新建目标/ });
    await screen.findByText("默认模板不可用，请重新选择。");
    expect(select).toHaveProperty("value", "__unavailable");
    expect(pending).toHaveBeenLastCalledWith(true);
    expect(source.setDefaultTemplate).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: "" } });
    await screen.findByText("已保存");
    expect(source.setDefaultTemplate).toHaveBeenCalledExactlyOnceWith("goal", null, "daily");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(pending).toHaveBeenLastCalledWith(false);
  });

  it("retains the attempted selection, prevents competing edits and explicitly retries", async () => {
    const source = service();
    source.setDefaultTemplate.mockRejectedValueOnce(new Error("SQL private"));
    const pending = vi.fn();
    render(defaults(source, { onPendingChange: pending }));
    const select = await screen.findByRole("combobox", { name: "新建目标" });
    fireEvent.change(select, { target: { value: "default-okr" } });
    await screen.findByText("默认模板保存失败，请重试。");
    expect(select).toHaveProperty("value", "default-okr");
    expect(pending).toHaveBeenLastCalledWith(true);
    fireEvent.change(select, { target: { value: "default-smart" } });
    expect(select).toHaveProperty("value", "default-okr");
    expect(source.setDefaultTemplate).toHaveBeenCalledExactlyOnceWith("goal", "default-okr", "daily");
    fireEvent.click(screen.getByRole("button", { name: "重试保存默认模板" }));
    await screen.findByText("已保存");
    expect(source.setDefaultTemplate).toHaveBeenLastCalledWith("goal", "default-okr", "daily");
    expect(pending).toHaveBeenLastCalledWith(false);
  });

  it("cancels a failed choice without writing a compensating change", async () => {
    const source = service();
    source.getDefaultTemplate.mockResolvedValue(builtInTemplates.find(row => row.id === "default-smart")!);
    source.setDefaultTemplate.mockRejectedValueOnce(new TemplateValidationError("请选择对应类型的模板。"));
    render(defaults(source));
    const select = await screen.findByRole("combobox", { name: "新建目标" });
    fireEvent.change(select, { target: { value: "default-okr" } });
    await screen.findByText("请选择对应类型的模板。");
    fireEvent.click(screen.getByRole("button", { name: "撤销未保存选择" }));
    expect(select).toHaveProperty("value", "default-smart");
    expect(source.setDefaultTemplate).toHaveBeenCalledTimes(1);
  });

  it("does not save synthetic changes when disabled by an open template editor", async () => {
    const source = service();
    render(defaults(source, { disabled: true }));
    const select = await screen.findByRole("combobox", { name: "新建目标" });
    fireEvent.change(select, { target: { value: "default-okr" } });
    expect(source.setDefaultTemplate).not.toHaveBeenCalled();
    expect(select).toHaveProperty("value", "");
  });

  it.each(["resolve", "reject"] as const)("hides prior settings and ignores a replaced save %s", async outcome => {
    const saving = deferred<void>();
    const original = service();
    original.setDefaultTemplate.mockReturnValueOnce(saving.promise);
    const reading = deferred<Template | null>();
    const replacement = service();
    replacement.getDefaultTemplate.mockReturnValueOnce(reading.promise);
    const view = render(defaults(original));
    fireEvent.change(await screen.findByRole("combobox", { name: "新建目标" }), { target: { value: "default-okr" } });
    view.rerender(defaults(replacement));
    expect(screen.queryByRole("combobox")).toBeNull();
    await act(async () => reading.resolve(null));
    const select = await screen.findByRole("combobox", { name: "新建目标" });
    await act(async () => {
      if (outcome === "resolve") saving.resolve();
      else saving.reject(new Error("old private"));
    });
    expect(select).toHaveProperty("value", "");
    expect(screen.queryByText("已保存")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(select, { target: { value: "default-smart" } });
    await screen.findByText("已保存");
    expect(replacement.setDefaultTemplate).toHaveBeenCalledExactlyOnceWith("goal", "default-smart", "daily");
  });

  it("retries a sanitized settings read without writing and supports all five review cycles", async () => {
    const source = service();
    source.getDefaultTemplate.mockRejectedValueOnce(new Error("private"));
    render(defaults(source, { category: "review" }));
    await screen.findByText("默认模板读取失败，请重试。");
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    const selects = await screen.findAllByRole("combobox");
    expect(selects).toHaveLength(5);
    expect(source.getDefaultTemplate.mock.calls.slice(-5).map(call => call[1]))
      .toEqual(["daily", "weekly", "monthly", "quarterly", "annual"]);
    expect(source.setDefaultTemplate).not.toHaveBeenCalled();
    const monthly = selects[2] as HTMLSelectElement;
    expect([...monthly.options].map(option => option.value)).not.toContain("default-review-weekly");
    const option = [...monthly.options].find(item => item.value !== "")!;
    fireEvent.change(monthly, { target: { value: option.value } });
    await screen.findByText("已保存");
    expect(source.setDefaultTemplate).toHaveBeenCalledExactlyOnceWith("review", option.value, "monthly");
  });

  it("reports unmount to the latest callback without late save notices", async () => {
    const source = service();
    const saving = deferred<void>();
    source.setDefaultTemplate.mockReturnValueOnce(saving.promise);
    const originalPending = vi.fn();
    const latestPending = vi.fn();
    const view = render(defaults(source, { onPendingChange: originalPending }));
    const select = await screen.findByRole("combobox", { name: "新建目标" });
    fireEvent.change(select, { target: { value: "default-okr" } });
    view.rerender(defaults(source, { onPendingChange: latestPending }));
    view.unmount();
    expect(latestPending).toHaveBeenLastCalledWith(false);
    const count = latestPending.mock.calls.length;
    await act(async () => saving.resolve());
    expect(latestPending).toHaveBeenCalledTimes(count);
  });
});
