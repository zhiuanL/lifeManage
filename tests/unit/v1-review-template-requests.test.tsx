import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext } from "../../src/app/LifeOSContext";
import { ReviewEditorDialog } from "../../src/components/ReviewEditorDialog";
import { normalizeReviewDraft, ReviewValidationError, type Review } from "../../src/domain/reviews/Review";
import { createReviewStructure, reviewTypes } from "../../src/domain/reviews/ReviewStructure";
import { builtInTemplates, reviewStructureFromTemplate, type Template } from "../../src/domain/templates/Template";
import { ReviewsPage } from "../../src/pages/ReviewsPage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const daily = builtInTemplates.find(template => template.id === "default-review")!;
const monthly = builtInTemplates.find(template => template.id === "default-review-monthly")!;
const base = {
  title: "复盘草稿", reflection: "", insight: "", nextFocus: "", domainId: null,
  domainIds: [], goalIds: [], issueIds: [], reviewedOn: "2024-02-29",
};
const saved: Review = { ...base, id: "saved", createdAt: "", updatedAt: "" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function setup() {
  const value = createApplicationDependencies();
  await value.bootstrapApplicationService.bootstrap();
  return value;
}
type Dependencies = Awaited<ReturnType<typeof setup>>;

function Host({ pending }: { pending: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="review-location">{JSON.stringify(location)}</output>
    <button type="button" onClick={() => void navigate(pending)}>另一个复盘请求</button>
    <ReviewsPage />
  </>;
}
function show(value: Dependencies, path: string, pending = "/reviews") {
  return render(<LifeOSContext.Provider value={value}>
    <MemoryRouter initialEntries={[path]}><Host pending={pending} /></MemoryRouter>
  </LifeOSContext.Provider>);
}
function location(): { search: string; hash: string } {
  return JSON.parse(screen.getByTestId("review-location").textContent ?? "{}");
}
function params() { return new URLSearchParams(location().search); }
async function readyDialog(editing = false) {
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(within(dialog).getByRole("button",
    { name: editing ? "保存修改" : "保存回顾" }).matches(":disabled")).toBe(false));
  return dialog;
}
function direct(value: Dependencies, review?: Review, path = "/reviews") {
  const onSaved = vi.fn(), onClose = vi.fn(), onTemplateReady = vi.fn();
  const result = render(<LifeOSContext.Provider value={value}><MemoryRouter initialEntries={[path]}>
    <ReviewEditorDialog review={review} domains={[]} onSaved={onSaved}
      onClose={onClose} onTemplateReady={onTemplateReady} />
  </MemoryRouter></LifeOSContext.Provider>);
  return { ...result, onSaved, onClose, onTemplateReady };
}

describe("V1 review template request preparation", () => {
  it("waits for records, reads a template once, then consumes only its opening parameters", async () => {
    const value = await setup();
    const domains = await value.lifeDomainService.list();
    const reading = deferred<typeof domains>();
    vi.spyOn(value.lifeDomainService, "list").mockReturnValueOnce(reading.promise);
    const find = vi.spyOn(value.templateService, "find");
    const query = new URLSearchParams({ create: "review", template: daily.id, domain: domains[0].id,
      reviewType: "unknown", reviewAnchor: "invalid", view: "保留" });
    query.append("tag", "一"); query.append("tag", "二");
    const mounted = show(value, `/reviews?${query}#source-%E4%B8%AD%E6%96%87`);
    expect(find).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { reading.resolve(domains); await reading.promise; });
    const dialog = await readyDialog();
    await waitFor(() => expect(params().has("template")).toBe(false));
    expect(params().has("create")).toBe(false);
    expect(params().get("domain")).toBe(domains[0].id);
    expect(params().getAll("tag")).toEqual(["一", "二"]);
    expect(params().get("reviewType")).toBe("unknown");
    expect(location().hash).toBe("#source-%E4%B8%AD%E6%96%87");
    expect(find).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("checkbox", { name: domains[0].name })).toHaveProperty("checked", true);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    const remaining = `/reviews${location().search}${location().hash}`;
    mounted.unmount();
    show(value, remaining);
    await screen.findByRole("heading", { name: "复盘", level: 1 });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(find).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "missing", template: null },
    { label: "wrong category", template: builtInTemplates.find(template => template.category === "goal")! },
    { label: "bad version", template: { ...daily, version: 0 } },
    { label: "bad fields", template: { ...daily, defaults: { reviewType: "daily", reviewFields: [] } } },
    { label: "instance fields", template: { ...daily, defaults: { title: "不应填造", reflection: "" } } },
  ])("retains and retries a $label template without opening a broken form", async ({ template }) => {
    const value = await setup();
    const create = vi.spyOn(value.reviewService, "create");
    const find = vi.spyOn(value.templateService, "find").mockResolvedValueOnce(template as Template | null);
    show(value, "/reviews?template=chosen&create=review&tag=一&tag=二#kept");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/模板/);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(params().get("template")).toBe("chosen");
    expect(params().get("create")).toBe("review");
    expect(create).not.toHaveBeenCalled();
    find.mockResolvedValueOnce({ ...daily, id: "chosen" });
    fireEvent.click(screen.getByRole("button", { name: "重试读取模板" }));
    await readyDialog();
    await waitFor(() => expect(params().has("template")).toBe(false));
    expect(params().getAll("tag")).toEqual(["一", "二"]);
    expect(location().hash).toBe("#kept");
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("sanitizes a read failure and explicitly cancels without erasing unrelated context", async () => {
    const value = await setup();
    vi.spyOn(value.templateService, "find").mockRejectedValueOnce(new Error("SQL secret C:\\private\\life.db"));
    show(value, "/reviews?template=chosen&create=review&view=保留&reviewAnchor=2024-02-29#kept");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("回顾模板读取或校验失败");
    expect(alert.textContent).not.toMatch(/SQL|private|life\.db/);
    fireEvent.click(screen.getByRole("button", { name: "取消模板请求" }));
    await waitFor(() => expect(params().has("template")).toBe(false));
    expect(params().has("create")).toBe(false);
    expect(params().get("view")).toBe("保留");
    expect(params().get("reviewAnchor")).toBe("2024-02-29");
    expect(location().hash).toBe("#kept");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a template request while its domain filter is invalid", async () => {
    const value = await setup();
    const find = vi.spyOn(value.templateService, "find");
    show(value, `/reviews?template=${daily.id}&create=review&domain=missing&view=保留`);
    await screen.findByRole("heading", { name: "无法按当前领域查看回顾" });
    expect(find).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
    await readyDialog();
    await waitFor(() => expect(params().has("template")).toBe(false));
    expect(params().get("view")).toBe("保留");
  });

  it("drops a replaced template response and opens the newer template-only request", async () => {
    const value = await setup();
    const reading = deferred<Template | null>();
    const find = vi.spyOn(value.templateService, "find").mockReturnValueOnce(reading.promise);
    show(value, `/reviews?template=${daily.id}`, `/reviews?template=${monthly.id}&tag=new#new`);
    await screen.findByText("正在读取回顾模板");
    await waitFor(() => expect(find).toHaveBeenCalledWith(daily.id));
    fireEvent.click(screen.getByRole("button", { name: "另一个复盘请求" }));
    const dialog = await readyDialog();
    expect(within(dialog).getByLabelText("复盘周期")).toHaveProperty("value", "monthly");
    await act(async () => { reading.resolve(daily); await reading.promise; });
    expect(within(dialog).getByLabelText("复盘周期")).toHaveProperty("value", "monthly");
    expect(params().get("tag")).toBe("new");
    expect(location().hash).toBe("#new");
  });

  it.each(["cancel", "unmount"] as const)("ignores a pending template response after %s", async action => {
    const value = await setup();
    const reading = deferred<Template | null>();
    const find = vi.spyOn(value.templateService, "find").mockReturnValueOnce(reading.promise);
    const mounted = show(value, `/reviews?template=${daily.id}&create=review`);
    await waitFor(() => expect(find).toHaveBeenCalledWith(daily.id));
    if (action === "cancel") {
      fireEvent.click(screen.getByRole("button", { name: "取消模板请求" }));
      await waitFor(() => expect(params().has("template")).toBe(false));
    } else mounted.unmount();
    await act(async () => { reading.resolve(daily); await reading.promise; });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("V1 review defaults and draft isolation", () => {
  it("waits for all five validated defaults before consuming a create request", async () => {
    const value = await setup();
    const reading = deferred<Template | null>();
    const defaults = vi.spyOn(value.templateService, "getDefaultTemplate").mockImplementation(async (_category, cycle) =>
      cycle === "annual" ? reading.promise : null);
    show(value, "/reviews?create=review&tag=一&tag=二#source");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "标题" }).matches(":disabled")).toBe(true);
    expect(within(dialog).getByLabelText("回顾日期").matches(":disabled")).toBe(true);
    fireEvent.submit(dialog.querySelector("form")!);
    expect(params().get("create")).toBe("review");
    expect(defaults.mock.calls.map(call => call[1])).toEqual([...reviewTypes]);
    await act(async () => { reading.resolve(null); await reading.promise; });
    await readyDialog();
    await waitFor(() => expect(params().has("create")).toBe(false));
    expect(params().getAll("tag")).toEqual(["一", "二"]);
    expect(location().hash).toBe("#source");
  });

  it("rejects a default assigned to the wrong cycle, retries atomically and keeps cycle drafts", async () => {
    const value = await setup();
    const custom: Template = { ...monthly, defaults: { reviewType: "monthly",
      reviewFields: [{ key: "ownField", label: "月自定义", defaultValue: "月默认" }] } };
    const defaults = vi.spyOn(value.templateService, "getDefaultTemplate").mockImplementation(async (_category, cycle) =>
      cycle === "monthly" ? custom : cycle === "annual" ? daily : null);
    show(value, "/reviews?create=review");
    const dialog = await screen.findByRole("dialog");
    expect((await within(dialog).findByRole("alert")).textContent).toContain("回顾模板读取或校验失败");
    expect(params().get("create")).toBe("review");
    expect(within(dialog).getByRole("textbox", { name: "标题" }).matches(":disabled")).toBe(true);
    defaults.mockResolvedValue(null);
    fireEvent.click(within(dialog).getByRole("button", { name: "重试读取模板" }));
    await readyDialog();
    fireEvent.change(within(dialog).getByLabelText("复盘周期"), { target: { value: "monthly" } });
    expect(within(dialog).queryByRole("textbox", { name: "月自定义" })).toBeNull();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "各周结论" }), { target: { value: "月草稿" } });
    fireEvent.change(within(dialog).getByLabelText("复盘周期"), { target: { value: "daily" } });
    fireEvent.change(within(dialog).getByLabelText("复盘周期"), { target: { value: "monthly" } });
    expect(within(dialog).getByRole("textbox", { name: "各周结论" })).toHaveProperty("value", "月草稿");
  });

  it("cancels an unready default request once and does not reopen after a late read", async () => {
    const value = await setup();
    const reading = deferred<Template | null>();
    const defaults = vi.spyOn(value.templateService, "getDefaultTemplate").mockReturnValue(reading.promise);
    show(value, "/reviews?create=review&view=保留");
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(params().has("create")).toBe(false));
    await act(async () => { reading.resolve(null); await reading.promise; });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(params().get("view")).toBe("保留");
    expect(defaults).toHaveBeenCalledTimes(5);
  });

  it("leaves a newer reminder request intact when cancelling an unready older form", async () => {
    const value = await setup();
    const reading = deferred<Template | null>();
    const defaults = vi.spyOn(value.templateService, "getDefaultTemplate").mockReturnValue(reading.promise);
    show(value, "/reviews?create=review&reviewType=weekly&reviewAnchor=2024-02-29",
      "/reviews?create=review&reviewType=monthly&reviewAnchor=2024-02-29#later");
    const old = await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "另一个复盘请求" }));
    fireEvent.click(within(old).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(defaults).toHaveBeenCalledTimes(10));
    expect(params().get("create")).toBe("review");
    expect(params().get("reviewType")).toBe("monthly");
    await act(async () => { reading.resolve(null); await reading.promise; });
    const next = await readyDialog();
    expect(within(next).getByLabelText("复盘周期")).toHaveProperty("value", "monthly");
    expect(location().hash).toBe("#later");
  });

  it("keeps the open draft and its domain snapshot when a template-only request arrives", async () => {
    const value = await setup();
    const domains = await value.lifeDomainService.list();
    const find = vi.spyOn(value.templateService, "find");
    show(value, `/reviews?domain=${domains[0].id}`,
      `/reviews?template=${monthly.id}&domain=${domains[1].id}&tag=保留#later`);
    await screen.findByRole("heading", { name: "复盘", level: 1 });
    fireEvent.click(screen.getAllByRole("button", { name: "记录回顾" })[0]);
    const old = await readyDialog();
    fireEvent.change(within(old).getByRole("textbox", { name: "标题" }), { target: { value: "日草稿" } });
    fireEvent.change(within(old).getByRole("textbox", { name: "完成了什么" }), { target: { value: "自己的事实" } });
    fireEvent.click(screen.getByRole("button", { name: "另一个复盘请求" }));
    expect(find).not.toHaveBeenCalled();
    expect(within(old).getByRole("textbox", { name: "标题" })).toHaveProperty("value", "日草稿");
    expect(within(old).getByRole("checkbox", { name: domains[0].name })).toHaveProperty("checked", true);
    expect(within(old).getByRole("checkbox", { name: domains[1].name })).toHaveProperty("checked", false);
    expect(screen.getAllByRole("button", { name: "记录回顾" })[0]).toHaveProperty("disabled", true);
    expect(screen.getByRole("combobox", { name: "按生活领域筛选" })).toHaveProperty("disabled", true);
    fireEvent.click(within(old).getByRole("button", { name: "取消" }));
    const next = await readyDialog();
    expect(within(next).getByLabelText("复盘周期")).toHaveProperty("value", "monthly");
    expect(within(next).getByRole("textbox", { name: "标题" })).toHaveProperty("value", "");
    expect(within(next).getByRole("checkbox", { name: domains[1].name })).toHaveProperty("checked", true);
    expect(params().get("tag")).toBe("保留");
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("handles a newer request for the same template independently of the previous draft", async () => {
    const value = await setup();
    const find = vi.spyOn(value.templateService, "find");
    show(value, `/reviews?template=${daily.id}&create=review`,
      `/reviews?template=${daily.id}&create=review&view=新请求#later`);
    const old = await readyDialog();
    fireEvent.change(within(old).getByRole("textbox", { name: "标题" }), { target: { value: "上一草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "另一个复盘请求" }));
    expect(find).toHaveBeenCalledTimes(1);
    expect(params().get("template")).toBe(daily.id);
    expect(within(old).getByRole("textbox", { name: "标题" })).toHaveProperty("value", "上一草稿");
    fireEvent.click(within(old).getByRole("button", { name: "取消" }));
    const next = await readyDialog();
    expect(within(next).getByRole("textbox", { name: "标题" })).toHaveProperty("value", "");
    await waitFor(() => expect(params().has("template")).toBe(false));
    expect(params().get("view")).toBe("新请求");
    expect(location().hash).toBe("#later");
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("does not remove a manual draft when a later request has an invalid domain filter", async () => {
    const value = await setup();
    const create = vi.spyOn(value.reviewService, "create");
    show(value, "/reviews", "/reviews?create=review&domain=missing&view=保留");
    await screen.findByRole("heading", { name: "复盘", level: 1 });
    fireEvent.click(screen.getAllByRole("button", { name: "记录回顾" })[0]);
    const old = await readyDialog();
    fireEvent.change(within(old).getByRole("textbox", { name: "标题" }), { target: { value: "不能丢失" } });
    fireEvent.click(screen.getByRole("button", { name: "另一个复盘请求" }));
    expect(within(old).getByRole("textbox", { name: "标题" })).toHaveProperty("value", "不能丢失");
    expect(screen.getByRole("heading", { name: "无法按当前领域查看回顾" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "回顾记录" })).toBeNull();
    expect(screen.getByRole("button", { name: "清除失效筛选" })).toHaveProperty("disabled", true);
    fireEvent.click(within(old).getByRole("button", { name: "取消" }));
    await screen.findByRole("heading", { name: "无法按当前领域查看回顾" });
    expect(params().get("create")).toBe("review");
    expect(create).not.toHaveBeenCalled();
  });

  it("uses an independent snapshot instead of a mutable template service object", async () => {
    const value = await setup();
    const fields = [{ key: "ownField", label: "原字段", defaultValue: "原内容" }];
    const template: Template = { ...daily, id: "copy", defaults: { reviewType: "daily", reviewFields: fields } };
    vi.spyOn(value.templateService, "find").mockResolvedValue(template);
    show(value, "/reviews?template=copy");
    const dialog = await readyDialog();
    template.version = 8;
    fields[0].label = "后来字段"; fields[0].defaultValue = "后来内容";
    expect(within(dialog).getByRole("textbox", { name: "原字段" })).toHaveProperty("value", "原内容");
    expect(within(dialog).queryByRole("textbox", { name: "后来字段" })).toBeNull();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "标题" }), { target: { value: base.title } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存回顾" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const review = (await value.reviewService.list()).find(item => item.title === base.title)!;
    expect(review.structure).toMatchObject({ template: { id: "copy", version: 1, fields: [
      { key: "ownField", label: "原字段", defaultValue: "原内容" },
    ] }, answers: { ownField: "原内容" } });
  });

  it("reports invalid snapshots in the direct editor without applying them inside a state updater", async () => {
    const value = await setup();
    const find = vi.spyOn(value.templateService, "find").mockResolvedValueOnce({ ...daily, version: 0 });
    const callbacks = direct(value, undefined, `/reviews?template=${daily.id}`);
    const dialog = await screen.findByRole("dialog");
    expect((await within(dialog).findByRole("alert")).textContent).toContain("回顾模板读取或校验失败");
    expect(callbacks.onTemplateReady).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("textbox", { name: "标题" }).matches(":disabled")).toBe(true);
    find.mockResolvedValueOnce(daily);
    fireEvent.click(within(dialog).getByRole("button", { name: "重试读取模板" }));
    await readyDialog();
    expect(callbacks.onTemplateReady).toHaveBeenCalledTimes(1);
  });
});

describe("V1 review saving protection", () => {
  it("blocks same-event duplicate submits, all close paths and edits until persistence completes", async () => {
    const value = await setup();
    const writing = deferred<Review>();
    const create = vi.spyOn(value.reviewService, "create").mockReturnValue(writing.promise);
    const callbacks = direct(value);
    const dialog = await readyDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "标题" }), { target: { value: base.title } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "完成了什么" }), { target: { value: "保留事实" } });
    await act(async () => {
      const form = dialog.querySelector("form")!;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      within(dialog).getByRole("button", { name: "关闭" }).click();
      within(dialog).getByRole("button", { name: "取消" }).click();
    });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(create).toHaveBeenCalledTimes(1);
    expect(callbacks.onClose).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText("回顾日期").matches(":disabled")).toBe(true);
    expect(within(dialog).getByRole("textbox", { name: "完成了什么" }).matches(":disabled")).toBe(true);
    expect(create.mock.calls[0][0].structure?.answers.completed).toBe("保留事实");
    await act(async () => { writing.resolve(saved); await writing.promise; });
    expect(callbacks.onSaved).toHaveBeenCalledTimes(1);
  });

  it("sanitizes persistence failure, keeps editable answers and permits an explicit retry", async () => {
    const value = await setup();
    const create = vi.spyOn(value.reviewService, "create").mockRejectedValueOnce(new Error("SQL secret C:\\private\\life.db"));
    const callbacks = direct(value);
    const dialog = await readyDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "标题" }), { target: { value: base.title } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "完成了什么" }), { target: { value: "保留内容" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存回顾" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("保存回顾失败，请重试。");
    expect(within(dialog).getByRole("textbox", { name: "完成了什么" })).toHaveProperty("value", "保留内容");
    await readyDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "保存回顾" }));
    await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(2);
  });

  it.each(["resolve", "reject"] as const)("does not notify a departed parent after saving %s", async outcome => {
    const value = await setup();
    const writing = deferred<Review>();
    vi.spyOn(value.reviewService, "create").mockReturnValue(writing.promise);
    const callbacks = direct(value);
    const dialog = await readyDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "标题" }), { target: { value: base.title } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存回顾" }));
    callbacks.unmount();
    await act(async () => {
      if (outcome === "resolve") writing.resolve(saved);
      else writing.reject(new Error("storage failure"));
      await writing.promise.catch(() => undefined);
    });
    expect(callbacks.onSaved).not.toHaveBeenCalled();
    expect(callbacks.onClose).not.toHaveBeenCalled();
  });

  it("keeps saved template snapshots and legacy fields without reading any template", async () => {
    const value = await setup();
    const structure = createReviewStructure("weekly", base.reviewedOn,
      { id: "old", name: "原版本", version: 3, fields: [{ key: "oldField", label: "原字段", defaultValue: "" }] });
    const review = await value.reviewService.create({ ...base, reflection: "旧回看",
      structure: { ...structure, answers: { oldField: "原答案" } } });
    const find = vi.spyOn(value.templateService, "find");
    const defaults = vi.spyOn(value.templateService, "getDefaultTemplate");
    const callbacks = direct(value, review, `/reviews?template=${monthly.id}`);
    const dialog = await readyDialog(true);
    expect(find).not.toHaveBeenCalled();
    expect(defaults).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("textbox", { name: "回看" })).toHaveProperty("value", "旧回看");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "原字段" }), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledTimes(1));
    expect(callbacks.onSaved.mock.calls[0][0]).toMatchObject({
      reflection: "旧回看", structure: { template: structure.template, answers: { oldField: "" } },
    });
  });

  it("preserves typed rule messages while keeping storage errors outside the validation contract", async () => {
    expect(() => normalizeReviewDraft({ ...base, structure: { ...createReviewStructure("weekly", base.reviewedOn),
      answers: { unknown: "不属于模板" } } })).toThrow(ReviewValidationError);
    const value = await setup();
    await expect(value.reviewService.create({ ...base, domainIds: ["missing"] })).rejects.toBeInstanceOf(ReviewValidationError);
    await expect(value.reviewService.update("missing", base)).rejects.toBeInstanceOf(ReviewValidationError);
    const callbacks = direct(value);
    const dialog = await readyDialog();
    const create = vi.spyOn(value.reviewService, "create").mockRejectedValueOnce(new ReviewValidationError("关联的目标已不存在，请重新选择。"));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "标题" }), { target: { value: base.title } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存回顾" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("关联的目标已不存在，请重新选择。");
    expect(callbacks.onSaved).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    expect(reviewStructureFromTemplate(daily, base.reviewedOn).template.version).toBe(1);
  });
});
