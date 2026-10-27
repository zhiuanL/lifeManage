import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext } from "../../src/app/LifeOSContext";
import { ReviewEditorDialog } from "../../src/components/ReviewEditorDialog";
import { ReviewsPage } from "../../src/pages/ReviewsPage";
import { createReviewStructure, reviewPeriod, reviewTypes } from "../../src/domain/reviews/ReviewStructure";
import type { Review } from "../../src/domain/reviews/Review";


it("selects, filters, reloads and removes review object links", async () => {
  const value = await setup();
  const goal = await value.goalService.create({ title: "关联测试目标", description: "", domainId: null, status: "active", targetDate: null });
  const issue = await value.issueService.create({ title: "关联测试问题", description: "", firstSeen: base.reviewedOn, occurrenceCount: 1, causeHypothesis: "", attempts: "", followUp: "", status: "open", goalId: null, domainIds: [] });
  const { dialog, onSaved } = await editor(value);
  fireEvent.click(dialog.querySelector("summary")!);
  fireEvent.change(within(dialog).getByRole("textbox", { name: "标题" }), { target: { value: "关联复盘" } });
  fireEvent.click(await within(dialog).findByRole("checkbox", { name: goal.title }));
  fireEvent.click(within(dialog).getByRole("checkbox", { name: issue.title }));
  fireEvent.change(within(dialog).getByRole("searchbox", { name: "筛选关联对象" }), { target: { value: "不存在的搜索词" } });
  expect(within(dialog).getByRole("checkbox", { name: goal.title })).toHaveProperty("checked", true);
  expect(within(dialog).getByRole("checkbox", { name: issue.title })).toHaveProperty("checked", true);
  fireEvent.click(within(dialog).getByRole("button", { name: "保存回顾" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  const saved = await value.reviewService.findById(onSaved.mock.calls[0][0].id);
  expect(saved).toMatchObject({ goalIds: [goal.id], issueIds: [issue.id] });
  cleanup();
  const reopened = await editor(value, saved!);
  fireEvent.click(reopened.dialog.querySelector("summary")!);
  expect(await within(reopened.dialog).findByRole("checkbox", { name: goal.title })).toHaveProperty("checked", true);
  fireEvent.click(within(reopened.dialog).getByRole("checkbox", { name: goal.title }));
  fireEvent.click(within(reopened.dialog).getByRole("checkbox", { name: issue.title }));
  fireEvent.click(within(reopened.dialog).getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(reopened.onSaved).toHaveBeenCalledTimes(1));
  expect(await value.reviewService.findById(saved!.id)).toMatchObject({ goalIds: [], issueIds: [] });
});
it("retries object loading without losing the review draft", async () => {
  const value = await setup();
  vi.spyOn(value.goalService, "list").mockRejectedValueOnce(new Error("对象读取失败"));
  const { dialog } = await editor(value);
  fireEvent.click(dialog.querySelector("summary")!);
  fireEvent.change(within(dialog).getByRole("textbox", { name: "标题" }), { target: { value: "保留草稿" } });
  await within(dialog).findByText("关联对象读取失败，请重试。");
  fireEvent.click(within(dialog).getByRole("button", { name: "重试读取关联对象" }));
  await within(dialog).findByRole("searchbox", { name: "筛选关联对象" });
  expect(within(dialog).getByRole("textbox", { name: "标题" })).toHaveProperty("value", "保留草稿");
});

describe("review list and keyboard", () => {
  it("filters cycles and status, preserves domain context and displays stored answers", async () => {
    const value = await setup();
    const domain = (await value.lifeDomainService.list())[0];
    await value.reviewService.create({ ...base, title: "日草稿", domainIds: [domain.id], structure: createReviewStructure("daily", base.reviewedOn) });
    const weekly = createReviewStructure("weekly", base.reviewedOn);
    await value.reviewService.create({ ...base, title: "周完成", domainIds: [domain.id], structure: { ...weekly, status: "completed", answers: { ...weekly.answers, execution: "周执行事实" } } });
    await value.reviewService.create({ ...base, title: "原回顾", domainIds: [domain.id] });
    render(createElement(MemoryRouter, { initialEntries: ["/reviews?domain=" + domain.id] }, createElement(LifeOSContext.Provider, { value }, createElement(ReviewsPage))));
    await screen.findByRole("heading", { name: "周完成" });
    fireEvent.change(screen.getByRole("combobox", { name: "按复盘周期筛选" }), { target: { value: "weekly" } });
    expect(screen.queryByRole("heading", { name: "日草稿" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "按生活领域筛选" })).toHaveProperty("value", domain.id);
    expect(screen.getByText("周执行事实")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "按复盘状态筛选" }), { target: { value: "draft" } });
    expect(screen.queryByRole("heading", { name: "周完成" })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "按复盘状态筛选" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "按复盘周期筛选" }), { target: { value: "legacy" } });
    expect(screen.getByRole("heading", { name: "原回顾" })).toBeTruthy();
  });
  it("wraps keyboard focus and restores the invoking control", async () => {
    const value = await setup();
    const outer = document.createElement("button");
    document.body.append(outer); outer.focus();
    const { dialog } = await editor(value);
    const first = within(dialog).getByRole("button", { name: "关闭" });
    const last = within(dialog).getByRole("button", { name: "保存回顾" });
    first.focus(); fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    last.focus(); fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    cleanup(); expect(document.activeElement).toBe(outer); outer.remove();
  });
});

