import { SqliteSystemAssessmentRepository } from "../../src/repositories/sqlite/SqliteSystemAssessmentRepository";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AppRouter } from "../../src/app/AppRouter";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { PeoplePage, TimelinePage } from "../../src/pages/LifeRecordsPages";
import { ResourcesPage } from "../../src/pages/ResourcesPage";
import { SystemAssessmentPage } from "../../src/pages/SystemAssessmentPage";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteLifeRecordsRepository } from "../../src/repositories/sqlite/SqliteLifeRecordsRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { SqliteGoalHistoryRepository } from "../../src/repositories/sqlite/SqliteGoalHistoryRepository";
import { SqliteGoalProgressItemRepository } from "../../src/repositories/sqlite/SqliteGoalProgressItemRepository";
import { GoalTimelineService } from "../../src/services/history/GoalTimelineService";
import { DomainTimelineService } from "../../src/services/history/DomainTimelineService";
import { SqliteDomainHistoryRepository } from "../../src/repositories/sqlite/SqliteDomainHistoryRepository";
import { PersonRelationshipTimelineService } from "../../src/services/history/PersonRelationshipTimelineService";
import { SqlitePersonRelationshipHistoryRepository } from "../../src/repositories/sqlite/SqlitePersonRelationshipHistoryRepository";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { GoalService } from "../../src/services/planning/GoalService";
import { LifeRecordsService } from "../../src/services/records/LifeRecordsService";
import { SqliteResourceNeedRepository } from "../../src/repositories/sqlite/SqliteResourceNeedRepository";
import { SqliteDecisionRepository } from "../../src/repositories/sqlite/SqliteDecisionRepository";
import { ResourceService } from "../../src/services/resources/ResourceService";
import { SystemAssessmentService } from "../../src/services/assessments/SystemAssessmentService";

afterEach(cleanup);
let seq = 0;
const ids = { next: () => `ui-m7-${++seq}` };
const clock = { now: () => new Date("2026-09-29T08:00:00Z") };
const empty = { list: async () => [] };

async function setup() {
  const sql = new MemorySqliteExecutor();
  await new MigrationRunner(sql, migrations, clock).run();
  const domains = new SqliteLifeDomainRepository(sql);
  const goals = new SqliteGoalRepository(sql);
  const lifeDomainService = new LifeDomainService(domains, clock, ids);
  const goalService = new GoalService(goals, domains, clock, ids);
  const lifeRecordsService = new LifeRecordsService(
    new SqliteLifeRecordsRepository(sql), domains, goals, clock, ids);
  const decisions = new SqliteDecisionRepository(sql);
  const resourceService = new ResourceService(new SqliteResourceNeedRepository(sql), goalService, lifeRecordsService, clock, ids, decisions);
  const systemAssessmentService = new SystemAssessmentService(new SqliteSystemAssessmentRepository(sql), clock, ids);
  const domain = await lifeDomainService.create({ name: "健康", description: "", focus: "",
    color: "fern", icon: "heart" });
  const goal = await goalService.create({ title: "改善节奏", description: "",
    domainId: domain.id, status: "active", targetDate: null });
  const context = { lifeDomainService, goalService, lifeRecordsService, resourceService,
    goalTimelineService: new GoalTimelineService(new SqliteGoalHistoryRepository(sql),
      goals, new SqliteGoalProgressItemRepository(sql)),
    domainTimelineService: new DomainTimelineService(new SqliteDomainHistoryRepository(sql)),
    personRelationshipTimelineService: new PersonRelationshipTimelineService(
      new SqlitePersonRelationshipHistoryRepository(sql)),
    systemAssessmentService, decisionService: empty, reviewService: empty,
    actionService: empty, issueService: empty,
    domainMetricService: { listDefinitions: async () => [], listRecords: async () => [] } } as LifeOSContextValue;
  const show = (element: React.ReactElement, path: string) =>
    render(createElement(MemoryRouter, { initialEntries: [path] },
      createElement(LifeOSContext.Provider, { value: context }, element)));
  return { decisions, context, domain, goal, show, lifeRecordsService, resourceService, systemAssessmentService };
}

