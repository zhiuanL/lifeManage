import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext } from "../../src/app/LifeOSContext";
import { normalizeReviewCreateContext, reviewCreatePath } from "../../src/domain/reviews/ReviewCreateContext";
import { reviewPeriod } from "../../src/domain/reviews/ReviewStructure";
import { builtInTemplates, type Template } from "../../src/domain/templates/Template";
import { ReviewsPage } from "../../src/pages/ReviewsPage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function setup() {
  const value = createApplicationDependencies();
  await value.bootstrapApplicationService.bootstrap();
  return value;
}

function Host({ pending }: { pending: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="review-search">{location.search}</output>
    <button onClick={() => void navigate(pending)}>打开另一复盘入口</button>
    <ReviewsPage />
  </>;
}

function show(value: ReturnType<typeof createApplicationDependencies>, path: string, pending = "/reviews") {
  render(<LifeOSContext.Provider value={value}>
    <MemoryRouter initialEntries={[path]}><Host pending={pending} /></MemoryRouter>
  </LifeOSContext.Provider>);
}

function currentParams() {
  return new URLSearchParams(screen.getByTestId("review-search").textContent ?? "");
}

async function readyDialog() {
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "保存回顾" }).matches(":disabled")).toBe(false));
  return dialog;
}

describe("V1 review reminder create context", () => {
  it("encodes a validated creation request without adding domain scope", () => {
    expect(reviewCreatePath({ type: "weekly", anchor: "2026-10-14", domainIds: [] }))
      .toBe("/reviews?create=review&reviewType=weekly&reviewAnchor=2026-10-14");
    const path = reviewCreatePath({
      type: "monthly", anchor: "2024-02-29", domainIds: [" 健康 &1 ", "健康 &1", "工作/二"],
    });
    const params = new URLSearchParams(path.split("?")[1]);
    expect(params.getAll("reviewDomain")).toEqual(["健康 &1", "工作/二"]);
    expect(params.get("reviewType")).toBe("monthly");
    expect(() => reviewCreatePath({ type: "weekly", anchor: "2023-02-29", domainIds: [] })).toThrow(/日期无效/);
  });

  it("normalizes explicit dates and domains without inventing a fallback cycle", () => {
    expect(normalizeReviewCreateContext({
      type: "weekly", anchor: "2024-02-29", domainIds: [" 健康 &1 ", "健康 &1", "工作/二"],
    })).toEqual({ type: "weekly", anchor: "2024-02-29", domainIds: ["健康 &1", "工作/二"] });
    for (const input of [
      { type: "unknown", anchor: "2024-02-29", domainIds: [] },
      { type: "weekly", anchor: "2023-02-29", domainIds: [] },
      { type: "monthly", anchor: "", domainIds: [] },
      { type: "daily", anchor: "2024-02-29", domainIds: [" "] },
    ]) expect(() => normalizeReviewCreateContext(input)).toThrow(/复盘入口/);
  });

  it.each(["weekly", "monthly"] as const)("opens the exact %s period and domain scope, writing only on save", async type => {
    const value = await setup();
    const domains = (await value.lifeDomainService.list()).slice(0, 2);
    expect(domains).toHaveLength(2);
    const initial = await value.reviewService.list();
    const create = vi.spyOn(value.reviewService, "create");
    const generate = vi.spyOn(value.reviewFactService, "generate");
    const params = new URLSearchParams({
      create: "review", reviewType: type, reviewAnchor: "2024-02-29", view: "中文列表",
    });
    for (const domain of domains) params.append("reviewDomain", domain.id);
    show(value, `/reviews?${params}`);
    const dialog = await readyDialog();
    expect(within(dialog).getByRole("combobox", { name: "复盘周期" })).toHaveProperty("value", type);
    expect(within(dialog).getByLabelText("回顾日期")).toHaveProperty("value", "2024-02-29");
    const period = reviewPeriod(type, "2024-02-29");
    expect(within(dialog).getByLabelText("复盘起止日期").textContent).toBe(`${period.start} 至 ${period.end}`);
    const scope = within(dialog).getByRole("group", { name: "关联生活领域" });
    for (const domain of domains) expect(within(scope).getByRole("checkbox", { name: domain.name })).toHaveProperty("checked", true);
    expect(generate).toHaveBeenCalledWith(period, domains.map(domain => domain.id), undefined);
    expect(create).not.toHaveBeenCalled();
    expect(await value.reviewService.list()).toEqual(initial);
    await waitFor(() => expect(currentParams().has("create")).toBe(false));
    expect(currentParams().get("view")).toBe("中文列表");
    expect(currentParams().getAll("reviewDomain")).toEqual(domains.map(domain => domain.id));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "标题" }), { target: { value: `入口${type}` } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存回顾" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const saved = (await value.reviewService.list()).find(review => review.title === `入口${type}`)!;
    expect(saved).toMatchObject({
      reviewedOn: "2024-02-29", domainIds: domains.map(domain => domain.id),
      structure: { ...period, status: "draft" },
    });
    expect(create).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole("button", { name: "记录回顾" })[0]);
    const manual = await readyDialog();
    expect(within(manual).getByRole("combobox", { name: "复盘周期" })).toHaveProperty("value", "daily");
    expect(within(manual).getByLabelText("回顾日期")).not.toHaveProperty("value", "2024-02-29");
    for (const domain of domains) expect(within(manual).getByRole("checkbox", { name: domain.name })).toHaveProperty("checked", false);
  });

  it("uses the requested cycle default instead of the daily default", async () => {
    const value = await setup();
    const weekly: Template = {
      ...builtInTemplates.find(template => template.id === "default-review")!,
      id: "周模板", name: "指定周模板",
      defaults: { reviewType: "weekly", reviewFields: [{ key: "ownField", label: "周自定义", defaultValue: "周默认内容" }] },
    };
    const daily = builtInTemplates.find(template => template.id === "default-review")!;
    vi.spyOn(value.templateService, "getDefaultTemplate").mockImplementation(async (_category, cycle) =>
      cycle === "weekly" ? weekly : cycle === "daily" ? daily : null);
    show(value, "/reviews?create=review&reviewType=weekly&reviewAnchor=2026-10-18");
    const dialog = await readyDialog();
    expect(within(dialog).getByRole("textbox", { name: "周自定义" })).toHaveProperty("value", "周默认内容");
    expect(within(dialog).queryByRole("textbox", { name: "回看" })).toBeNull();
    expect(within(dialog).getByText("指定周模板 · 版本 1")).toBeTruthy();
  });

  it("gives an explicit template priority over invalid reminder parameters", async () => {
    const value = await setup();
    show(value, "/reviews?create=review&template=default-review&reviewType=unknown&reviewAnchor=invalid&reviewDomain=missing");
    const dialog = await readyDialog();
    expect(within(dialog).getByRole("combobox", { name: "复盘周期" })).toHaveProperty("value", "daily");
    expect(within(dialog).getByRole("textbox", { name: "回看" })).toHaveProperty("value", "这段时间发生了什么？");
    await waitFor(() => expect(currentParams().has("create")).toBe(false));
    expect(currentParams().has("template")).toBe(false);
    expect(screen.queryByRole("heading", { name: "无法打开这次复盘" })).toBeNull();
  });

  it.each([
    "reviewType=unknown&reviewAnchor=2026-10-18",
    "reviewType=monthly&reviewAnchor=2023-02-29",
    "reviewType=weekly&reviewAnchor=2026-10-18&reviewDomain=missing",
  ])("retains an invalid request until explicitly cleared: %s", async query => {
    const value = await setup();
    const create = vi.spyOn(value.reviewService, "create");
    show(value, `/reviews?create=review&view=保留&${query}`);
    await screen.findByRole("heading", { name: "无法打开这次复盘" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(currentParams().get("create")).toBe("review");
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "清除失效入口" }));
    await screen.findByRole("heading", { name: "复盘", level: 1 });
    expect(currentParams().get("view")).toBe("保留");
    for (const key of ["create", "reviewType", "reviewAnchor", "reviewDomain"]) expect(currentParams().has(key)).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a request received on the same page once the previous editor closes", async () => {
    const value = await setup();
    const create = vi.spyOn(value.reviewService, "create");
    show(value, "/reviews", "/reviews?create=review&reviewType=weekly&reviewAnchor=2026-10-18");
    await screen.findByRole("heading", { name: "复盘", level: 1 });
    fireEvent.click(screen.getAllByRole("button", { name: "记录回顾" })[0]);
    const original = await readyDialog();
    fireEvent.change(within(original).getByRole("textbox", { name: "标题" }), { target: { value: "未保存日草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "打开另一复盘入口" }));
    expect(within(original).getByRole("textbox", { name: "标题" })).toHaveProperty("value", "未保存日草稿");
    expect(within(original).getByRole("combobox", { name: "复盘周期" })).toHaveProperty("value", "daily");
    expect(currentParams().get("create")).toBe("review");
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(within(original).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "复盘周期" })).toHaveProperty("value", "weekly"));
    const next = await readyDialog();
    expect(within(next).getByRole("textbox", { name: "标题" })).toHaveProperty("value", "");
    expect(within(next).getByLabelText("回顾日期")).toHaveProperty("value", "2026-10-18");
    await waitFor(() => expect(currentParams().has("create")).toBe(false));
    fireEvent.click(within(next).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps the open template and answers when a pending request selects another template", async () => {
    const value = await setup();
    const monthly = builtInTemplates.find(template => template.category === "review" && template.defaults.reviewType === "monthly")!;
    const find = vi.spyOn(value.templateService, "find");
    show(value, "/reviews?create=review&template=default-review", `/reviews?create=review&template=${monthly.id}`);
    const original = await readyDialog();
    fireEvent.change(within(original).getByRole("textbox", { name: "回看" }), { target: { value: "未保存回看" } });
    fireEvent.click(screen.getByRole("button", { name: "打开另一复盘入口" }));
    expect(within(original).getByRole("textbox", { name: "回看" })).toHaveProperty("value", "未保存回看");
    expect(within(original).getByRole("combobox", { name: "复盘周期" })).toHaveProperty("value", "daily");
    expect(find).not.toHaveBeenCalledWith(monthly.id);
    expect(currentParams().get("create")).toBe("review");
    fireEvent.click(within(original).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "复盘周期" })).toHaveProperty("value", "monthly"));
    await readyDialog();
    expect(find).toHaveBeenCalledWith(monthly.id);
    await waitFor(() => expect(currentParams().has("create")).toBe(false));
  });
});
