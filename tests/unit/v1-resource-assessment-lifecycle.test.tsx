import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { AssessmentValidationError, normalizeAssessment, type AssessmentDraft,
  type SystemAssessment } from "../../src/domain/assessments/SystemAssessment";
import type { Goal } from "../../src/domain/planning/Goal";
import { ResourceValidationError, normalizeNeed, type ResourceNeed,
  type ResourceNeedDraft } from "../../src/domain/resources/Resources";
import { ResourcesPage } from "../../src/pages/ResourcesPage";
import { SystemAssessmentPage } from "../../src/pages/SystemAssessmentPage";

afterEach(cleanup);
const stamp = "2026-10-22T08:00:00.000Z";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function context() {
  const goal = { id: "g", title: "原目标", domainId: "health", domainIds: ["health"],
    status: "active", archived: false } as Goal;
  const need: ResourceNeed = { id: "n", goalId: "g", decisionId: null, kind: "time",
    description: "原需求", skillId: null, personId: null, met: false,
    createdAt: stamp, updatedAt: stamp };
  const needs = [need];
  const assessments: SystemAssessment[] = [];
  const listNeeds = vi.fn<LifeOSContextValue["resourceService"]["list"]>(async () => [...needs]);
  const listAssessments = vi.fn<LifeOSContextValue["systemAssessmentService"]["list"]>(async () => [...assessments]);
  const saveNeed = vi.fn(async (draft: ResourceNeedDraft, id?: string): Promise<ResourceNeed> =>
    ({ ...draft, decisionId: draft.decisionId ?? null, goalId: draft.goalId ?? null,
      id: id ?? "new", createdAt: stamp, updatedAt: stamp }));
  const saveAssessment = vi.fn(async (draft: AssessmentDraft): Promise<SystemAssessment> =>
    ({ ...draft, id: "a", createdAt: stamp, updatedAt: stamp }));
  const app = {
    lifeDomainService: { list: async () => [{ id: "health", name: "健康" }, { id: "work", name: "事业" }] },
    goalService: { list: async () => [goal, { ...goal, id: "g2", title: "其他目标", domainIds: ["work"] }] },
    actionService: { list: async () => [] },
    lifeRecordsService: { listPeople: async () => [], listSkills: async () => [] },
    domainMetricService: { listDefinitions: async () => [], listRecords: async () => [] },
    decisionService: { list: async () => [{ id: "d", title: "原决策", domainIds: ["health"],
      resourceNeedIds: ["n"] }] },
    reviewService: { list: async () => [] },
    issueService: { list: async () => [] },
    resourceService: { list: listNeeds, save: saveNeed },
    systemAssessmentService: { list: listAssessments, save: saveAssessment },
  } as unknown as LifeOSContextValue;
  return { app, goal, need, needs, assessments, listNeeds, saveNeed, listAssessments, saveAssessment };
}

function LocationProbe() {
  const { search, hash } = useLocation();
  return <span aria-label="测试地址">{search}{hash}</span>;
}

function Page({ app, kind }: { app: LifeOSContextValue; kind: "resources" | "assessment" }) {
  return <LifeOSContext.Provider value={app}>
    <Link to="/resources?domain=missing&goal=g&decision=d&status=gap&keep=1&keep=2#origin">测试失效入口</Link>
    <LocationProbe />
    {kind === "resources" ? <ResourcesPage /> : <SystemAssessmentPage />}
  </LifeOSContext.Provider>;
}

function show(app: LifeOSContextValue, kind: "resources" | "assessment", path = `/${kind}`) {
  return render(<MemoryRouter initialEntries={[path]}><Page app={app} kind={kind} /></MemoryRouter>);
}