describe("M7 Chinese workflows", () => {

  it("reads goal-scoped source metrics with zero, latest date, missing observations and source links", async () => {
    const { context, domain, goal, show } = await setup();
    const metric = { id: "energy", name: "当前精力", unit: "分", domainIds: [domain.id], archived: false, createdAt: "2020-01-01" };
    context.domainMetricService = {
      listDefinitions: async () => [metric, { ...metric, id: "empty", name: "睡眠状态" },
        { ...metric, id: "other", name: "无关指标", domainIds: ["other"] }, { ...metric, id: "archived", name: "归档指标", archived: true }],
      listRecords: async () => [
        { id: "zero", metricId: metric.id, recordedOn: "2020-01-02", value: 0, note: "实际零值", createdAt: "2020-01-02", updatedAt: "2020-01-02" },
        { id: "older", metricId: metric.id, recordedOn: "2020-01-01", value: 8, note: "旧值", createdAt: "2020-01-01", updatedAt: "2026-10-13" },
        { id: "future", metricId: metric.id, recordedOn: "2099-01-01", value: 99, note: "未来值", createdAt: "2020-01-01", updatedAt: "2020-01-01" },
      ],
    } as unknown as LifeOSContextValue["domainMetricService"];
    const page = show(createElement(ResourcesPage), "/resources?goal=" + goal.id);
    expect(await screen.findByText("0 分 · 2020-01-02")).toBeTruthy();
    expect(screen.getByText("实际零值")).toBeTruthy();
    expect(screen.getByText("尚无截至今日的记录")).toBeTruthy();
    expect(screen.queryByText("无关指标")).toBeNull();
    expect(screen.queryByText("归档指标")).toBeNull();
    expect(screen.queryByText("未来值")).toBeNull();
    expect(screen.queryByText("旧值")).toBeNull();
    expect(screen.getAllByRole("link", { name: "健康指标" }).map((link) => link.getAttribute("href")))
      .toEqual(["/domains/" + domain.id + "#metric-record-zero", "/domains/" + domain.id + "#metric-empty"]);
    page.unmount();
    context.domainMetricService.listRecords = async () => [{ id: "new", metricId: metric.id, recordedOn: "2020-01-03", value: 2, note: "新的源事实", createdAt: "2020-01-03", updatedAt: "2020-01-03" }];
    show(createElement(ResourcesPage), "/resources?goal=" + goal.id);
    expect(await screen.findByText("2 分 · 2020-01-03")).toBeTruthy();
    expect(screen.queryByText("实际零值")).toBeNull();
  });
  it("does not import unrelated metrics into a domainless goal", async () => {
    const { context, goal, domain, show } = await setup();
    context.goalService = { list: async () => [{ ...goal, domainId: null, domainIds: [] }] } as unknown as LifeOSContextValue["goalService"];
    context.domainMetricService.listDefinitions = async () => [{ id: "metric", name: "不属于目标的指标", unit: "分", domainIds: [domain.id], archived: false, createdAt: "2020-01-01" }];
    show(createElement(ResourcesPage), "/resources?goal=" + goal.id);
    expect(await screen.findByText("暂无相关状态指标。")).toBeTruthy();
    expect(screen.queryByText("不属于目标的指标")).toBeNull();
  });
  it("lists only scoped open actions, ordered by scheduled date with direct source links", async () => {
    const { context, goal, domain, show } = await setup();
    const action = { id: "scheduled", title: "已安排的行动", notes: "", domainId: domain.id, domainIds: [domain.id], goalId: goal.id,
      scheduledFor: "2020-01-02", status: "open", sortOrder: 0, completedAt: null, createdAt: "2020-01-01", updatedAt: "2020-01-01" };
    context.actionService = { list: async () => [
      { ...action, id: "unscheduled", title: "未安排的行动", scheduledFor: null }, action,
      { ...action, id: "completed", title: "已完成的行动", status: "completed" },
      { ...action, id: "unrelated", title: "无关行动", goalId: null },
    ] } as unknown as LifeOSContextValue["actionService"];
    show(createElement(ResourcesPage), "/resources?goal=" + goal.id);
    expect(await screen.findByRole("link", { name: "已安排的行动" })).toBeTruthy();
    expect(screen.getByText("尚未安排日期")).toBeTruthy();
    expect(screen.getByText("2020-01-02")).toBeTruthy();
    expect(screen.queryByText("已完成的行动")).toBeNull();
    expect(screen.queryByText("无关行动")).toBeNull();
    const links = Array.from(document.querySelectorAll('a[href^="/goals#action-"]'));
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/goals#action-scheduled", "/goals#action-unscheduled"]);
  });
  it("retries metric read errors without showing partial source facts", async () => {
    const { context, show } = await setup();
    context.domainMetricService.listRecords = async () => { throw new Error("指标记录暂时无法读取。"); };
    show(createElement(ResourcesPage), "/resources");
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "资源记录读取失败，请重试。");
    expect(screen.queryByRole("heading", { name: "资源总览" })).toBeNull();
    context.domainMetricService.listRecords = async () => [];
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("heading", { name: "资源总览" })).toBeTruthy();
    const summary = screen.getByRole("region", { name: "资源分类汇总" });
    expect(summary.querySelectorAll("li")).toHaveLength(6);
  });
  it("creates and edits decision needs even when there are no goals", async () => {
    const { decisions, context, show, resourceService } = await setup();
    const d = { id: "owned", title: "独立选择", decidedOn: "2026-10-12", importance: "ordinary" as const, status: "considering" as const,
      background: "", options: "", constraints: "", criteria: "", risks: "", opportunityCost: "", reversibility: "unknown" as const,
      choice: "", rationale: "", executionConditions: "", outcome: "", reflection: "", domainIds: [], goalId: null,
      createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() };
    await decisions.create(d);
    context.decisionService = { list: () => decisions.list() } as LifeOSContextValue["decisionService"];
    context.goalService = { list: async () => [] } as unknown as LifeOSContextValue["goalService"];
    show(createElement(ResourcesPage), "/resources?decision=owned");
    fireEvent.click(await screen.findByRole("button", { name: "记录决策需求" }));
    expect(screen.getByRole("region", { name: "决策资源需求" }).querySelector("select[disabled]")).toBeNull();
    fireEvent.change(screen.getByLabelText("决策需要什么"), { target: { value: "安排讨论时间" } });
    fireEvent.click(screen.getByRole("button", { name: "保存需求" }));
    expect(await screen.findByText("安排讨论时间")).toBeTruthy();
    expect((await resourceService.list())[0]).toMatchObject({ goalId: null, decisionId: "owned" });
    fireEvent.click(await screen.findByRole("button", { name: "编辑资源需求：安排讨论时间" }));
    fireEvent.change(screen.getByLabelText("决策需要什么"), { target: { value: "安排两小时讨论" } });
    fireEvent.click(screen.getByRole("button", { name: "保存需求" }));
    expect(await screen.findByText("安排两小时讨论")).toBeTruthy();
    expect((await resourceService.list())[0]).toMatchObject({ goalId: null, decisionId: "owned" });
    fireEvent.click(await screen.findByRole("checkbox", { name: "待补齐 · 时间" }));
    await waitFor(async () => expect((await resourceService.list())[0].met).toBe(true));
    expect(await screen.findByText("已记录 1 项 · 已具备 1 项 · 待补齐 0 项")).toBeTruthy();
  });
  it("filters decision references without importing unrelated goal needs and updates shared gaps", async () => {
    const { context, goal, show, resourceService } = await setup();
    const missing = await resourceService.save({ goalId: goal.id, kind: "time", description: "安排两小时",
      skillId: null, personId: null, met: false });
    const met = await resourceService.save({ goalId: goal.id, kind: "tool", description: "已有电脑",
      skillId: null, personId: null, met: true });
    await resourceService.save({ goalId: goal.id, kind: "finance", description: "无关预算",
      skillId: null, personId: null, met: false });
    context.decisionService = { list: async () => [{ id: "d", title: "选择学习方式", domainIds: [],
      goalId: null, resourceNeedIds: [missing.id, met.id] }] } as unknown as LifeOSContextValue["decisionService"];
    show(createElement(ResourcesPage), "/resources?decision=d&status=gap");
    expect(await screen.findByRole("heading", { name: "决策需要的资源" })).toBeTruthy();
    expect(screen.getByText("安排两小时")).toBeTruthy();
    expect(screen.queryByText("已有电脑")).toBeNull();
    expect(screen.queryByText("无关预算")).toBeNull();
    expect(screen.getByText("已记录 2 项 · 已具备 1 项 · 待补齐 1 项")).toBeTruthy();
    expect(screen.getByRole("link", { name: "返回决策：选择学习方式" }).getAttribute("href")).toBe("/decisions#decision-d");
    fireEvent.click(screen.getByRole("checkbox", { name: "待补齐 · 时间" }));
    expect(await screen.findByText("当前已记录的需求均已具备。")).toBeTruthy();
    expect((await resourceService.list()).find((item) => item.id === missing.id)?.met).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "仅看待补齐" }));
    expect(await screen.findByText("已有电脑")).toBeTruthy();
    expect(screen.getByText("安排两小时")).toBeTruthy();
    expect(screen.queryByText("无关预算")).toBeNull();
  });
  it("shows an invalid decision context and clears it without silently broadening the view", async () => {
    const { show } = await setup();
    show(createElement(ResourcesPage), "/resources?decision=missing");
    expect(await screen.findByRole("heading", { name: "无法按当前条件查看资源" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "目标需要的资源" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
    expect(await screen.findByRole("heading", { name: "目标需要的资源" })).toBeTruthy();
  });
  it("selects a default goal when creating a resource need without filters", async () => {
    const { goal, show, resourceService } = await setup();
    show(createElement(ResourcesPage), "/resources");
    fireEvent.click(await screen.findByRole("button", { name: "记录目标需求" }));
    expect((screen.getAllByRole("combobox", { name: "目标" })[1] as HTMLSelectElement).value).toBe(goal.id);
    fireEvent.change(screen.getByRole("textbox", { name: "目标需要什么" }),
      { target: { value: "每周一小时" } });
    fireEvent.click(screen.getByRole("button", { name: "保存需求" }));
    await waitFor(async () => expect((await resourceService.list())[0]).toMatchObject({ goalId: goal.id }));
    expect(await screen.findByText("每周一小时")).toBeTruthy();
  });

  it("hides archived references on creation and retains the existing reference when editing", async () => {
    const { goal, show, resourceService, lifeRecordsService } = await setup();
    const person = await lifeRecordsService.savePerson({ name: "原协作者", relationshipType: "", state: "",
      importantDate: null, lastContact: null, sharedExperiences: "", notes: "", domainIds: [] });
    await resourceService.save({ goalId: goal.id, kind: "person", description: "协作支持",
      personId: person.id, skillId: null, met: false });
    await lifeRecordsService.setArchived("people", person.id, true);
    show(createElement(ResourcesPage), "/resources");
    fireEvent.click(await screen.findByRole("button", { name: "记录目标需求" }));
    fireEvent.change(screen.getByRole("combobox", { name: "资源类型" }), { target: { value: "person" } });
    expect(screen.queryByRole("option", { name: "原协作者（已归档）" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑资源需求：协作支持" }));
    expect((screen.getByRole("combobox", { name: "引用已有人物" }) as HTMLSelectElement).value).toBe(person.id);
    expect(screen.getByRole("option", { name: "原协作者（已归档）" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存需求" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "保存需求" })).toBeNull());
    expect((await resourceService.list())[0].personId).toBe(person.id);
  });
  it("keeps navigation available when opening an on-demand M7 page or a direct link", async () => {
    const { domain, goal, show } = await setup();
    const page = show(createElement(AppRouter), "/more");
    fireEvent.click(await screen.findByRole("link", { name: "系统成效评估" }, { timeout: 5000 }));
    expect(await screen.findByRole("heading", { name: "系统成效评估" }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "主导航" })).toBeTruthy();
    page.unmount();
    show(createElement(AppRouter), `/resources?domain=${domain.id}&goal=${goal.id}`);
    expect(await screen.findByRole("heading", { name: "资源总览" }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "目标" })).toHaveProperty("value", goal.id);
  });

  it("creates, filters, archives and restores an important person", async () => {
    const { domain, show, lifeRecordsService } = await setup();
    show(createElement(PeoplePage), `/people?domain=${domain.id}`);
    fireEvent.click(await screen.findByRole("button", { name: "新增人物" }));
    expect((screen.getByRole("checkbox", { name: "健康" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "名称" }),
      { target: { value: "老朋友" } });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    expect(await screen.findByRole("heading", { name: "老朋友" })).toBeTruthy();
    expect((await lifeRecordsService.listPeople())[0].domainIds).toEqual([domain.id]);
    fireEvent.click(screen.getByRole("button", { name: "归档人物" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "老朋友" })).toBeNull());
    fireEvent.click(screen.getByRole("checkbox", { name: "显示归档" }));
    expect(await screen.findByRole("heading", { name: "老朋友" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "恢复人物" }));
    await waitFor(async () => expect((await lifeRecordsService.listPeople())[0].archived).toBe(false));
  });

  it("adds a dated event and exposes other life timeline nodes", async () => {
    const { domain, goal, show, lifeRecordsService } = await setup();
    show(createElement(TimelinePage), `/timeline?domain=${domain.id}`);
    fireEvent.click(await screen.findByRole("button", { name: "新增重要事件" }));
    fireEvent.change(screen.getByRole("textbox", { name: "事件标题" }),
      { target: { value: "新的开始" } });
    fireEvent.change(screen.getByLabelText("发生日期"),
      { target: { value: "2026-09-28" } });
    fireEvent.click(screen.getByText("关联人物与目标"));
    fireEvent.change(screen.getByRole("combobox", { name: "关联目标" }),
      { target: { value: goal.id } });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    expect(await screen.findByRole("heading", { name: "新的开始" })).toBeTruthy();
    expect((await lifeRecordsService.listEvents())[0]).toMatchObject({
      goalId: goal.id, domainIds: [domain.id],
    });
    expect(screen.getByRole("heading", { name: "其他人生节点" })).toBeTruthy();
  });

  it("records a goal need and a quarterly assessment without a system score", async () => {
    const { domain, goal, show, resourceService, systemAssessmentService } = await setup();
    const page = show(createElement(ResourcesPage), `/resources?domain=${domain.id}&goal=${goal.id}`);
    fireEvent.click(await screen.findByRole("button", { name: "记录目标需求" }));
    fireEvent.change(screen.getByRole("textbox", { name: "目标需要什么" }),
      { target: { value: "每周留出空闲" } });
    fireEvent.click(screen.getByRole("button", { name: "保存需求" }));
    await waitFor(async () => expect(await resourceService.list()).toHaveLength(1));
    expect(await screen.findByText("每周留出空闲")).toBeTruthy();
    page.unmount();
    show(createElement(SystemAssessmentPage), "/assessment");
    fireEvent.change(await screen.findByRole("combobox", { name: "周期" }),
      { target: { value: "quarter" } });
    await waitFor(() => expect(screen.getByLabelText("所在月份").matches(":disabled")).toBe(false));
    fireEvent.change(screen.getByLabelText("所在月份"),
      { target: { value: "2026-09" } });
    expect(await screen.findByRole("heading", { name: "2026-07 · 季度回看" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "保存本期评估" }).matches(":disabled")).toBe(false));
    fireEvent.change(screen.getByRole("textbox", { name: "更清楚当前状态" }),
      { target: { value: "了解现状" } });
    fireEvent.click(screen.getByRole("button", { name: "保存本期评估" }));
    await waitFor(async () => expect((await systemAssessmentService.list())[0])
      .toMatchObject({ periodStart: "2026-07-01", clarity: "了解现状" }));
  });

  it("does not widen missing domain or goal filters to all records", async () => {
    const { domain, show, lifeRecordsService } = await setup();
    await lifeRecordsService.savePerson({ name: "私密人物", relationshipType: "",
      state: "", importantDate: null, lastContact: null, sharedExperiences: "",
      notes: "", domainIds: [domain.id] });
    const page = show(createElement(PeoplePage), "/people?domain=missing");
    expect(await screen.findByRole("heading", { name: "无法按当前领域查看人物" })).toBeTruthy();
    expect(screen.queryByText("私密人物")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
    expect(await screen.findByText("私密人物")).toBeTruthy();
    page.unmount();
    show(createElement(ResourcesPage), `/resources?domain=${domain.id}&goal=missing`);
    expect(await screen.findByRole("heading", { name: "无法按当前条件查看资源" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
    expect(await screen.findByRole("heading", { name: "资源总览" })).toBeTruthy();
  });

  it("keeps goal resource summaries limited to linked records, including explicit references", async () => {
    const { domain, goal, show, lifeRecordsService, resourceService } = await setup();
    const related = await lifeRecordsService.savePerson({ name: "协作者", relationshipType: "",
      state: "", importantDate: null, lastContact: null, sharedExperiences: "",
      notes: "", domainIds: [] });
    await lifeRecordsService.savePerson({ name: "无关人物", relationshipType: "",
      state: "", importantDate: null, lastContact: null, sharedExperiences: "",
      notes: "", domainIds: [domain.id] });
    const skill = await lifeRecordsService.saveSkill({ name: "沟通能力", currentLevel: 1,
      targetLevel: 3, learningPath: "", practice: "", reflection: "",
      goalId: null, domainIds: [] });
    await resourceService.save({ goalId: goal.id, kind: "person",
      description: "需要协作", personId: related.id, skillId: null, met: false });
    await resourceService.save({ goalId: goal.id, kind: "skill",
      description: "需要沟通", personId: null, skillId: skill.id, met: false });
    show(createElement(ResourcesPage), `/resources?domain=${domain.id}&goal=${goal.id}`);
    expect(await screen.findByRole("link", { name: "协作者" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "沟通能力" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "无关人物" })).toBeNull();
  });
});
