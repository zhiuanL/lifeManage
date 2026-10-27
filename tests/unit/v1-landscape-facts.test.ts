import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext } from "../../src/app/LifeOSContext";
import type { Action } from "../../src/domain/planning/Action";
import type { Goal } from "../../src/domain/planning/Goal";
import type { Review } from "../../src/domain/reviews/Review";
import { createReviewStructure } from "../../src/domain/reviews/ReviewStructure";
import { LandscapePage } from "../../src/pages/LandscapePage";
import { ReviewsPage } from "../../src/pages/ReviewsPage";
import { LandscapeFactService, type LandscapeFactOptions } from "../../src/services/life/LandscapeFactService";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const clock = { now: () => new Date(2026, 9, 14, 12) };
const timestamp = clock.now().toISOString();
const options: LandscapeFactOptions = {
  domainIds: ["health"], navigation: true, goals: true, attention: true, trends: true, reviews: true,
};

function goal(id: string, domainIds: string[], priority: Goal["priority"] = "medium"): Goal {
  return {
    id, title: id, description: "", domainId: domainIds[0] ?? null, domainIds,
    parentId: null, targetDate: null, status: "active", priority, sortOrder: 0,
    completedAt: null, createdAt: timestamp, updatedAt: timestamp,
  };
}
function action(id: string, domainIds: string[], scheduledFor: string | null, goalId: string | null = null): Action {
  return {
    id, title: id, notes: "", domainId: domainIds[0] ?? null, domainIds,
    goalId, scheduledFor, status: "open", sortOrder: 0,
    completedAt: null, createdAt: timestamp, updatedAt: timestamp,
  };
}
function review(id: string, reviewedOn: string, draft = false): Review {
  const structure = createReviewStructure("weekly", reviewedOn);
  return {
    id, title: id, reflection: "", insight: "", nextFocus: "",
    domainId: "health", domainIds: ["health"], reviewedOn, createdAt: timestamp, updatedAt: timestamp,
    structure: { ...structure, status: draft ? "draft" : "completed" },
  };
}

function emptyFacts(reviews: readonly Review[] = []) {
  return new LandscapeFactService(
    { list: async () => [] }, { list: async () => [] }, { list: async () => [] },
    { getSnapshot: async () => ({ settings: { idleWeeks: 4, issueOccurrences: 3, planAdjustments: 3, metricDrops: 2 }, signals: [] }) },
    { listDefinitions: async () => [], listRecords: async () => [] },
    { list: async () => reviews }, clock,
  );
}

it("places life state and current period before the domain map and factual bands", async () => {
  const app = createApplicationDependencies();
  render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider,
    { value: { ...app, landscapeFactService: emptyFacts() } }, createElement(LandscapePage))));
  await screen.findByRole("region", { name: "回顾与校准" });
  const names = ["当前周期", "正在关注", "生活领域", "方向与近期行动", "值得留意", "最近趋势", "回顾与校准"];
  const regions = names.map(name => screen.getByRole("region", { name }));
  for (let index = 1; index < regions.length; index++) {
    expect(regions[index - 1].compareDocumentPosition(regions[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(screen.getByRole("region", { name: "此刻的生活状态" }).compareDocumentPosition(regions[0]) &
    Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("opens the homepage weekly draft for the exact date without writing on open or cancel", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  const initial = await app.reviewService.list();
  const create = vi.spyOn(app.reviewService, "create");
  const generate = vi.spyOn(app.reviewFactService, "generate");
  render(createElement(LifeOSContext.Provider, { value: { ...app, landscapeFactService: emptyFacts() } },
    createElement(MemoryRouter, {}, createElement(Routes, {},
      createElement(Route, { path: "/", element: createElement(LandscapePage) }),
      createElement(Route, { path: "/reviews", element: createElement(ReviewsPage) })))));
  const link = await screen.findByRole("link", { name: "开始本周复盘" });
  expect(link.getAttribute("href")).toBe("/reviews?create=review&reviewType=weekly&reviewAnchor=2026-10-14");
  fireEvent.click(link);
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "保存回顾" }).matches(":disabled")).toBe(false));
  expect(within(dialog).getByRole("combobox", { name: "复盘周期" })).toHaveProperty("value", "weekly");
  expect(within(dialog).getByLabelText("回顾日期")).toHaveProperty("value", "2026-10-14");
  expect(within(dialog).getByLabelText("复盘起止日期").textContent).toBe("2026-10-12 至 2026-10-18");
  for (const checkbox of within(dialog).getAllByRole("checkbox")) {
    expect(checkbox).toHaveProperty("checked", false);
  }
  expect(generate).toHaveBeenCalledWith({ type: "weekly", start: "2026-10-12", end: "2026-10-18" }, [], undefined);
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(create).not.toHaveBeenCalled();
  expect(await app.reviewService.list()).toEqual(initial);
});

