import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { DomainEditorDialog } from "../../src/components/DomainEditorDialog";
import { DomainMetricsSection } from "../../src/components/DomainMetricsSection";
import { MetricValidationError, normalizeMetricRecord, type MetricDefinition,
  type MetricRecord } from "../../src/domain/life/DomainMetric";
import { IdentityRoleValidationError, normalizeIdentityRoleDraft,
  type IdentityRole } from "../../src/domain/life/IdentityRole";
import { LifeDomainValidationError, type LifeDomain } from "../../src/domain/life/LifeDomain";
import { NavigationValidationError, normalizeNavigationDraft,
  type LifeNavigation } from "../../src/domain/life/LifeNavigation";
import type { Goal } from "../../src/domain/planning/Goal";
import { IdentityRolesPage } from "../../src/pages/IdentityRolesPage";
import { LifeNavigationPage } from "../../src/pages/LifeNavigationPage";
import { DomainContextPage } from "../../src/pages/DomainContextPage";

afterEach(cleanup);
const stamp = "2026-10-22T08:00:00.000Z";
const domain: LifeDomain = { id: "health", name: "健康", description: "", focus: "",
  currentState: "", longTermExpectation: "自在活动", color: "fern", icon: "heart",
  status: "active", sortOrder: 0, createdAt: stamp, updatedAt: stamp };
const second: LifeDomain = { ...domain, id: "work", name: "事业", sortOrder: 1 };
const definition: MetricDefinition = { id: "m", name: "睡眠", unit: "小时",
  domainIds: [domain.id], archived: false, createdAt: stamp };
const record: MetricRecord = { id: "r", metricId: "m", recordedOn: "2026-10-22",
  value: 0, note: "", createdAt: stamp, updatedAt: stamp };
const navigation: LifeNavigation = { id: "nav", kind: "vision", title: "长期方向",
  description: "原内容", archivedAt: null, createdAt: stamp, updatedAt: stamp };
const role: IdentityRole = { id: "role", name: "学习者", description: "原说明",
  active: true, privacyLevel: "private", domainIds: [domain.id], goalIds: ["g"],
  archivedAt: null, deletedAt: null, version: 1, createdAt: stamp, updatedAt: stamp };
const goal = { id: "g", title: "原目标", status: "archived", domainId: domain.id, domainIds: [domain.id] } as Goal;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function context() {
  const listDomains = vi.fn<LifeOSContextValue["lifeDomainService"]["list"]>(async () => [domain, second]);
  const createDomain = vi.fn<LifeOSContextValue["lifeDomainService"]["create"]>(async draft => ({ ...domain, ...draft }));
  const updateDomain = vi.fn<LifeOSContextValue["lifeDomainService"]["update"]>(async (id, draft) => ({ ...domain, ...draft, id }));
  const listDefinitions = vi.fn<LifeOSContextValue["domainMetricService"]["listDefinitions"]>(async () => [definition]);
  const listSatisfactionLinks = vi.fn<LifeOSContextValue["domainMetricService"]["listSatisfactionLinks"]>(async () => []);
  const listRecords = vi.fn<LifeOSContextValue["domainMetricService"]["listRecords"]>(async () => [record]);
  const createDefinition = vi.fn<LifeOSContextValue["domainMetricService"]["createDefinition"]>(
    async (name, unit, domainIds) => ({ ...definition, name, unit, domainIds }));
  const saveRecord = vi.fn<LifeOSContextValue["domainMetricService"]["saveRecord"]>(
    async (metricId, recordedOn, value, note, id) => ({ ...record, id: id ?? record.id, metricId, recordedOn, value, note }));
  const archiveMetric = vi.fn<LifeOSContextValue["domainMetricService"]["setArchived"]>(async () => {});
  const listNavigation = vi.fn<LifeOSContextValue["lifeNavigationService"]["list"]>(async () => [navigation]);
  const createNavigation = vi.fn<LifeOSContextValue["lifeNavigationService"]["create"]>(
    async (kind, draft) => ({ ...navigation, ...draft, kind, id: "new-nav" }));
  const updateNavigation = vi.fn<LifeOSContextValue["lifeNavigationService"]["update"]>(
    async (id, draft) => ({ ...navigation, ...draft, id }));
  const archiveNavigation = vi.fn<LifeOSContextValue["lifeNavigationService"]["setArchived"]>(
    async (id, archived) => ({ ...navigation, id, archivedAt: archived ? stamp : null }));
  const listRoles = vi.fn<LifeOSContextValue["identityRoleService"]["list"]>(async () => [role]);
  const createRole = vi.fn<LifeOSContextValue["identityRoleService"]["create"]>(
    async draft => ({ ...role, ...draft, id: "new-role" }));
  const updateRole = vi.fn<LifeOSContextValue["identityRoleService"]["update"]>(
    async (id, draft) => ({ ...role, ...draft, id, version: 2 }));
  const archiveRole = vi.fn<LifeOSContextValue["identityRoleService"]["setArchived"]>(
    async (id, archived) => ({ ...role, id, archivedAt: archived ? stamp : null }));
  const app = {
    lifeDomainService: { list: listDomains, create: createDomain, update: updateDomain,
      findById: async (id: string) => [domain, second].find(item => item.id === id) ?? null },
    domainMetricService: { listDefinitions, listRecords, listSatisfactionLinks,
      setSatisfactionMetric: vi.fn(async () => {}), createDefinition, saveRecord, setArchived: archiveMetric },
    lifeNavigationService: { list: listNavigation, create: createNavigation, update: updateNavigation, setArchived: archiveNavigation },
    identityRoleService: { list: listRoles, create: createRole, update: updateRole, setArchived: archiveRole },
    goalService: { list: async () => [goal] },
    actionService: { list: async () => [] },
    reviewService: { list: async () => [] },
    issueService: { list: async () => [] },
    decisionService: { list: async () => [] },
    habitService: { list: async () => [] },
    lifeRecordsService: { listPeople: async () => [], listEvents: async () => [], listSkills: async () => [] },
  } as unknown as LifeOSContextValue;
  return { app, listDomains, createDomain, updateDomain, listDefinitions, listRecords,
    createDefinition, saveRecord, archiveMetric, listNavigation, createNavigation,
    updateNavigation, archiveNavigation, listRoles, createRole, updateRole, archiveRole };
}

