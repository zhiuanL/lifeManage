import { describe, expect, it, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext } from "../../src/app/LifeOSContext";
import { ReviewEditorDialog } from "../../src/components/ReviewEditorDialog";
import { buildReviewFactDraft, applyReviewFactDraft, type ReviewFactData } from "../../src/domain/reviews/ReviewFactDraft";
import { createReviewStructure, reviewPeriod, reviewTypes } from "../../src/domain/reviews/ReviewStructure";
import type { Review } from "../../src/domain/reviews/Review";
import type { Action } from "../../src/domain/planning/Action";
import type { MetricDefinition, MetricRecord } from "../../src/domain/life/DomainMetric";
import type { Issue } from "../../src/domain/issues/Issue";
import type { ActionPlanChange } from "../../src/domain/planning/ActionPlanChange";
import type { Goal } from "../../src/domain/planning/Goal";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const anchor = "2026-10-13";
const empty = (): ReviewFactData => ({ reviews: [], actions: [], goals: [], items: [], issues: [], metrics: [], records: [], habits: [], logs: [], changes: [], observedOn: anchor });
function review(id: string, type: (typeof reviewTypes)[number], date = anchor, domains: string[] = []): Review {
  const structure = createReviewStructure(type, date);
  return { id, title: id, reflection: "", insight: "", nextFocus: "", domainId: domains[0] ?? null, domainIds: domains,
    reviewedOn: date, createdAt: date + "T00:00:00Z", updatedAt: date + "T00:00:00Z",
    structure: { ...structure, answers: { ...structure.answers, [structure.template.fields[0].key]: "真实记录" } } };
}
function action(id: string, date: string, options: Partial<Action> = {}): Action {
  return { id, title: id, notes: "", domainId: null, domainIds: [], goalId: null, scheduledFor: date,
    status: "open", completedAt: null, sortOrder: 0, createdAt: date + "T00:00:00Z", updatedAt: date + "T00:00:00Z", ...options };
}
async function setup() { const deps = createApplicationDependencies(); await deps.bootstrapApplicationService.bootstrap(); return deps; }
async function mount(deps: Awaited<ReturnType<typeof setup>>, existing?: Review) {
  const result = render(createElement(StrictMode, {}, createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider, { value: deps },
    createElement(ReviewEditorDialog, { domains: [], review: existing,
      initialContext: { type: "daily", anchor, domainIds: [] }, onClose: vi.fn(), onSaved: vi.fn() })))));
  await waitFor(() => expect(screen.getByRole("button", { name: existing ? "保存修改" : "保存回顾" }).matches(":disabled")).toBe(false));
  return result;
}
describe("editable review fact drafts", () => {
  it.each(reviewTypes)("allows empty %s records without inventing conclusions", type => {
    expect(buildReviewFactDraft(reviewPeriod(type, anchor), empty())).toEqual({ answers: {}, omitted: 0 });
  });
  it.each(["weekly", "monthly", "quarterly", "annual"] as const)("uses only direct lower %s records in period and scope", type => {
    const lower = reviewTypes[reviewTypes.indexOf(type) - 1];
    const data = empty(); data.reviews = [review("include", lower, anchor, ["health"]), review("other", lower, anchor, ["work"]), review("old", lower, "2025-01-01", ["health"]), review("same", type, anchor, ["health"])];
    const content = JSON.stringify(buildReviewFactDraft(reviewPeriod(type, anchor), data, ["health"]).answers);
    expect(content).toContain("include"); expect(content).toContain("真实记录");
    expect(content).not.toContain("other"); expect(content).not.toContain("old"); expect(content).not.toContain("same");
    expect(buildReviewFactDraft(reviewPeriod(type, anchor), data, ["health"], "include").answers).toEqual({});
  });
  it("uses completion date, goal-inherited domains, and distinguishes zero from missing", () => {
    const data = empty(); data.goals = [{ id: "g", domainIds: ["health"], createdAt: "2027-01-01" } as Goal];
    data.actions = [action("zero", "2025-01-01", { goalId: "g", status: "completed", completedAt: anchor + "T12:00:00Z", details: { actualMinutes: 0 } }), action("missing", anchor, { domainIds: ["health"] }), action("unrelated", anchor)];
    const text = buildReviewFactDraft(reviewPeriod("weekly", anchor), data, ["health"]).answers.execution;
    expect(text).toContain("zero"); expect(text).toContain("0 分钟"); expect(text).toContain("missing"); expect(text).not.toContain("unrelated");
    expect(text.match(/分钟/g)).toHaveLength(1);
  });
  it("keeps template defaults and written content and never adds unknown fields", () => {
    const structure = createReviewStructure("weekly", anchor);
    const result = applyReviewFactDraft({ ...structure, answers: { ...structure.answers, execution: "手写" } }, { answers: { execution: "事实", goalProgress: "目标事实", unknown: "不添加" }, omitted: 0 });
    expect(result.answers.execution).toBe("手写"); expect(result.answers.goalProgress).toBe("目标事实"); expect(result.answers).not.toHaveProperty("unknown"); expect(structure.answers.goalProgress).toBe("");
  });
  it("keeps dated zero metric values even for archived definitions without inventing trends", () => {
    const data = empty();
    data.metrics = [{ id: "m", name: "投入", unit: "分钟", domainIds: ["health"], archived: true, createdAt: anchor } satisfies MetricDefinition];
    data.records = [anchor, "2025-01-01"].map((date, i) => ({ id: "m" + i, metricId: "m", recordedOn: date, value: i, note: "", createdAt: anchor, updatedAt: anchor } satisfies MetricRecord));
    const result = buildReviewFactDraft(reviewPeriod("monthly", anchor), data, ["health"]);
    expect(result.answers.domainTrends).toBe(anchor + " 投入：0 分钟");
    expect(buildReviewFactDraft(reviewPeriod("monthly", anchor), data, ["work"]).answers).toEqual({});
  });
  it("labels lifetime issue counts and omits unrecorded hypotheses", () => {
    const data = empty();
    data.issues = [{ id: "i", title: "睡眠", description: "", firstSeen: "2025-01-01", occurrenceCount: 9, causeHypothesis: "原因猜测", attempts: "", followUp: "观察", status: "watching", goalId: null, domainIds: ["health"], createdAt: anchor, updatedAt: anchor } satisfies Issue];
    const text = buildReviewFactDraft(reviewPeriod("weekly", anchor), data, ["health"]).answers.recurringIssues;
    expect(text).toContain("当前累计 9 次（非周期次数）"); expect(text).toContain("当前后续：观察"); expect(text).not.toContain("原因猜测");
    data.issues = data.issues.map(issue => ({ ...issue, updatedAt: "2025-01-01" }));
    expect(buildReviewFactDraft(reviewPeriod("weekly", anchor), data).answers).toEqual({});
  });
  it("includes only scoped, in-period adjustments and their historical dates", () => {
    const data = empty(); data.actions = [action("a", anchor, { domainIds: ["health"] })];
    const change: ActionPlanChange = { id: 1, actionId: "a", beforeDate: "2026-10-12", afterDate: "2026-10-14", reason: "external", note: "真实原因", changedAt: anchor, completedAtAtChange: null, domainId: "health", goalId: null };
    data.changes = [change, { ...change, id: 2, reason: "initial", note: "首次不算" }, { ...change, id: 3, changedAt: "2025-01-01", note: "过去不算" }];
    const text = buildReviewFactDraft(reviewPeriod("weekly", anchor), data, ["health"]).answers.planChanges;
    expect(text).toContain("2026-10-12 → 2026-10-14"); expect(text).toContain("真实原因"); expect(text).not.toContain("不算");
    expect(buildReviewFactDraft(reviewPeriod("weekly", anchor), data, ["work"]).answers).toEqual({});
  });
  it("bounds drafts without silently slicing source text", () => {
    const data = empty(); data.reviews = Array.from({ length: 30 }, (_, index) => ({ ...review("r" + index, "daily"), title: "x".repeat(900) }));
    const facts = buildReviewFactDraft(reviewPeriod("weekly", anchor), data);
    expect(facts.omitted).toBeGreaterThan(0); expect(facts.answers.execution.length).toBeLessThanOrEqual(11000);
  });
  it("preserves manual text and deleted answers during asynchronous generation", async () => {
    const deps = await setup(); let resolve!: (value: { answers: Record<string, string>; omitted: number }) => void;
    vi.spyOn(deps.reviewFactService, "generate").mockImplementation(() => new Promise(done => { resolve = done; }));
    await mount(deps); fireEvent.change(screen.getByLabelText("复盘周期"), { target: { value: "weekly" } });
    await waitFor(() => expect(screen.getByLabelText("本周执行总结").matches(":disabled")).toBe(false));
    fireEvent.change(screen.getByLabelText("本周执行总结"), { target: { value: "自己写" } });
    fireEvent.change(screen.getByLabelText("目标进度"), { target: { value: "删除前" } }); fireEvent.change(screen.getByLabelText("目标进度"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "保存回顾" }).matches(":disabled")).toBe(true);
    await act(async () => { resolve({ answers: { execution: "自动总结", goalProgress: "自动进度", recurringIssues: "问题事实" }, omitted: 0 }); });
    await waitFor(() => expect(screen.getByLabelText("反复问题")).toHaveProperty("value", "问题事实"));
    expect(screen.getByLabelText("本周执行总结")).toHaveProperty("value", "自己写"); expect(screen.getByLabelText("目标进度")).toHaveProperty("value", "");
  });
  it("ignores stale responses and refreshes untouched facts on date change", async () => {
    const deps = await setup(); const pending: ((value: { answers: Record<string, string>; omitted: number }) => void)[] = [];
    vi.spyOn(deps.reviewFactService, "generate").mockImplementation(() => new Promise(done => pending.push(done)));
    await mount(deps); fireEvent.change(screen.getByLabelText("复盘周期"), { target: { value: "weekly" } });
    await waitFor(() => expect(screen.getByLabelText("回顾日期").matches(":disabled")).toBe(false));
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("回顾日期"), { target: { value: "2026-10-20" } });
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => {
      pending[0]({ answers: { execution: "过期结果" }, omitted: 0 });
      pending[1]({ answers: { execution: "新周期" }, omitted: 0 });
    });
    await waitFor(() => expect(screen.getByLabelText("本周执行总结")).toHaveProperty("value", "新周期"));
    fireEvent.change(screen.getByLabelText("回顾日期"), { target: { value: "2026-10-27" } });
    await waitFor(() => expect(pending).toHaveLength(3));
    await act(async () => { pending[2]({ answers: {}, omitted: 0 }); });
    await waitFor(() => expect(screen.getByLabelText("本周执行总结")).toHaveProperty("value", ""));
  });
  it("clears stale automatic text after a failed refresh but preserves manual edits", async () => {
    const deps = await setup();
    const generate = vi.spyOn(deps.reviewFactService, "generate").mockResolvedValue({ answers: { execution: "旧周期", goalProgress: "原进度" }, omitted: 0 });
    await mount(deps); fireEvent.change(screen.getByLabelText("复盘周期"), { target: { value: "weekly" } });
    await waitFor(() => expect(screen.getByLabelText("本周执行总结")).toHaveProperty("value", "旧周期"));
    await waitFor(() => expect(screen.getByLabelText("回顾日期").matches(":disabled")).toBe(false));
    fireEvent.change(screen.getByLabelText("目标进度"), { target: { value: "手写进度" } });
    generate.mockRejectedValue(new Error("新周期读取失败"));
    fireEvent.change(screen.getByLabelText("回顾日期"), { target: { value: "2026-10-20" } });
    await screen.findByText("事实草稿读取失败，请重试。");
    expect(screen.getByLabelText("本周执行总结")).toHaveProperty("value", "");
    expect(screen.getByLabelText("目标进度")).toHaveProperty("value", "手写进度");
    expect(screen.getByRole("button", { name: "保存回顾" }).matches(":disabled")).toBe(false);
    generate.mockResolvedValue({ answers: { execution: "新周期", goalProgress: "自动进度" }, omitted: 0 });
    fireEvent.click(screen.getByRole("button", { name: "汇总事实" }));
    await waitFor(() => expect(screen.getByLabelText("本周执行总结")).toHaveProperty("value", "新周期"));
    expect(screen.getByLabelText("目标进度")).toHaveProperty("value", "手写进度");
  });
  it("keeps edited and deleted fields when switching cycles and refreshing", async () => {
    const deps = await setup();
    vi.spyOn(deps.reviewFactService, "generate").mockResolvedValue({ answers: { execution: "事实", goalProgress: "进度" }, omitted: 0 });
    await mount(deps); fireEvent.change(screen.getByLabelText("复盘周期"), { target: { value: "weekly" } });
    await waitFor(() => expect(screen.getByLabelText("目标进度")).toHaveProperty("value", "进度"));
    await waitFor(() => expect(screen.getByLabelText("复盘周期").matches(":disabled")).toBe(false));
    fireEvent.change(screen.getByLabelText("本周执行总结"), { target: { value: "手写" } });
    fireEvent.change(screen.getByLabelText("目标进度"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("复盘周期"), { target: { value: "monthly" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "保存回顾" }).matches(":disabled")).toBe(false));
    fireEvent.change(screen.getByLabelText("复盘周期"), { target: { value: "weekly" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "保存回顾" }).matches(":disabled")).toBe(false));
    expect(screen.getByLabelText("本周执行总结")).toHaveProperty("value", "手写");
    expect(screen.getByLabelText("目标进度")).toHaveProperty("value", "");
  });
  it("does not auto-read facts for saved instances and can retry errors", async () => {
    const deps = await setup(); const generate = vi.spyOn(deps.reviewFactService, "generate").mockRejectedValueOnce(new Error("读取失败"));
    await mount(deps, review("existing", "weekly")); expect(generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "汇总事实" })); await screen.findByText("事实草稿读取失败，请重试。");
    expect(screen.getByLabelText("本周执行总结")).toHaveProperty("value", "真实记录");
    generate.mockResolvedValue({ answers: { goalProgress: "重试事实" }, omitted: 0 });
    fireEvent.click(screen.getByRole("button", { name: "汇总事实" })); await waitFor(() => expect(screen.getByLabelText("目标进度")).toHaveProperty("value", "重试事实"));
  });
});