it.each([true, false])("links an existing weekly review to its original record (draft=%s)", async draft => {
  const app = createApplicationDependencies();
  const saved = { ...review("本周 / &", "2026-10-14", draft), domainId: null, domainIds: [] };
  render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider,
    { value: { ...app, landscapeFactService: emptyFacts([saved]) } }, createElement(LandscapePage))));
  const link = await screen.findByRole("link", { name: draft ? "继续本周复盘" : "查看本周复盘" });
  expect(link.getAttribute("href")).toBe(`/reviews?cycle=weekly#review-${encodeURIComponent(saved.id)}`);
  expect(screen.queryByRole("link", { name: "开始本周复盘" })).toBeNull();
});

it("hides the weekly creation entry when the review capability is disabled", async () => {
  const app = createApplicationDependencies();
  render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider,
    { value: { ...app, landscapeFactService: emptyFacts(), modulePreference: { disabledModules: ["reviews"] } } },
    createElement(LandscapePage))));
  await screen.findByRole("region", { name: "当前周期" });
  expect(screen.queryByRole("region", { name: "回顾与校准" })).toBeNull();
  expect(screen.queryByRole("link", { name: "开始本周复盘" })).toBeNull();
});

it("projects saved facts, excludes future/hidden records, and distinguishes drafts from completed reviews", async () => {
  const goals = [goal("normal", ["health"]), goal("important", ["health"], "high"), goal("hidden", ["hidden"])];
  const actions = [action("planned", ["health"], "2026-10-13"),
    action("future", ["health"], "2026-10-15"), action("hidden-action", [], "2026-10-14", "hidden"),
    { ...action("done", [], null, "important"), status: "completed" as const, completedAt: new Date(2026, 9, 14, 9).toISOString() }];
  const service = new LandscapeFactService(
    { list: async () => [{ id: "direction", title: "我的方向", description: "", kind: "vision", archivedAt: null,
      createdAt: timestamp, updatedAt: timestamp }] },
    { list: async () => goals }, { list: async () => actions },
    { getSnapshot: async () => ({ settings: { idleWeeks: 4, issueOccurrences: 3, planAdjustments: 3, metricDrops: 2 }, signals: [] }) },
    { listDefinitions: async () => [
      { id: "sleep", name: "睡眠", unit: "小时", domainIds: ["health"], archived: false, createdAt: timestamp },
      { id: "hidden-metric", name: "隐藏指标", unit: "次", domainIds: ["hidden"], archived: false, createdAt: timestamp },
    ], listRecords: async () => [
      { id: "first", metricId: "sleep", recordedOn: "2026-10-12", value: 7, note: "", createdAt: timestamp, updatedAt: timestamp },
      { id: "zero", metricId: "sleep", recordedOn: "2026-10-14", value: 0, note: "", createdAt: timestamp, updatedAt: timestamp },
      { id: "future", metricId: "sleep", recordedOn: "2026-10-15", value: 9, note: "", createdAt: timestamp, updatedAt: timestamp },
      { id: "hidden", metricId: "hidden-metric", recordedOn: "2026-10-14", value: 1, note: "", createdAt: timestamp, updatedAt: timestamp },
    ] },
    { list: async () => [review("last", "2026-10-11"), review("draft", "2026-10-14", true), review("future", "2026-10-18")] },
    clock,
  );
  const facts = await service.getSnapshot(options);
  expect(facts.week).toEqual({ type: "weekly", start: "2026-10-12", end: "2026-10-18" });
  expect(facts.goals.map(item => item.id)).toEqual(["important", "normal"]);
  expect(facts.actions.map(item => item.action.id)).toEqual(["done", "planned"]);
  expect(facts.metrics).toHaveLength(1);
  expect(facts.metrics[0]).toMatchObject({ latest: { id: "zero", value: 0 }, previous: { id: "first", value: 7 } });
  expect(facts.latestReview?.id).toBe("last");
  expect(facts.weeklyReview?.id).toBe("draft");
});