describe("review compatibility", () => {
  it("edits legacy records without classification or content loss", async () => {
    const value = await setup();
    const review = await value.reviewService.create(base);
    const { dialog, onSaved } = await editor(value, review);
    expect(within(dialog).queryByRole("combobox", { name: "复盘周期" })).toBeNull();
    expect(within(dialog).getByRole("textbox", { name: "回看" })).toHaveProperty("value", base.reflection);
    fireEvent.click(within(dialog).getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved.mock.calls[0][0]).toMatchObject({ ...base, structure: null });
  });

  it("uses the stored snapshot and persists an explicitly cleared answer", async () => {
    const value = await setup();
    const structure = createReviewStructure("weekly", base.reviewedOn, { id: "custom-old", name: "旧模板", version: 3,
      fields: [{ key: "oldField", label: "旧字段", defaultValue: "" }] });
    const review = await value.reviewService.create({ ...base, structure: { ...structure, answers: { oldField: "待清空" } } });
    const find = vi.spyOn(value.templateService, "find");
    const { dialog, onSaved } = await editor(value, review, "/reviews?template=default-review");
    expect(within(dialog).getByRole("combobox", { name: "复盘周期" })).toHaveProperty("disabled", true);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "旧字段" }), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(find).not.toHaveBeenCalled();
    expect(onSaved.mock.calls[0][0].structure).toMatchObject({ template: structure.template, answers: { oldField: "" } });
  });

  it("locks fields until a failed template read is retried and saves its version snapshot", async () => {
    const value = await setup();
    vi.spyOn(value.templateService, "find").mockRejectedValueOnce(new Error("模板读取失败。"));
    const { dialog, onSaved } = renderEditor(value, undefined, "/reviews?template=default-review");
    expect(within(dialog).getByRole("textbox", { name: "标题" }).matches(":disabled")).toBe(true);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "回顾模板读取或校验失败，请重试或在模板中心调整。");
    expect(within(dialog).getByRole("button", { name: "保存回顾" })).toHaveProperty("disabled", true);
    fireEvent.click(within(dialog).getByRole("button", { name: "重试读取模板" }));
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "回看" })).toHaveProperty("value", "这段时间发生了什么？"));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "保存回顾" }).matches(":disabled")).toBe(false));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "标题" }), { target: { value: "模板测试" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存回顾" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved.mock.calls[0][0].structure.template).toMatchObject({ id: "default-review", name: "轻量回顾", version: 1 });
  });
});