describe("V1 resource drafts and saves", () => {
  it.each(["domain", "goal", "decision"])("does not expand an explicitly empty %s filter to global scope", async key => {
    const { app, saveNeed } = context();
    show(app, "resources", `/resources?${key}=&keep=1&keep=2#origin`);
    await screen.findByRole("heading", { name: "无法按当前条件查看资源" });
    expect(screen.queryByText("原需求")).toBeNull();
    expect(saveNeed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
    await screen.findByRole("heading", { name: "资源总览" });
    expect(screen.getByLabelText("测试地址").textContent).toBe("?keep=1&keep=2#origin");
  });

  it("immediately hides ready facts when their source changes", async () => {
    const { app, need } = context();
    const page = show(app, "resources");
    await screen.findByText("原需求");
    const pending = deferred<readonly ResourceNeed[]>();
    const changed = { ...app, resourceService: { ...app.resourceService, list: () => pending.promise } };
    page.rerender(<MemoryRouter><Page app={changed} kind="resources" /></MemoryRouter>);
    expect(screen.queryByText("原需求")).toBeNull();
    expect(screen.getByText("正在整理资源")).toBeTruthy();
    await act(async () => pending.resolve([{ ...need, description: "替换来源需求" }]));
    expect(await screen.findByText("替换来源需求")).toBeTruthy();
  });

  it("preserves the original editor service across replacement and retries only that service", async () => {
    const { app, saveNeed, listNeeds } = context();
    const page = show(app, "resources");
    fireEvent.click(await screen.findByRole("button", { name: "编辑资源需求：原需求" }));
    fireEvent.change(screen.getByRole("textbox", { name: "目标需要什么" }), { target: { value: "原来源草稿" } });
    const replacementSave = vi.fn();
    const replacementList = vi.fn(async () => []);
    const changed = { ...app, resourceService: { list: replacementList, save: replacementSave } } as unknown as LifeOSContextValue;
    page.rerender(<MemoryRouter><Page app={changed} kind="resources" /></MemoryRouter>);
    await screen.findByRole("heading", { name: "资源总览" });
    saveNeed.mockRejectedValueOnce(new Error("private database path"));
    fireEvent.click(screen.getByRole("button", { name: "保存需求" }));
    expect((await screen.findByRole("alert")).textContent).toBe("无法保存需求，请重试。");
    expect(screen.getByRole("textbox", { name: "目标需要什么" })).toHaveProperty("value", "原来源草稿");
    fireEvent.click(screen.getByRole("button", { name: "保存需求" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "保存需求" })).toBeNull());
    expect(saveNeed).toHaveBeenCalledTimes(2);
    expect(replacementSave).not.toHaveBeenCalled();
    expect(replacementList).toHaveBeenCalledOnce();
    expect(listNeeds).toHaveBeenCalledOnce();
  });

  it.each(["success", "failure"])("ignores an old status write after service replacement (%s)", async outcome => {
    const { app, saveNeed, need, listNeeds } = context();
    const pending = deferred<ResourceNeed>();
    saveNeed.mockReturnValueOnce(pending.promise);
    const page = show(app, "resources");
    fireEvent.click(await screen.findByRole("checkbox", { name: "待补齐 · 时间" }));
    const replacementList = vi.fn(async () => [{ ...need, description: "新来源需求" }]);
    const replacementSave = vi.fn();
    const changed = { ...app, resourceService: { list: replacementList, save: replacementSave } } as unknown as LifeOSContextValue;
    page.rerender(<MemoryRouter><Page app={changed} kind="resources" /></MemoryRouter>);
    await screen.findByText("新来源需求");
    await act(async () => {
      if (outcome === "success") pending.resolve({ ...need, met: true });
      else pending.reject(new Error("private old source"));
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("新来源需求")).toBeTruthy();
    expect(listNeeds).toHaveBeenCalledOnce();
    expect(replacementList).toHaveBeenCalledOnce();
    expect(replacementSave).not.toHaveBeenCalled();
  });

  it("locks filters, competing editors and the full form, retains exact failed text and retries once", async () => {
    const { app, need, listNeeds, saveNeed } = context();
    const request = deferred<ResourceNeed>();
    saveNeed.mockReturnValueOnce(request.promise);
    show(app, "resources");
    fireEvent.click(await screen.findByRole("button", { name: "编辑资源需求：原需求" }));
    const editor = within(screen.getByRole("region", { name: "目标资源需求" }));
    const text = editor.getByRole("textbox", { name: "目标需要什么" });
    fireEvent.change(text, { target: { value: " 原始草稿\n保留 " } });
    const save = editor.getByRole("button", { name: "保存需求" });
    fireEvent.submit(save.closest("form")!);
    fireEvent.submit(save.closest("form")!);
    fireEvent.change(text, { target: { value: "不能覆盖" } });
    fireEvent.click(editor.getByRole("button", { name: "取消" }));
    expect(saveNeed).toHaveBeenCalledExactlyOnceWith({ goalId: need.goalId,
      decisionId: null, kind: "time", skillId: null, personId: null, met: false,
      description: " 原始草稿\n保留 " }, need.id);
    expect(text.matches(":disabled")).toBe(true);
    expect(screen.getByRole("combobox", { name: "生活领域" }).matches(":disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "记录目标需求" }).matches(":disabled")).toBe(true);
    expect(screen.getByRole("checkbox", { name: "待补齐 · 时间" }).matches(":disabled")).toBe(true);
    await act(async () => request.reject(new Error("SQLITE_BUSY C:\\private\\db")));
    expect((await screen.findByRole("alert")).textContent).toBe("无法保存需求，请重试。");
    expect(text).toHaveProperty("value", " 原始草稿\n保留 ");
    expect(text.matches(":disabled")).toBe(false);
    fireEvent.submit(save.closest("form")!);
    await waitFor(() => expect(screen.queryByRole("button", { name: "保存需求" })).toBeNull());
    expect(saveNeed).toHaveBeenCalledTimes(2);
    expect(listNeeds).toHaveBeenCalledTimes(2);
  });

  it("keeps the same editor mounted across invalid same-page requests and selectively clears invalid filters", async () => {
    const { app, saveNeed } = context();
    show(app, "resources", "/resources?domain=health&goal=g");
    fireEvent.click(await screen.findByRole("button", { name: "记录目标需求" }));
    const text = screen.getByRole("textbox", { name: "目标需要什么" });
    fireEvent.change(text, { target: { value: "不能被链接替换" } });
    fireEvent.click(screen.getByRole("link", { name: "测试失效入口" }));
    await screen.findByRole("heading", { name: "无法按当前条件查看资源" });
    expect(screen.getByRole("textbox", { name: "目标需要什么" })).toBe(text);
    expect(text).toHaveProperty("value", "不能被链接替换");
    expect(screen.queryByRole("heading", { name: "目标需要的资源" })).toBeNull();
    expect(screen.getByRole("button", { name: "清除失效筛选" }).matches(":disabled")).toBe(true);
    expect(saveNeed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
    await screen.findByRole("heading", { name: "资源总览" });
    expect(screen.getByLabelText("测试地址").textContent).toBe("?goal=g&decision=d&status=gap&keep=1&keep=2#origin");
  });

  it("retains the mounted draft after a dependency reread failure, and retry does not replace it", async () => {
    const { app } = context();
    const page = show(app, "resources");
    fireEvent.click(await screen.findByRole("button", { name: "记录目标需求" }));
    const text = screen.getByRole("textbox", { name: "目标需要什么" });
    fireEvent.change(text, { target: { value: "重读仍保留" } });
    const read = vi.fn().mockRejectedValueOnce(new Error("private path")).mockResolvedValue([]);
    const changed = { ...app, domainMetricService: { ...app.domainMetricService, listRecords: read } };
    page.rerender(<MemoryRouter><Page app={changed} kind="resources" /></MemoryRouter>);
    await screen.findByRole("alert");
    expect(screen.getByRole("textbox", { name: "目标需要什么" })).toBe(text);
    expect(text).toHaveProperty("value", "重读仍保留");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("heading", { name: "资源总览" });
    expect(screen.getByRole("textbox", { name: "目标需要什么" })).toBe(text);
  });

  it("changes only the selected filter, retaining decision intersections, status, duplicate parameters and hash", async () => {
    const { app } = context();
    show(app, "resources", "/resources?domain=health&decision=d&status=gap&keep=1&keep=2#origin");
    fireEvent.change(await screen.findByRole("combobox", { name: "目标" }), { target: { value: "g" } });
    expect(screen.getByLabelText("测试地址").textContent)
      .toBe("?domain=health&decision=d&status=gap&keep=1&keep=2&goal=g#origin");
    fireEvent.change(screen.getByRole("combobox", { name: "生活领域" }), { target: { value: "work" } });
    expect(screen.getByLabelText("测试地址").textContent).toBe("?domain=work&status=gap&keep=1&keep=2#origin");
  });

  it("prevents duplicate status writes, sanitizes failures and keeps the original state for retry", async () => {
    const { app, saveNeed, listNeeds } = context();
    const request = deferred<ResourceNeed>();
    saveNeed.mockReturnValueOnce(request.promise);
    show(app, "resources");
    const checkbox = await screen.findByRole("checkbox", { name: "待补齐 · 时间" });
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    expect(saveNeed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "记录目标需求" }).matches(":disabled")).toBe(true);
    await act(async () => request.reject(new Error("private database path")));
    expect((await screen.findByRole("alert")).textContent).toBe("更新需求失败，请重试。");
    expect(checkbox).toHaveProperty("checked", false);
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox.matches(":disabled")).toBe(false));
    expect(saveNeed).toHaveBeenCalledTimes(2);
    expect(checkbox).toHaveProperty("checked", true);
    expect(listNeeds).toHaveBeenCalledOnce();
  });

  it("shows actionable semantic validation without exposing storage errors", async () => {
    const { app, saveNeed } = context();
    saveNeed.mockRejectedValueOnce(new ResourceValidationError("该目标已不存在。"));
    show(app, "resources");
    fireEvent.click(await screen.findByRole("button", { name: "记录目标需求" }));
    fireEvent.change(screen.getByRole("textbox", { name: "目标需要什么" }), { target: { value: "已有草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存需求" }));
    expect((await screen.findByRole("alert")).textContent).toBe("该目标已不存在。");
    expect(screen.getByRole("textbox", { name: "目标需要什么" })).toHaveProperty("value", "已有草稿");
  });

  it("ignores an older source request when a newer dependency read finishes first", async () => {
    const { app, listNeeds, need } = context();
    const old = deferred<readonly ResourceNeed[]>();
    listNeeds.mockReturnValueOnce(old.promise);
    const page = show(app, "resources");
    const changed = { ...app, resourceService: { ...app.resourceService,
      list: async () => [{ ...need, description: "新的资源事实" }] } };
    page.rerender(<MemoryRouter><Page app={changed} kind="resources" /></MemoryRouter>);
    await screen.findByText("新的资源事实");
    await act(async () => old.resolve([{ ...need, description: "过期资源事实" }]));
    expect(screen.queryByText("过期资源事实")).toBeNull();
    expect(screen.getByText("新的资源事实")).toBeTruthy();
  });

  for (const action of ["editor", "toggle"] as const) {
    for (const outcome of ["success", "failure"] as const) {
      it(`does not reread or reopen an unmounted resource page after ${action} ${outcome}`, async () => {
        const { app, saveNeed, listNeeds, need } = context();
        const request = deferred<ResourceNeed>();
        saveNeed.mockReturnValueOnce(request.promise);
        const page = show(app, "resources");
        if (action === "editor") {
          fireEvent.click(await screen.findByRole("button", { name: "编辑资源需求：原需求" }));
          fireEvent.click(screen.getByRole("button", { name: "保存需求" }));
        } else fireEvent.click(await screen.findByRole("checkbox", { name: "待补齐 · 时间" }));
        page.unmount();
        await act(async () => {
          if (outcome === "success") request.resolve(need);
          else request.reject(new Error("private path"));
        });
        expect(saveNeed).toHaveBeenCalledTimes(1);
        expect(listNeeds).toHaveBeenCalledTimes(1);
      });
    }
  }
});