it("does not read disabled modules", async () => {
  const list = vi.fn().mockRejectedValue(new Error("must not read disabled module"));
  const getSnapshot = vi.fn().mockRejectedValue(new Error("must not read disabled attention"));
  const service = new LandscapeFactService({ list }, { list }, { list }, { getSnapshot },
    { listDefinitions: list, listRecords: list }, { list }, clock);
  const facts = await service.getSnapshot({ ...options, navigation: false, goals: false, attention: false, trends: false, reviews: false });
  expect(list).not.toHaveBeenCalled();
  expect(getSnapshot).not.toHaveBeenCalled();
  expect(facts.goals).toEqual([]);
  expect(facts.latestReview).toBeNull();
});

it("shows independent saved facts without requiring an active domain", async () => {
  const app = createApplicationDependencies();
  const independentGoal = goal("独立目标", []);
  const independentAction = action("独立行动", [], "2026-10-14");
  const independentReview = { ...review("独立复盘", "2026-10-11"), domainId: null, domainIds: [] };
  const service = new LandscapeFactService(
    { list: async () => [] },
    { list: async () => [independentGoal, goal("已暂停领域的目标", ["paused"])] },
    { list: async () => [independentAction] },
    { getSnapshot: async () => ({ settings: { idleWeeks: 4, issueOccurrences: 3, planAdjustments: 3, metricDrops: 2 }, signals: [] }) },
    { listDefinitions: async () => [], listRecords: async () => [] },
    { list: async () => [independentReview] }, clock,
  );
  const list = vi.spyOn(app.lifeDomainService, "list").mockResolvedValue([]);
  render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider,
    { value: { ...app, landscapeFactService: service } }, createElement(LandscapePage))));
  expect(await screen.findByRole("heading", { name: "从这里开始" })).toBeTruthy();
  expect((await screen.findByRole("link", { name: "独立目标" })).getAttribute("href")).toBe(`/goals/${encodeURIComponent("独立目标")}`);
  expect(screen.getByRole("link", { name: "独立行动" }).getAttribute("href")).toBe(`/goals?actionStatus=all#action-${encodeURIComponent("独立行动")}`);
  expect(screen.getByRole("link", { name: "独立复盘" }).getAttribute("href")).toBe(`/reviews#review-${encodeURIComponent("独立复盘")}`);
  expect(screen.queryByRole("link", { name: "已暂停领域的目标" })).toBeNull();
  expect(list).toHaveBeenCalledOnce();
});

it("keeps domain state visible on summary failure and retries with Chinese empty states and source links", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  const domain = (await app.lifeDomainService.list())[0];
  await app.lifeDomainService.update(domain.id, { ...domain, currentState: "正在恢复生活节奏", focus: "留出休息时间" });
  const summary = vi.spyOn(app.landscapeFactService, "getSnapshot").mockRejectedValueOnce(new Error("read failed"));
  render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider,
    { value: { ...app, modulePreference: { disabledModules: ["attention"] as const } } }, createElement(LandscapePage))));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("近期记录读取失败"));
  const map = screen.getByRole("region", { name: "生活领域" });
  expect(within(map).getByText("正在恢复生活节奏")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  expect((await screen.findByRole("link", { name: "查看复盘" })).getAttribute("href")).toBe("/reviews");
  expect(screen.queryByRole("region", { name: "值得留意" })).toBeNull();
  expect(screen.getByText("近四周没有指标记录。")).toBeTruthy();
  expect(screen.getByRole("link", { name: "留出休息时间" }).getAttribute("href")).toBe(`/domains/${domain.id}`);
  expect(summary).toHaveBeenCalledTimes(2);
});