describe("review draft safety", () => {
  it("keeps separate cycle drafts and narrative answers across mode changes", async () => {
    const value = await setup();
    const { dialog, onSaved } = await editor(value);
    const cycle = within(dialog).getByRole("combobox", { name: "复盘周期" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "完成了什么" }), { target: { value: "日草稿" } });
    fireEvent.change(cycle, { target: { value: "monthly" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "各周结论" }), { target: { value: "月草稿" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "叙事书写" }));
    expect(dialog.className).toContain("review-narrative");
    expect(within(dialog).getByRole("textbox", { name: "各周结论" })).toHaveProperty("value", "月草稿");
    fireEvent.change(cycle, { target: { value: "daily" } });
    expect(within(dialog).getByRole("textbox", { name: "完成了什么" })).toHaveProperty("value", "日草稿");
    expect(within(dialog).queryByRole("radio")).toBeNull();
    fireEvent.change(cycle, { target: { value: "monthly" } });
    expect(within(dialog).getByRole("radio", { name: "叙事书写" })).toHaveProperty("checked", true);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "标题" }), { target: { value: "保存月草稿" } });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "保存回顾" }).matches(":disabled")).toBe(false));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存回顾" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved.mock.calls[0][0].structure).toMatchObject({ type: "monthly", mode: "narrative", status: "draft", answers: { weeklyConclusions: "月草稿" } });
  });

  it("retains answers after failure and blocks dismissal and duplicate submit while saving", async () => {
    const value = await setup();
    const create = vi.spyOn(value.reviewService, "create").mockRejectedValueOnce(new Error("保存失败，请重试。"));
    const { dialog, onSaved, onClose } = await editor(value);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "标题" }), { target: { value: "重试" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "完成了什么" }), { target: { value: "保留内容" } });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "保存回顾" }).matches(":disabled")).toBe(false));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存回顾" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "保存回顾失败，请重试。");
    expect(within(dialog).getByRole("textbox", { name: "完成了什么" })).toHaveProperty("value", "保留内容");
    let resolve!: (review: Review) => void;
    create.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "保存回顾" }).matches(":disabled")).toBe(false));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存回顾" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement!);
    fireEvent.submit(dialog.querySelector("form")!);
    expect(onClose).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
    resolve({ ...base, id: "retry", domainIds: [], createdAt: "", updatedAt: "" });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function setup() {
  const value = createApplicationDependencies();
  await value.bootstrapApplicationService.bootstrap();
  return value;
}
function renderEditor(value: ReturnType<typeof createApplicationDependencies>, review?: Review, path = "/reviews", onClose = vi.fn()) {
  const onSaved = vi.fn();
  render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(LifeOSContext.Provider,
    { value }, createElement(ReviewEditorDialog, { review, domains: [], onClose, onSaved }))));
  return { onSaved, onClose, dialog: screen.getByRole("dialog") };
}
async function editor(value: ReturnType<typeof createApplicationDependencies>, review?: Review, path = "/reviews", onClose = vi.fn()) {
  const result = renderEditor(value, review, path, onClose);
  await waitFor(() => expect(within(result.dialog).getByRole("button", { name: review ? "保存修改" : "保存回顾" }).matches(":disabled")).toBe(false));
  return result;
}
const base = { title: "原有记录", reflection: "旧回看", insight: "旧发现", nextFocus: "旧重点", domainId: null, reviewedOn: "2026-10-13" };

describe("V1 Chinese review editor", () => {
  it.each(reviewTypes)("creates and reloads %s with its exact period and all answers", async type => {
    const value = await setup();
    const { dialog, onSaved } = await editor(value);
    fireEvent.change(within(dialog).getByRole("combobox", { name: "复盘周期" }), { target: { value: type } });
    fireEvent.change(within(dialog).getByLabelText("回顾日期"), { target: { value: "2024-02-29" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "标题" }), { target: { value: type } });
    const template = createReviewStructure(type, "2024-02-29").template;
    for (const field of template.fields) fireEvent.change(within(dialog).getByRole("textbox", { name: field.label }), { target: { value: field.label + "事实" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "已完成" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "保存回顾" }).matches(":disabled")).toBe(false));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存回顾" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const saved = (await value.reviewService.list()).find(item => item.title === type)!;
    expect(saved.structure).toMatchObject({ ...reviewPeriod(type, "2024-02-29"), status: "completed", template,
      answers: Object.fromEntries(template.fields.map(field => [field.key, field.label + "事实"])) });
  });
});