describe("V1 assessment periods and save lifecycle", () => {
  it("allows clearing the month without crashing or producing a bogus form", async () => {
    const { app, saveAssessment } = context();
    show(app, "assessment");
    const month = await screen.findByLabelText("所在月份");
    await waitFor(() => expect(month).toHaveProperty("disabled", false));
    fireEvent.change(month, { target: { value: "" } });
    expect(screen.getByRole("alert").textContent).toBe("请选择有效的月份。");
    expect(screen.queryByRole("region", { name: "本期评估" })).toBeNull();
    expect(saveAssessment).not.toHaveBeenCalled();
    fireEvent.change(month, { target: { value: "2020-03" } });
    fireEvent.change(screen.getByRole("combobox", { name: "周期" }), { target: { value: "quarter" } });
    expect(screen.getByRole("heading", { name: "2020-01 · 季度回看" })).toBeTruthy();
  });

  it("uses the existing calendar period boundaries, including leap day and the last supported year", async () => {
    const { app } = context();
    app.reviewService = { list: async () => [
      { id: "leap", title: "月底事实", reviewedOn: "2020-02-29" },
      { id: "outside", title: "次月事实", reviewedOn: "2020-03-01" },
    ] } as unknown as LifeOSContextValue["reviewService"];
    show(app, "assessment");
    fireEvent.change(await screen.findByLabelText("所在月份"), { target: { value: "2020-02" } });
    fireEvent.click(screen.getByText("查看来源"));
    expect(screen.getByRole("link", { name: "月底事实" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "次月事实" })).toBeNull();
    fireEvent.change(screen.getByLabelText("所在月份"), { target: { value: "9999-12" } });
    expect(screen.getByRole("heading", { name: "9999-12 · 月度回看" })).toBeTruthy();
  });

  it("protects the form and parent period during saving and preserves exact failed text for retry", async () => {
    const { app, saveAssessment } = context();
    const request = deferred<SystemAssessment>();
    saveAssessment.mockReturnValueOnce(request.promise);
    show(app, "assessment");
    const text = await screen.findByRole("textbox", { name: "更清楚当前状态" });
    fireEvent.change(text, { target: { value: " 原文\n不丢失 " } });
    const form = screen.getByRole("button", { name: "保存本期评估" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.change(text, { target: { value: "不能覆盖" } });
    fireEvent.change(screen.getByRole("combobox", { name: "周期" }), { target: { value: "quarter" } });
    expect(saveAssessment).toHaveBeenCalledTimes(1);
    expect(text.matches(":disabled")).toBe(true);
    expect(screen.getByLabelText("所在月份").matches(":disabled")).toBe(true);
    expect(screen.getByRole("combobox", { name: "周期" })).toHaveProperty("value", "month");
    await act(async () => request.reject(new Error("SQLITE_BUSY private path")));
    expect((await screen.findByRole("alert")).textContent).toBe("评估保存失败，请重试。");
    expect(text).toHaveProperty("value", " 原文\n不丢失 ");
    expect(text.matches(":disabled")).toBe(false);
    fireEvent.submit(form);
    await screen.findByText("评估已保存。");
    expect(saveAssessment).toHaveBeenCalledTimes(2);
    expect(saveAssessment.mock.calls[1][0].clarity).toBe(" 原文\n不丢失 ");
  });

  it("consumes the saved assessment without a second read or a false save failure", async () => {
    const { app, listAssessments, saveAssessment } = context();
    listAssessments.mockRejectedValueOnce(new Error("private path"));
    show(app, "assessment");
    expect((await screen.findByRole("alert")).textContent).toBe("评估记录读取失败，请重试。");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    const text = await screen.findByRole("textbox", { name: "更清楚当前状态" });
    fireEvent.change(text, { target: { value: "已保存草稿" } });
    listAssessments.mockRejectedValueOnce(new Error("reread failed"));
    fireEvent.click(screen.getByRole("button", { name: "保存本期评估" }));
    await screen.findByText("评估已保存。");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("textbox", { name: "更清楚当前状态" })).toBe(text);
    expect(text).toHaveProperty("value", "已保存草稿");
    expect(screen.getByLabelText("所在月份").matches(":disabled")).toBe(false);
    expect(listAssessments).toHaveBeenCalledTimes(2);
    expect(saveAssessment).toHaveBeenCalledOnce();
  });

  it("hides stale evidence and keeps the original draft during a replacement read failure", async () => {
    const { app } = context();
    app.issueService = { list: async () => [{ id: "i", title: "原问题事实", firstSeen: stamp.slice(0, 10) }] } as unknown as LifeOSContextValue["issueService"];
    const page = show(app, "assessment");
    await screen.findByRole("textbox", { name: "更清楚当前状态" });
    fireEvent.change(screen.getByLabelText("所在月份"), { target: { value: stamp.slice(0, 7) } });
    const draftText = screen.getByRole("textbox", { name: "更清楚当前状态" });
    fireEvent.change(draftText, { target: { value: "原来源草稿" } });
    fireEvent.click(screen.getByText("查看来源"));
    expect(screen.getByRole("link", { name: "原问题事实" })).toBeTruthy();
    const pending = deferred<readonly SystemAssessment[]>();
    const read = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue([]);
    const changed = { ...app, systemAssessmentService: { ...app.systemAssessmentService, list: read } };
    page.rerender(<MemoryRouter><Page app={changed} kind="assessment" /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "原问题事实" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "更清楚当前状态" })).toBe(draftText);
    await act(async () => pending.reject(new Error("private path")));
    expect((await screen.findByRole("alert")).textContent).toBe("评估记录读取失败，请重试。");
    expect(draftText).toHaveProperty("value", "原来源草稿");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("本期可查的记录");
    expect(screen.getByRole("textbox", { name: "更清楚当前状态" })).toBe(draftText);
    expect(draftText).toHaveProperty("value", "原来源草稿");
  });

  it("retries the original writer after replacement until the draft is explicitly discarded", async () => {
    const { app, saveAssessment } = context();
    const page = show(app, "assessment");
    const text = await screen.findByRole("textbox", { name: "更清楚当前状态" });
    fireEvent.change(text, { target: { value: "归属原来源" } });
    const replacementSave = vi.fn(async (draft: AssessmentDraft) =>
      ({ ...draft, id: "new-source", createdAt: stamp, updatedAt: stamp }));
    const replacementList = vi.fn(async () => []);
    const changed = { ...app, systemAssessmentService: { list: replacementList, save: replacementSave } } as unknown as LifeOSContextValue;
    page.rerender(<MemoryRouter><Page app={changed} kind="assessment" /></MemoryRouter>);
    await screen.findByText("本期可查的记录");
    saveAssessment.mockRejectedValueOnce(new Error("old private storage"));
    fireEvent.click(screen.getByRole("button", { name: "保存本期评估" }));
    await screen.findByRole("alert");
    expect(text).toHaveProperty("value", "归属原来源");
    fireEvent.click(screen.getByRole("button", { name: "保存本期评估" }));
    await screen.findByText("原来源评估已保存。");
    expect(saveAssessment).toHaveBeenCalledTimes(2);
    expect(replacementSave).not.toHaveBeenCalled();
    expect(replacementList).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "撤销修改" }));
    expect(text).toHaveProperty("value", "");
    fireEvent.change(text, { target: { value: "新来源选择" } });
    fireEvent.click(screen.getByRole("button", { name: "保存本期评估" }));
    await screen.findByText("评估已保存。");
    expect(replacementSave).toHaveBeenCalledOnce();
    expect(replacementList).toHaveBeenCalledOnce();
  });

  it.each(["success", "failure"])("does not publish an old save into replacement evidence (%s)", async outcome => {
    const { app, saveAssessment } = context();
    const pending = deferred<SystemAssessment>();
    saveAssessment.mockReturnValueOnce(pending.promise);
    const page = show(app, "assessment");
    fireEvent.click(await screen.findByRole("button", { name: "保存本期评估" }));
    const draft = saveAssessment.mock.calls[0][0];
    const replacementList = vi.fn(async () => []);
    const changed = { ...app, systemAssessmentService: { ...app.systemAssessmentService, list: replacementList } };
    page.rerender(<MemoryRouter><Page app={changed} kind="assessment" /></MemoryRouter>);
    await screen.findByText("本期可查的记录");
    await act(async () => {
      if (outcome === "success") pending.resolve({ ...draft, id: "old", createdAt: stamp, updatedAt: stamp });
      else pending.reject(new Error("private old path"));
    });
    expect(screen.queryByText("评估已保存。")).toBeNull();
    expect(replacementList).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("所在月份").matches(":disabled")).toBe(false);
  });

  it("keeps semantic errors actionable and checks validation before persistence", async () => {
    const { app, saveAssessment } = context();
    saveAssessment.mockRejectedValueOnce(new AssessmentValidationError("每项评估请控制在 600 字以内。"));
    show(app, "assessment");
    fireEvent.click(await screen.findByRole("button", { name: "保存本期评估" }));
    expect((await screen.findByRole("alert")).textContent).toBe("每项评估请控制在 600 字以内。");
    const draft: AssessmentDraft = { periodKind: "quarter", periodStart: "2026-11-01",
      clarity: "", alignment: "", reviews: "", decisions: "", earlyIssues: "", adjustment: "" };
    expect(() => normalizeAssessment(draft)).toThrow(AssessmentValidationError);
    expect(() => normalizeNeed({ goalId: "g", kind: "time", description: "",
      skillId: null, personId: null, met: false })).toThrow(ResourceValidationError);
  });

  it("ignores a late read failure after a newer assessment source has loaded", async () => {
    const { app, listAssessments } = context();
    const old = deferred<readonly SystemAssessment[]>();
    listAssessments.mockReturnValueOnce(old.promise);
    const page = show(app, "assessment");
    const changed = { ...app, systemAssessmentService: { ...app.systemAssessmentService,
      list: async () => [] } };
    page.rerender(<MemoryRouter><Page app={changed} kind="assessment" /></MemoryRouter>);
    await screen.findByRole("region", { name: "本期评估" });
    await act(async () => old.reject(new Error("late private path")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("region", { name: "本期评估" })).toBeTruthy();
  });

  for (const outcome of ["success", "failure"] as const) {
    it(`does not refresh the assessment page after leaving during save (${outcome})`, async () => {
      const { app, saveAssessment, listAssessments } = context();
      const request = deferred<SystemAssessment>();
      saveAssessment.mockReturnValueOnce(request.promise);
      const page = show(app, "assessment");
      fireEvent.click(await screen.findByRole("button", { name: "保存本期评估" }));
      const submitted = saveAssessment.mock.calls[0][0];
      page.unmount();
      await act(async () => {
        if (outcome === "success") request.resolve({ ...submitted, id: "a", createdAt: stamp, updatedAt: stamp });
        else request.reject(new Error("private path"));
      });
      expect(listAssessments).toHaveBeenCalledTimes(1);
    });
  }
});