function Frame({ app, children }: { app: LifeOSContextValue; children: ReactNode }) {
  return <MemoryRouter initialEntries={["/roles?domainId=health"]}>
    <LifeOSContext.Provider value={app}>{children}<Link to="/roles?domainId=work">切换角色上下文</Link></LifeOSContext.Provider>
  </MemoryRouter>;
}
function show(app: LifeOSContextValue, content: ReactNode) {
  return render(<Frame app={app}>{content}</Frame>);
}

describe("V1 domain dialog save lifecycle", () => {
  it("locks every field and dismissal, sanitizes storage failures and retains exact text for retry", async () => {
    const { app, createDomain } = context();
    const request = deferred<LifeDomain>();
    createDomain.mockReturnValueOnce(request.promise);
    const onClose = vi.fn(), onSaved = vi.fn();
    show(app, <DomainEditorDialog onClose={onClose} onSaved={onSaved} />);
    const dialog = screen.getByRole("dialog");
    const name = screen.getByLabelText("领域名称");
    fireEvent.change(name, { target: { value: " 自己的领域 " } });
    fireEvent.change(screen.getByLabelText("长期期待"), { target: { value: " 原文\n保留 " } });
    fireEvent.submit(dialog.querySelector("form")!);
    fireEvent.submit(dialog.querySelector("form")!);
    for (const field of dialog.querySelectorAll("input, textarea, select, button")) {
      expect(field.matches(":disabled")).toBe(true);
    }
    fireEvent.change(name, { target: { value: "不能替换" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(onClose).not.toHaveBeenCalled();
    expect(createDomain).toHaveBeenCalledTimes(1);
    expect(createDomain.mock.calls[0][0]).toMatchObject({ name: " 自己的领域 ", longTermExpectation: " 原文\n保留 " });
    await act(async () => request.reject("SQLITE_BUSY C:\\private\\db"));
    expect((await screen.findByRole("alert")).textContent).toBe("保存领域失败，请重试。");
    expect(name).toHaveProperty("value", " 自己的领域 ");
    expect(screen.getByLabelText("长期期待")).toHaveProperty("value", " 原文\n保留 ");
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(createDomain).toHaveBeenCalledTimes(2);
  });

  it("keeps actionable domain validation", async () => {
    const { app, updateDomain } = context();
    updateDomain.mockRejectedValueOnce(new LifeDomainValidationError("领域已经不存在，请重新读取。"));
    show(app, <DomainEditorDialog domain={domain} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect((await screen.findByRole("alert")).textContent).toBe("领域已经不存在，请重新读取。");
  });

  it("anchors the original domain identity but uses the current parent save callback", async () => {
    const { app, updateDomain } = context();
    const request = deferred<LifeDomain>();
    updateDomain.mockReturnValueOnce(request.promise);
    const original = vi.fn(), latest = vi.fn(), onClose = vi.fn();
    const page = show(app, <DomainEditorDialog domain={domain} onClose={onClose} onSaved={original} />);
    page.rerender(<Frame app={app}><DomainEditorDialog domain={second} onClose={onClose} onSaved={original} /></Frame>);
    fireEvent.change(screen.getByLabelText("当前状态"), { target: { value: "原领域的草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(updateDomain).toHaveBeenCalledWith(domain.id, expect.objectContaining({ name: domain.name, currentState: "原领域的草稿" }));
    page.rerender(<Frame app={app}><DomainEditorDialog domain={second} onClose={onClose} onSaved={latest} /></Frame>);
    await act(async () => request.resolve({ ...domain, currentState: "原领域的草稿" }));
    expect(original).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith({ ...domain, currentState: "原领域的草稿" });
  });

  for (const editing of [false, true]) for (const outcome of ["success", "failure"] as const) {
    it(`ignores late ${editing ? "update" : "create"} ${outcome} after dialog unmount`, async () => {
      const { app, createDomain, updateDomain } = context();
      const request = deferred<LifeDomain>();
      (editing ? updateDomain : createDomain).mockReturnValueOnce(request.promise);
      const onSaved = vi.fn(), onClose = vi.fn();
      const page = show(app, <DomainEditorDialog domain={editing ? domain : undefined} onClose={onClose} onSaved={onSaved} />);
      if (!editing) {
        fireEvent.change(screen.getByLabelText("领域名称"), { target: { value: "健康" } });
        fireEvent.change(screen.getByLabelText("长期期待"), { target: { value: "自在活动" } });
      }
      fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
      page.unmount();
      await act(async () => {
        if (outcome === "success") request.resolve(domain);
        else request.reject(new Error("private database"));
      });
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
  }
});

function DomainFrame({ app }: { app: LifeOSContextValue }) {
  return <MemoryRouter initialEntries={["/domains/health"]}>
    <LifeOSContext.Provider value={app}>
      <Link to="/domains/work">切换领域上下文</Link>
      <Routes><Route path="/domains/:domainId" element={<DomainContextPage />} /></Routes>
    </LifeOSContext.Provider>
  </MemoryRouter>;
}

describe("V1 domain context ownership and reads", () => {
  it("immediately hides old hub facts on source replacement and retries a domain draft only against its original service", async () => {
    const { app, updateDomain } = context();
    updateDomain.mockRejectedValueOnce("original database locked");
    const page = render(<DomainFrame app={app} />);
    await screen.findByRole("heading", { name: "健康", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "编辑领域" }));
    fireEvent.change(screen.getByLabelText("当前状态"), { target: { value: "原领域原文" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await screen.findByText("保存领域失败，请重试。");
    const pending = deferred<LifeDomain | null>();
    const replacementWrite = vi.fn();
    const findById = vi.fn(async () => pending.promise);
    const changed = { ...app, lifeDomainService: { ...app.lifeDomainService,
      findById, update: replacementWrite } };
    page.rerender(<DomainFrame app={changed} />);
    expect(screen.queryByRole("heading", { name: "健康", level: 1 })).toBeNull();
    expect(screen.queryByText("自在活动", { selector: ".context-body" })).toBeNull();
    expect(screen.getByLabelText("当前状态")).toHaveProperty("value", "原领域原文");
    await act(async () => pending.resolve({ ...domain, name: "替换来源", currentState: "新来源内容" }));
    await screen.findByRole("heading", { name: "替换来源", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(updateDomain).toHaveBeenCalledTimes(2);
    expect(replacementWrite).not.toHaveBeenCalled();
    expect(findById).toHaveBeenCalledTimes(1);
    expect(screen.getByText("新来源内容")).toBeTruthy();
    expect(screen.queryByText("原领域原文")).toBeNull();
  });

  for (const editor of ["metric", "satisfaction"] as const) {
    it(`retains the ${editor} editor across hub loading/failure/retry and keeps its original metric service`, async () => {
      const { app, createDefinition } = context();
      const page = render(<DomainFrame app={app} />);
      const button = editor === "metric" ? "添加指标" : "设置满意度指标";
      fireEvent.click(await screen.findByRole("button", { name: button }));
      const field = screen.getByLabelText(editor === "metric" ? "指标名称" : "评分指标");
      fireEvent.change(field, { target: { value: editor === "metric" ? "原指标草稿" : definition.id } });
      if (editor === "metric") fireEvent.change(screen.getByLabelText("计量单位"), { target: { value: "自定义" } });
      const findById = vi.fn<LifeOSContextValue["lifeDomainService"]["findById"]>()
        .mockRejectedValueOnce("database path").mockResolvedValue(domain);
      const replacementCreate = vi.fn();
      const replacementSatisfaction = vi.fn();
      const changed = { ...app,
        lifeDomainService: { ...app.lifeDomainService, findById },
        domainMetricService: { ...app.domainMetricService, createDefinition: replacementCreate,
          setSatisfactionMetric: replacementSatisfaction },
      };
      page.rerender(<DomainFrame app={changed} />);
      expect(screen.getByLabelText(editor === "metric" ? "指标名称" : "评分指标")).toBe(field);
      await screen.findByText("领域上下文读取失败，请重试。");
      expect(field).toHaveProperty("value", editor === "metric" ? "原指标草稿" : definition.id);
      fireEvent.click(screen.getByRole("button", { name: "重试" }));
      await screen.findByRole("heading", { name: "健康", level: 1 });
      expect(screen.getByLabelText(editor === "metric" ? "指标名称" : "评分指标")).toBe(field);
      fireEvent.click(screen.getByRole("button", { name: editor === "metric" ? "创建指标" : "保存设置" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      if (editor === "metric") {
        expect(createDefinition).toHaveBeenCalledExactlyOnceWith("原指标草稿", "自定义", [domain.id]);
      } else {
        expect(app.domainMetricService.setSatisfactionMetric).toHaveBeenCalledExactlyOnceWith(domain.id, definition.id);
      }
      expect(replacementCreate).not.toHaveBeenCalled();
      expect(replacementSatisfaction).not.toHaveBeenCalled();
    });
  }

  it("preserves the original editor through a route switch and never replaces the new domain with a late save", async () => {
    const { app, updateDomain } = context();
    const request = deferred<LifeDomain>();
    updateDomain.mockReturnValueOnce(request.promise);
    render(<DomainFrame app={app} />);
    await screen.findByRole("heading", { name: "健康", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "编辑领域" }));
    const text = screen.getByLabelText("当前状态");
    fireEvent.change(text, { target: { value: "健康领域的原草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    fireEvent.click(screen.getByRole("link", { name: "切换领域上下文" }));
    await screen.findByRole("heading", { name: "事业", level: 1 });
    expect(screen.getByLabelText("当前状态")).toBe(text);
    expect(text).toHaveProperty("value", "健康领域的原草稿");
    await act(async () => request.resolve({ ...domain, currentState: "健康领域的原草稿" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("heading", { name: "事业", level: 1 })).toBeTruthy();
    expect(screen.queryByText("健康领域的原草稿")).toBeNull();
    expect(updateDomain).toHaveBeenCalledExactlyOnceWith(domain.id,
      expect.objectContaining({ currentState: "健康领域的原草稿" }));
  });

  it("drops an old route read, sanitizes the new failure, and retains a mounted editor across retry", async () => {
    const { app } = context();
    const view = render(<DomainFrame app={app} />);
    await screen.findByRole("heading", { name: "健康", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "编辑领域" }));
    const text = screen.getByLabelText("当前状态");
    fireEvent.change(text, { target: { value: "重读保留" } });
    const old = deferred<LifeDomain | null>();
    const findById = vi.fn<LifeOSContextValue["lifeDomainService"]["findById"]>()
      .mockReturnValueOnce(old.promise).mockRejectedValueOnce("C:\\private\\db").mockResolvedValue(second);
    const changed = { ...app, lifeDomainService: { ...app.lifeDomainService, findById } };
    view.rerender(<DomainFrame app={changed} />);
    await waitFor(() => expect(findById).toHaveBeenCalledWith("health"));
    fireEvent.click(screen.getByRole("link", { name: "切换领域上下文" }));
    expect((await screen.findByRole("alert")).textContent).toBe("领域上下文读取失败，请重试。");
    expect(screen.getByLabelText("当前状态")).toBe(text);
    await act(async () => old.resolve(domain));
    expect(screen.queryByRole("heading", { name: "健康", level: 1 })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("heading", { name: "事业", level: 1 });
    expect(screen.getByLabelText("当前状态")).toBe(text);
    expect(text).toHaveProperty("value", "重读保留");
  });
});

describe("V1 metric save and reread lifecycle", () => {
  it("locks the editor and competing actions, preserves raw draft after failure, and retries", async () => {
    const { app, createDefinition } = context();
    const request = deferred<MetricDefinition>();
    createDefinition.mockReturnValueOnce(request.promise);
    show(app, <DomainMetricsSection domain={domain} />);
    await screen.findByRole("heading", { name: "领域指标" });
    fireEvent.click(screen.getByText("查看记录 (1)"));
    fireEvent.click(await screen.findByRole("button", { name: "添加指标" }));
    const dialog = screen.getByRole("dialog");
    const name = screen.getByLabelText("指标名称");
    fireEvent.change(name, { target: { value: " 原指标 " } });
    fireEvent.change(screen.getByLabelText("计量单位"), { target: { value: " 小时 " } });
    fireEvent.submit(dialog.querySelector("form")!);
    fireEvent.submit(dialog.querySelector("form")!);
    fireEvent.change(name, { target: { value: "不能替换" } });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(name.matches(":disabled")).toBe(true);
    expect(screen.getByRole("checkbox", { name: "事业" }).matches(":disabled")).toBe(true);
    for (const label of ["添加指标", "记录", "归档睡眠", "更正睡眠 2026-10-22的记录"]) {
      expect(within(dialog.parentElement!.parentElement!).getByRole("button", { name: label }).matches(":disabled")).toBe(true);
    }
    expect(createDefinition).toHaveBeenCalledExactlyOnceWith(" 原指标 ", " 小时 ", [domain.id]);
    await act(async () => request.reject(new Error("C:\\private\\db")));
    expect((await screen.findByRole("alert")).textContent).toBe("保存指标失败，请重试。");
    expect(name).toHaveProperty("value", " 原指标 ");
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(createDefinition).toHaveBeenCalledTimes(2);
  });

  it("retains the same modal and original domain snapshot across failed and successful dependency rereads", async () => {
    const { app, listDefinitions, createDefinition } = context();
    const page = show(app, <DomainMetricsSection domain={domain} />);
    fireEvent.click(await screen.findByRole("button", { name: "添加指标" }));
    const name = screen.getByLabelText("指标名称");
    fireEvent.change(name, { target: { value: "重读草稿" } });
    fireEvent.change(screen.getByLabelText("计量单位"), { target: { value: "次" } });
    listDefinitions.mockRejectedValueOnce(new Error("private read"));
    const changed = { ...app, lifeDomainService: { ...app.lifeDomainService, list: async () => [second] } };
    page.rerender(<Frame app={changed}><DomainMetricsSection domain={second} /></Frame>);
    expect((await screen.findByRole("alert")).textContent).toBe("指标读取失败，请重试。");
    expect(screen.getByLabelText("指标名称")).toBe(name);
    expect(screen.getByRole("checkbox", { name: "健康" })).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("heading", { name: "领域指标" });
    expect(screen.getByLabelText("指标名称")).toBe(name);
    fireEvent.click(screen.getByRole("button", { name: "创建指标" }));
    await waitFor(() => expect(createDefinition).toHaveBeenCalledWith("重读草稿", "次", [domain.id]));
  });

  it("preserves zero in correction, retains duplicate-date feedback and retries the original record", async () => {
    const { app, saveRecord } = context();
    saveRecord.mockRejectedValueOnce(new MetricValidationError("这个日期已经有记录，请选择该条记录进行更正。"));
    show(app, <DomainMetricsSection domain={domain} />);
    await screen.findByRole("heading", { name: "领域指标" });
    fireEvent.click(screen.getByText("查看记录 (1)"));
    fireEvent.click(await screen.findByRole("button", { name: "更正睡眠 2026-10-22的记录" }));
    expect(screen.getByLabelText("数值 (小时)")).toHaveProperty("value", "0");
    fireEvent.click(screen.getByRole("button", { name: "保存更正" }));
    expect((await screen.findByRole("alert")).textContent).toContain("选择该条记录进行更正");
    fireEvent.click(screen.getByRole("button", { name: "保存更正" }));
    await waitFor(() => expect(saveRecord).toHaveBeenCalledTimes(2));
    expect(saveRecord.mock.calls[1]).toEqual(["m", "2026-10-22", 0, "", "r"]);
  });

  it("locks duplicate archive and new editors, sanitizes failure and retries", async () => {
    const { app, archiveMetric } = context();
    const request = deferred<void>();
    archiveMetric.mockReturnValueOnce(request.promise);
    show(app, <DomainMetricsSection domain={domain} />);
    const archive = await screen.findByRole("button", { name: "归档睡眠" });
    fireEvent.click(archive);
    fireEvent.click(archive);
    expect(screen.getByRole("button", { name: "添加指标" }).matches(":disabled")).toBe(true);
    expect(archiveMetric).toHaveBeenCalledExactlyOnceWith("m", true);
    await act(async () => request.reject("private path"));
    expect((await screen.findByRole("alert")).textContent).toBe("更新指标失败，请重试。");
    fireEvent.click(archive);
    await waitFor(() => expect(screen.getByRole("button", { name: "归档睡眠" }).matches(":disabled")).toBe(false));
    expect(archiveMetric).toHaveBeenCalledTimes(2);
  });

  it("ignores old metric reads after a newer source has loaded", async () => {
    const { app, listDefinitions } = context();
    const old = deferred<readonly MetricDefinition[]>();
    listDefinitions.mockReturnValueOnce(old.promise);
    const page = show(app, <DomainMetricsSection domain={domain} />);
    const changed = { ...app, domainMetricService: { ...app.domainMetricService,
      listDefinitions: async () => [{ ...definition, name: "新来源" }] } };
    page.rerender(<Frame app={changed}><DomainMetricsSection domain={domain} /></Frame>);
    await screen.findByRole("heading", { name: "新来源 (小时)" });
    await act(async () => old.resolve([{ ...definition, name: "旧来源" }]));
    expect(screen.queryByText("旧来源")).toBeNull();
    expect(screen.getByRole("heading", { name: "新来源 (小时)" })).toBeTruthy();
  });

  for (const action of ["create", "record", "archive"] as const) for (const outcome of ["success", "failure"] as const) {
    it(`does not reread after unmounted metric ${action} ${outcome}`, async () => {
      const { app, listDefinitions, createDefinition, saveRecord, archiveMetric } = context();
      const complete = deferred<MetricDefinition>();
      const recording = deferred<MetricRecord>();
      const archiving = deferred<void>();
      if (action === "create") createDefinition.mockReturnValueOnce(complete.promise);
      else if (action === "record") saveRecord.mockReturnValueOnce(recording.promise);
      else archiveMetric.mockReturnValueOnce(archiving.promise);
      const page = show(app, <DomainMetricsSection domain={domain} />);
      await screen.findByRole("heading", { name: "领域指标" });
      if (action === "create") {
        fireEvent.click(screen.getByRole("button", { name: "添加指标" }));
        fireEvent.change(screen.getByLabelText("指标名称"), { target: { value: "新指标" } });
        fireEvent.change(screen.getByLabelText("计量单位"), { target: { value: "次" } });
        fireEvent.click(screen.getByRole("button", { name: "创建指标" }));
      } else if (action === "record") {
        fireEvent.click(screen.getByText("查看记录 (1)"));
        fireEvent.click(screen.getByRole("button", { name: "更正睡眠 2026-10-22的记录" }));
        fireEvent.click(screen.getByRole("button", { name: "保存更正" }));
      } else fireEvent.click(screen.getByRole("button", { name: "归档睡眠" }));
      page.unmount();
      await act(async () => {
        if (outcome === "failure") {
          (action === "create" ? complete : action === "record" ? recording : archiving).reject(new Error("private"));
        } else if (action === "create") complete.resolve(definition);
        else if (action === "record") recording.resolve(record);
        else archiving.resolve();
      });
      expect(listDefinitions).toHaveBeenCalledTimes(1);
    });
  }
});

describe("V1 navigation and identity role lifecycle", () => {
  for (const kind of ["navigation", "role"] as const) {
    const page = kind === "navigation" ? <LifeNavigationPage /> : <IdentityRolesPage />;
    const editLabel = kind === "navigation" ? "编辑长期方向" : "编辑学习者";
    const textLabel = kind === "navigation" ? "内容" : "说明";
    const titleLabel = kind === "navigation" ? "标题" : "名称";

    it(`locks the full ${kind} edit and filters, preserves raw failed text and retries`, async () => {
      const app = context();
      const pendingNavigation = deferred<LifeNavigation>();
      const pendingRole = deferred<IdentityRole>();
      if (kind === "navigation") app.updateNavigation.mockReturnValueOnce(pendingNavigation.promise);
      else app.updateRole.mockReturnValueOnce(pendingRole.promise);
      show(app.app, page);
      fireEvent.click(await screen.findByRole("button", { name: editLabel }));
      const text = screen.getByLabelText(textLabel);
      fireEvent.change(text, { target: { value: " 原文\n保留 " } });
      const form = text.closest("form")!;
      fireEvent.submit(form); fireEvent.submit(form);
      fireEvent.change(text, { target: { value: "不能替换" } });
      fireEvent.keyDown(text, { key: "Escape" });
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      for (const field of form.querySelectorAll("input, textarea, select, button")) {
        expect(field.matches(":disabled")).toBe(true);
      }
      expect(screen.getByLabelText("显示已归档").matches(":disabled")).toBe(true);
      const write = kind === "navigation" ? app.updateNavigation : app.updateRole;
      expect(write).toHaveBeenCalledTimes(1);
      expect(write.mock.calls[0][1]).toMatchObject({ description: " 原文\n保留 " });
      await act(async () => (kind === "navigation" ? pendingNavigation : pendingRole).reject(new Error("private db")));
      expect((await screen.findByRole("alert")).textContent).toBe("保存失败，请重试。");
      expect(text).toHaveProperty("value", " 原文\n保留 ");
      fireEvent.submit(form);
      await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
      expect(write).toHaveBeenCalledTimes(2);
      expect(write.mock.calls[1][1]).toMatchObject({ description: " 原文\n保留 " });
      expect(document.activeElement).toBe(screen.getByRole("button", { name: editLabel }));
    });

    it(`keeps an edited ${kind} visible and its DOM stable when a reread removes the source row`, async () => {
      const app = context();
      const view = show(app.app, page);
      fireEvent.click(await screen.findByRole("button", { name: editLabel }));
      const text = screen.getByLabelText(textLabel);
      fireEvent.change(text, { target: { value: "原草稿" } });
      const changed = kind === "navigation"
        ? { ...app.app, lifeNavigationService: { ...app.app.lifeNavigationService, list: async () => [] } }
        : { ...app.app, identityRoleService: { ...app.app.identityRoleService, list: async () => [] },
          lifeDomainService: { ...app.app.lifeDomainService, list: async () => [second] },
          goalService: { ...app.app.goalService, list: async () => [] } };
      view.rerender(<Frame app={changed}>{page}</Frame>);
      if (kind === "role") fireEvent.click(screen.getByRole("link", { name: "切换角色上下文" }));
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByLabelText(textLabel)).toBe(text);
      expect(text).toHaveProperty("value", "原草稿");
      if (kind === "role") {
        fireEvent.click(screen.getByText("关联领域与目标"));
        expect(screen.getByLabelText("健康")).toHaveProperty("checked", true);
        expect(screen.getByLabelText("原目标（已归档）")).toHaveProperty("checked", true);
        expect(screen.getByLabelText("隐私级别")).toHaveProperty("value", "private");
      }
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      expect(screen.queryByLabelText(titleLabel)).toBeNull();
    });

    it(`sanitizes a ${kind} dependency failure and permits retry`, async () => {
      const app = context();
      (kind === "navigation" ? app.listNavigation : app.listRoles).mockRejectedValueOnce("C:\\private\\db");
      show(app.app, page);
      expect((await screen.findByRole("alert")).textContent).toContain(
        kind === "navigation" ? "人生导航读取失败，请重试。" : "身份角色读取失败，请重试。");
      fireEvent.click(screen.getByRole("button", { name: "重试" }));
      await screen.findByRole("button", { name: editLabel });
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it(`locks duplicate ${kind} archive and competing editors, preserving state after failure`, async () => {
      const app = context();
      const pendingNavigation = deferred<LifeNavigation>(), pendingRole = deferred<IdentityRole>();
      if (kind === "navigation") app.archiveNavigation.mockReturnValueOnce(pendingNavigation.promise);
      else app.archiveRole.mockReturnValueOnce(pendingRole.promise);
      show(app.app, page);
      const archive = await screen.findByRole("button", { name: kind === "navigation" ? "归档长期方向" : "归档学习者" });
      fireEvent.click(archive); fireEvent.click(archive);
      const write = kind === "navigation" ? app.archiveNavigation : app.archiveRole;
      expect(write).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: editLabel }).matches(":disabled")).toBe(true);
      expect(screen.getByLabelText("显示已归档").matches(":disabled")).toBe(true);
      await act(async () => (kind === "navigation" ? pendingNavigation : pendingRole).reject("private"));
      expect((await screen.findByRole("alert")).textContent).toBe("操作失败，请重试。");
      expect(screen.getByRole("button", { name: editLabel })).toBeTruthy();
      fireEvent.click(archive);
      await waitFor(() => expect(screen.queryByRole("button", { name: editLabel })).toBeNull());
      expect(write).toHaveBeenCalledTimes(2);
    });

    it(`rejects stale ${kind} reads that finish after a local save`, async () => {
      const app = context();
      const view = show(app.app, page);
      fireEvent.click(await screen.findByRole("button", { name: editLabel }));
      const pendingNavigation = deferred<readonly LifeNavigation[]>();
      const pendingRole = deferred<readonly IdentityRole[]>();
      const changed = kind === "navigation"
        ? { ...app.app, lifeNavigationService: { ...app.app.lifeNavigationService, list: () => pendingNavigation.promise } }
        : { ...app.app, identityRoleService: { ...app.app.identityRoleService, list: () => pendingRole.promise } };
      view.rerender(<Frame app={changed}>{page}</Frame>);
      fireEvent.change(screen.getByLabelText(textLabel), { target: { value: "新内容" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await screen.findByText("新内容");
      await act(async () => {
        if (kind === "navigation") pendingNavigation.resolve([{ ...navigation, description: "过期内容" }]);
        else pendingRole.resolve([{ ...role, description: "过期内容" }]);
      });
      expect(screen.queryByText("过期内容")).toBeNull();
      expect(screen.getByText("新内容")).toBeTruthy();
    });

    it(`preserves actionable ${kind} validation`, async () => {
      const app = context();
      if (kind === "navigation") app.updateNavigation.mockRejectedValueOnce(new NavigationValidationError("该导航已归档，请先恢复。"));
      else app.updateRole.mockRejectedValueOnce(new IdentityRoleValidationError("角色已归档，请先恢复。"));
      show(app.app, page);
      fireEvent.click(await screen.findByRole("button", { name: editLabel }));
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect((await screen.findByRole("alert")).textContent).toContain("已归档，请先恢复。");
    });

    for (const action of ["create", "update", "archive"] as const) for (const outcome of ["success", "failure"] as const) {
      it(`does not focus or reread after unmounted ${kind} ${action} ${outcome}`, async () => {
        const app = context();
        const pendingNavigation = deferred<LifeNavigation>(), pendingRole = deferred<IdentityRole>();
        if (kind === "navigation") {
          (action === "create" ? app.createNavigation : action === "update" ? app.updateNavigation : app.archiveNavigation)
            .mockReturnValueOnce(pendingNavigation.promise);
        } else {
          (action === "create" ? app.createRole : action === "update" ? app.updateRole : app.archiveRole)
            .mockReturnValueOnce(pendingRole.promise);
        }
        const view = show(app.app, page);
        await screen.findByRole("button", { name: editLabel });
        if (action === "archive") fireEvent.click(screen.getByRole("button", {
          name: kind === "navigation" ? "归档长期方向" : "归档学习者" }));
        else {
          fireEvent.click(screen.getByRole("button", { name: action === "create"
            ? kind === "navigation" ? "添加使命" : "添加身份角色" : editLabel }));
          if (action === "create") fireEvent.change(screen.getByLabelText(titleLabel), { target: { value: "新记录" } });
          fireEvent.submit(screen.getByLabelText(titleLabel).closest("form")!);
        }
        view.unmount();
        const focus = vi.spyOn(HTMLElement.prototype, "focus");
        await act(async () => {
          if (outcome === "failure") (kind === "navigation" ? pendingNavigation : pendingRole).reject(new Error("private"));
          else if (kind === "navigation") pendingNavigation.resolve(navigation);
          else pendingRole.resolve(role);
        });
        expect(focus).not.toHaveBeenCalled();
        focus.mockRestore();
        expect(kind === "navigation" ? app.listNavigation : app.listRoles).toHaveBeenCalledTimes(1);
      });
    }
  }

  it("types semantic errors without changing existing limits, valid zero or role privacy", () => {
    expect(() => normalizeNavigationDraft({ title: "", description: "" })).toThrow(NavigationValidationError);
    expect(() => normalizeIdentityRoleDraft({ ...role, goalIds: ["g", "g"] })).toThrow(IdentityRoleValidationError);
    expect(() => normalizeMetricRecord("2026-02-30", 0, "")).toThrow(MetricValidationError);
    expect(normalizeMetricRecord("2026-10-22", 0, "")).toMatchObject({ value: 0 });
    expect(normalizeIdentityRoleDraft(role)).toMatchObject({ privacyLevel: "private", domainIds: ["health"], goalIds: ["g"] });
  });
});
