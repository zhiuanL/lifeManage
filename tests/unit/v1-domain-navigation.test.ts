import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { isActionInDomain } from "../../src/domain/planning/Action";
import { DomainContextPage } from "../../src/pages/DomainContextPage";
import { GoalsPage } from "../../src/pages/GoalsPage";
import { ReviewsPage } from "../../src/pages/ReviewsPage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteActionRepository } from "../../src/repositories/sqlite/SqliteActionRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteGoalProgressItemRepository } from "../../src/repositories/sqlite/SqliteGoalProgressItemRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteReviewRepository } from "../../src/repositories/sqlite/SqliteReviewRepository";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { ActionService } from "../../src/services/planning/ActionService";
import { GoalService } from "../../src/services/planning/GoalService";
import { GoalProgressItemService } from "../../src/services/planning/GoalProgressItemService";
import { ReviewService } from "../../src/services/reviews/ReviewService";

import type { ModulePreference } from "../../src/domain/system/ModulePreference";

const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
afterEach(() => {
  cleanup();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

const clock = { now: () => new Date("2026-09-29T08:00:00Z") };
const empty = { list: async () => [] };

async function setup(modulePreference?: ModulePreference) {
  const sql = new MemorySqliteExecutor();
  await new MigrationRunner(sql, migrations, clock).run();
  let seq = 0;
  const ids = { next: () => `v1-context-${++seq}` };
  const domains = new SqliteLifeDomainRepository(sql);
  const goals = new SqliteGoalRepository(sql);
  const lifeDomainService = new LifeDomainService(domains, clock, ids);
  const goalService = new GoalService(goals, domains, clock, ids);
  const goalProgressItemService = new GoalProgressItemService(
    new SqliteGoalProgressItemRepository(sql), goals, clock, ids);
  const actionService = new ActionService(new SqliteActionRepository(sql), goals, domains, clock, ids);
  const reviewService = new ReviewService(new SqliteReviewRepository(sql, true), domains, clock, ids);
  const health = await lifeDomainService.create({
    name: "健康", description: "", focus: "", color: "fern", icon: "heart",
  });
  const work = await lifeDomainService.create({
    name: "事业", description: "", focus: "", color: "ocean", icon: "briefcase",
  });
  const healthGoal = await goalService.create({
    title: "规律睡眠", description: "", domainId: health.id, status: "active", targetDate: null,
  });
  await goalService.create({
    title: "更新简历", description: "", domainId: work.id, status: "active", targetDate: null,
  });
  const inherited = await actionService.create({
    title: "提前放下手机", notes: "", domainId: null, goalId: healthGoal.id, scheduledFor: null,
  });
  const shared = await actionService.create({
    title: "协调工作时间", notes: "", domainId: work.id, goalId: healthGoal.id, scheduledFor: null,
  });
  await actionService.create({
    title: "整理作品集", notes: "", domainId: work.id, goalId: null, scheduledFor: null,
  });
  await actionService.create({
    title: "自由安排", notes: "", domainId: null, goalId: null, scheduledFor: null,
  });
  await reviewService.create({
    title: "睡眠回看", reflection: "", insight: "", nextFocus: "",
    domainId: health.id, reviewedOn: "2026-09-28",
  });
  await reviewService.create({
    title: "工作回看", reflection: "", insight: "", nextFocus: "",
    domainId: work.id, reviewedOn: "2026-09-27",
  });
  const value = {
    modulePreference, lifeNavigationService: empty, lifeDomainService, goalService, goalProgressItemService, actionService, reviewService,
    templateService: { getDefaultTemplate: async () => null },
    issueService: empty, decisionService: empty, habitService: { ...empty, listLogs: empty.list },
    lifeRecordsService: { listPeople: empty.list, listEvents: empty.list, listSkills: empty.list },
    domainMetricService: { listDefinitions: empty.list, listRecords: empty.list, listSatisfactionLinks: empty.list },
  } as LifeOSContextValue;
  function show(path: string) {
    return render(createElement(MemoryRouter, { initialEntries: [path] },
      createElement(LifeOSContext.Provider, { value },
        createElement(Routes, null,
          createElement(Route, { path: "/domains/:domainId", element: createElement(DomainContextPage) }),
          createElement(Route, { path: "/goals", element: createElement(GoalsPage) }),
          createElement(Route, { path: "/reviews", element: createElement(ReviewsPage) }),
        ))));
  }
  return { show, health, work, healthGoal, inherited, shared, goalService, actionService, reviewService };
}

describe("V1 领域到模块的上下文", () => {
  it("module preferences hide capability entries without removing domain facts", async () => {
    const { show, health, goalService, reviewService } = await setup({ disabledModules: ["goals", "reviews", "habits", "issues", "decisions", "people", "timeline", "skills", "resources", "attention", "analytics"] });
    const goals = await goalService.list();
    const reviews = await reviewService.list();
    show(`/domains/${health.id}`);
    expect(await screen.findByText("规律睡眠")).toBeTruthy();
    expect(screen.getByText("睡眠回看")).toBeTruthy();
    expect(screen.getByText("提前放下手机")).toBeTruthy();
    expect(screen.getByRole("link", { name: "导出领域上下文" }).getAttribute("href")).toBe(`/export?domain=${health.id}`);
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href")).not.toMatch(/^\/(goals|reviews|habits|issues|decisions|people|timeline|skills|resources|attention|analytics)(\?|$)/);
    expect(await goalService.list()).toEqual(goals);
    expect(await reviewService.list()).toEqual(reviews);
  });
  it("候选保留在未结束视图，放弃及归档可筛选并恢复", async () => {
    const { show, health, goalService } = await setup();
    const candidate = await goalService.create({ title: "候选方向", description: "",
      domainId: health.id, status: "candidate", targetDate: null });
    const abandoned = await goalService.create({ title: "放弃方向", description: "",
      domainId: health.id, status: "abandoned", statusReason: "现实条件改变", targetDate: null });
    await goalService.create({ title: "归档方向", description: "",
      domainId: health.id, status: "archived", targetDate: null });
    show(`/goals?domain=${health.id}`);
    expect(await screen.findByRole("heading", { name: candidate.title })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "放弃方向" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "归档方向" })).toBeNull();
    fireEvent.change(screen.getByLabelText("目标状态"), { target: { value: "abandoned" } });
    expect(screen.getByRole("heading", { name: abandoned.title })).toBeTruthy();
    expect(screen.getByText("状态原因：现实条件改变")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "编辑目标：放弃方向" }));
    fireEvent.change(screen.getByLabelText("当前状态"), { target: { value: "active" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.change(await screen.findByLabelText("目标状态"), { target: { value: "ongoing" } });
    expect(screen.getByRole("heading", { name: "放弃方向" })).toBeTruthy();
    expect((await goalService.findById(abandoned.id))?.statusReason).toBeNull();
    fireEvent.change(screen.getByLabelText("目标状态"), { target: { value: "archived" } });
    expect(screen.getByRole("heading", { name: "归档方向" })).toBeTruthy();
  });
  it("默认收起已完成事项，筛选互不影响且不改变完整事实进度", async () => {
    const { show, health, work, healthGoal, inherited, goalService, actionService } = await setup();
    const completed = await goalService.create({ title: "已完成方向", description: "",
      domainId: health.id, status: "completed", targetDate: null });
    await goalService.update(healthGoal.id, { ...healthGoal, parentId: completed.id });
    await actionService.toggleCompletion(inherited.id);
    const beforeGoals = await goalService.list();
    const beforeActions = await actionService.list();
    show(`/goals?domain=${health.id}`);
    const goalFilter = await screen.findByRole("combobox", { name: "目标状态" });
    const actionFilter = screen.getByRole("combobox", { name: "行动状态" });
    expect(goalFilter).toHaveProperty("value", "ongoing");
    expect(actionFilter).toHaveProperty("value", "open");
    expect(screen.queryByRole("heading", { name: "已完成方向" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "提前放下手机" })).toBeNull();
    expect(screen.getByRole("heading", { name: "规律睡眠" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "规律睡眠关联事项进展" })).toHaveProperty("value", 50);
    fireEvent.change(goalFilter, { target: { value: "completed" } });
    expect(screen.getByRole("heading", { name: "已完成方向" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "规律睡眠" })).toBeNull();
    expect(screen.getByRole("heading", { name: "协调工作时间" })).toBeTruthy();
    fireEvent.change(actionFilter, { target: { value: "completed" } });
    expect(screen.getByRole("heading", { name: "提前放下手机" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "协调工作时间" })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "按生活领域筛选" }),
      { target: { value: work.id } });
    expect(screen.getByText("当前筛选下没有目标。")).toBeTruthy();
    expect(screen.getByText("当前筛选下没有行动。")).toBeTruthy();
    expect(goalFilter).toHaveProperty("value", "completed");
    expect(actionFilter).toHaveProperty("value", "completed");
    expect(await goalService.list()).toEqual(beforeGoals);
    expect(await actionService.list()).toEqual(beforeActions);
  });

  it.each(["goal", "action"])("已完成 %s 的直达链接仍能找到原记录", async (type) => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    const { show, healthGoal, inherited, goalService, actionService } = await setup();
    await goalService.update(healthGoal.id, { ...healthGoal, status: "completed" });
    await actionService.toggleCompletion(inherited.id);
    const id = type === "goal" ? healthGoal.id : inherited.id;
    show(`/goals#${type}-${id}`);
    expect(await screen.findByRole("heading", { name: type === "goal" ? "规律睡眠" : "提前放下手机" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: type === "goal" ? "目标状态" : "行动状态" }))
      .toHaveProperty("value", "all");
    expect(document.getElementById(`${type}-${id}`)).toBeTruthy();
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: "center" }));
  });

  it.each(["goalStatus=unknown", "actionStatus=unknown"])("无效状态 %s 不扩大范围，清除后保留领域", async (filter) => {
    const { show, health } = await setup();
    show(`/goals?domain=${health.id}&${filter}`);
    expect(await screen.findByRole("heading", { name: "无法按当前状态查看目标与行动" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "更新简历" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清除失效状态筛选" }));
    expect(await screen.findByRole("combobox", { name: "按生活领域筛选" })).toHaveProperty("value", health.id);
    expect(screen.getByRole("heading", { name: "规律睡眠" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "更新简历" })).toBeNull();
  });

  it("完成与恢复行动后仍可通过状态筛选找回且进度同步刷新", async () => {
    const { show } = await setup();
    show("/goals");
    fireEvent.click(await screen.findByRole("button", { name: "标记为完成：提前放下手机" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "提前放下手机" })).toBeNull());
    fireEvent.change(screen.getByRole("combobox", { name: "行动状态" }), { target: { value: "completed" } });
    fireEvent.click(screen.getByRole("button", { name: "恢复为未完成：提前放下手机" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "提前放下手机" })).toBeNull());
    fireEvent.change(screen.getByRole("combobox", { name: "行动状态" }), { target: { value: "open" } });
    expect(screen.getByRole("heading", { name: "提前放下手机" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "规律睡眠关联事项进展" })).toHaveProperty("value", 0);
  });

  it("目标的关联事项进展在行动完成后刷新，空目标不伪造百分比", async () => {
    const { show } = await setup();
    show("/goals");
    const progress = await screen.findByRole("progressbar", { name: "规律睡眠关联事项进展" });
    expect(progress).toHaveProperty("value", 0);
    expect(screen.queryByRole("progressbar", { name: "更新简历关联事项进展" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "标记为完成：提前放下手机" }));
    await waitFor(() => expect(screen.getByRole("progressbar",
      { name: "规律睡眠关联事项进展" })).toHaveProperty("value", 50));
  });

  it("按行动自身领域或关联目标的领域匹配，同时排除无关行动", async () => {
    const { health, work, healthGoal, inherited, shared, goalService, actionService } = await setup();
    const goalMap = new Map((await goalService.list()).map((goal) => [goal.id, goal]));
    expect(isActionInDomain(inherited, health.id, goalMap)).toBe(true);
    expect(isActionInDomain(inherited, work.id, goalMap)).toBe(false);
    expect(isActionInDomain(shared, health.id, goalMap)).toBe(true);
    expect(isActionInDomain(shared, work.id, goalMap)).toBe(true);
    expect(isActionInDomain(shared, "unknown", goalMap)).toBe(false);
    expect((await actionService.list()).filter((action) =>
      isActionInDomain(action, health.id, goalMap))).toHaveLength(2);
    expect(goalMap.get(healthGoal.id)?.domainId).toBe(health.id);
  });

  it("从领域打开目标与行动，保留目标继承的行动并能返回全局视图", async () => {
    const { show, health, work } = await setup();
    show(`/domains/${health.id}`);
    expect(await screen.findByText("提前放下手机")).toBeTruthy();
    expect(screen.getByText("协调工作时间")).toBeTruthy();
    expect(screen.queryByText("整理作品集")).toBeNull();
    const link = screen.getByRole("link", { name: "打开目标与行动" });
    expect(link.getAttribute("href")).toBe(`/goals?domain=${health.id}`);
    fireEvent.click(link);

    const select = await screen.findByRole<HTMLSelectElement>("combobox", { name: "按生活领域筛选" });
    expect(select.value).toBe(health.id);
    const goalList = screen.getByRole("region", { name: "目标" });
    const actionList = screen.getByRole("region", { name: "行动清单" });
    expect(within(goalList).getByRole("heading", { name: "规律睡眠" })).toBeTruthy();
    expect(within(goalList).queryByRole("heading", { name: "更新简历" })).toBeNull();
    expect(within(actionList).getByRole("heading", { name: "提前放下手机" })).toBeTruthy();
    expect(within(actionList).getByRole("heading", { name: "协调工作时间" })).toBeTruthy();
    expect(within(actionList).queryByRole("heading", { name: "整理作品集" })).toBeNull();
    expect(within(actionList).queryByRole("heading", { name: "自由安排" })).toBeNull();

    fireEvent.change(select, { target: { value: work.id } });
    expect(within(goalList).getByRole("heading", { name: "更新简历" })).toBeTruthy();
    expect(within(actionList).getByRole("heading", { name: "协调工作时间" })).toBeTruthy();
    expect(within(actionList).queryByRole("heading", { name: "提前放下手机" })).toBeNull();
    fireEvent.change(select, { target: { value: "" } });
    expect(within(goalList).getByRole("heading", { name: "规律睡眠" })).toBeTruthy();
    expect(within(actionList).getByRole("heading", { name: "自由安排" })).toBeTruthy();
  });

  it("跨领域目标同时出现在两个领域，并携带其行动上下文", async () => {
    const { show, health, work, healthGoal, goalService } = await setup();
    await goalService.update(healthGoal.id, { ...healthGoal,
      domainIds: [health.id, work.id] });
    show(`/goals?domain=${work.id}`);
    const goalList = await screen.findByRole("region", { name: "目标" });
    const actionList = screen.getByRole("region", { name: "行动清单" });
    expect(within(goalList).getByRole("heading", { name: "规律睡眠" })).toBeTruthy();
    expect(within(actionList).getByRole("heading", { name: "提前放下手机" })).toBeTruthy();
    expect((await goalService.findById(healthGoal.id))?.domainIds)
      .toEqual([health.id, work.id]);
  });

  it("在领域下新建目标和行动时预选领域，编辑继承关联时不暗中写入领域", async () => {
    const { show, health, work, inherited, goalService, actionService } = await setup();
    show(`/goals?domain=${health.id}`);
    fireEvent.click(await screen.findByRole("button", { name: "新建目标" }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "目标名称" }))
      .toHaveProperty("disabled", false));
    expect(within(dialog).getByRole("checkbox", { name: "健康" })).toHaveProperty("checked", true);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "事业" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "目标名称" }),
      { target: { value: "留出休息时间" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建目标" }));
    await waitFor(async () => expect((await goalService.list()).find((goal) =>
      goal.title === "留出休息时间")?.domainIds).toEqual([health.id, work.id]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "新增行动" }));
    const actionDialog = screen.getByRole("dialog");
    expect(within(actionDialog).getByRole("checkbox", { name: "健康" }))
      .toHaveProperty("checked", true);
    fireEvent.click(within(actionDialog).getByRole("checkbox", { name: "事业" }));
    fireEvent.change(within(actionDialog).getByRole("textbox", { name: "行动名称" }),
      { target: { value: "留出晚间时间" } });
    fireEvent.click(within(actionDialog).getByRole("button", { name: "创建行动" }));
    await waitFor(async () => expect((await actionService.list()).find((action) =>
      action.title === "留出晚间时间")?.domainIds).toEqual([health.id, work.id]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: "编辑行动：提前放下手机" }));
    expect(within(screen.getByRole("dialog"))
      .getByRole("checkbox", { name: "健康" })).toHaveProperty("checked", false);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "保存修改" }));
    await waitFor(async () =>
      expect((await actionService.findById(inherited.id))?.domainId).toBeNull());
  });

  it("从领域打开复盘并按领域查看、新建及清除筛选", async () => {
    const { show, health, work, reviewService } = await setup();
    show(`/domains/${health.id}`);
    fireEvent.click(await screen.findByRole("link", { name: "查看领域复盘" }));
    const select = await screen.findByRole<HTMLSelectElement>("combobox", { name: "按生活领域筛选" });
    expect(select.value).toBe(health.id);
    const list = screen.getByRole("region", { name: "回顾记录" });
    expect(within(list).getByRole("heading", { name: "睡眠回看" })).toBeTruthy();
    expect(within(list).queryByRole("heading", { name: "工作回看" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "记录回顾" }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "标题" }))
      .toHaveProperty("disabled", false));
    expect(within(dialog).getByRole("checkbox", { name: "健康" })).toHaveProperty("checked", true);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "事业" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "标题" }),
      { target: { value: "今日回看" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存回顾" }));
    await waitFor(async () => expect((await reviewService.list()).find((review) =>
      review.title === "今日回看")?.domainIds).toEqual([health.id, work.id]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.change(select, { target: { value: work.id } });
    expect(within(list).getByRole("heading", { name: "工作回看" })).toBeTruthy();
    expect(within(list).queryByRole("heading", { name: "睡眠回看" })).toBeNull();
    fireEvent.change(select, { target: { value: "" } });
    expect(within(list).getByRole("heading", { name: "睡眠回看" })).toBeTruthy();
  });

  it("失效领域链接不会悄悄退回全局列表", async () => {
    const { show } = await setup();
    const goals = show("/goals?domain=missing");
    expect(await screen.findByRole("heading", { name: "无法按当前领域查看目标与行动" })).toBeTruthy();
    expect(screen.queryByText("规律睡眠")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
    expect(await screen.findByRole("heading", { name: "规律睡眠" })).toBeTruthy();
    goals.unmount();
    show("/reviews?domain=missing");
    expect(await screen.findByRole("heading", { name: "无法按当前领域查看回顾" })).toBeTruthy();
    expect(screen.queryByText("睡眠回看")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
    expect(await screen.findByRole("heading", { name: "睡眠回看" })).toBeTruthy();
  });
});
