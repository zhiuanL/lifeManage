import { SqliteTemplateRepository } from "../../src/repositories/sqlite/SqliteTemplateRepository";
import { DatabaseSync } from "node:sqlite";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { DecisionEditorDialog } from "../../src/components/DecisionEditorDialog";
import { IssueEditorDialog } from "../../src/components/IssueEditorDialog";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { decisionDraftDefaults } from "../../src/domain/decisions/DecisionTemplate";
import type { Decision, DecisionDraft } from "../../src/domain/decisions/Decision";
import { issueDraftDefaults, normalizeIssueTemplateDefaults } from "../../src/domain/issues/IssueTemplate";
import type { Issue, IssueDraft } from "../../src/domain/issues/Issue";
import { builtInTemplates, validateTemplate, type Template } from "../../src/domain/templates/Template";
import { DecisionsPage } from "../../src/pages/DecisionsPage";
import { IssuesPage } from "../../src/pages/IssuesPage";
import { TemplatesPage } from "../../src/pages/TemplatesPage";
import { TemplateService } from "../../src/services/templates/TemplateService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const issueTemplate = builtInTemplates.find(item => item.id === "default-issue")!;
const decisionTemplate = builtInTemplates.find(item => item.id === "default-decision")!;
type Category = "issue" | "decision";
const config = {
  issue: { template: issueTemplate, field: "问题描述", title: "问题名称",
    create: "记录问题", save: "保存问题", path: "/issues" },
  decision: { template: decisionTemplate, field: "背景", title: "决策议题",
    create: "记录决策", save: "保存决策", path: "/decisions" },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function context() {
  const value = {
    templateService: {
      find: vi.fn(async (id: string) => builtInTemplates.find(item => item.id === id) ?? null),
      list: vi.fn(async () => builtInTemplates),
      save: vi.fn(),
    },
    issueService: { list: vi.fn(async (): Promise<Issue[]> => []),
      create: vi.fn<(draft: IssueDraft) => Promise<object>>(async () => ({})),
      update: vi.fn(), recordRecurrence: vi.fn() },
    decisionService: { list: vi.fn(async (): Promise<Decision[]> => []),
      create: vi.fn<(draft: DecisionDraft) => Promise<object>>(async () => ({})), update: vi.fn() },
    lifeDomainService: { list: vi.fn(async () => []) },
    goalService: { list: vi.fn(async () => []) },
    lifeNavigationService: { list: vi.fn(async () => []) },
    lifeRecordsService: { listPeople: vi.fn(async () => []) },
    resourceService: { list: vi.fn(async () => []) },
  };
  return value;
}
function Host({ category }: { category: Category }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { path, template } = config[category];
  return <>
    <output aria-label="当前位置">{location.pathname + location.search + location.hash}</output>
    <button onClick={() => navigate(`${path}?template=${template.id}&keep=1#source`)}>切换模板请求</button>
    {category === "issue" ? <IssuesPage /> : <DecisionsPage />}
  </>;
}
function mount(category: Category, value: ReturnType<typeof context>, path = config[category].path) {
  return render(<MemoryRouter initialEntries={[path]}>
    <LifeOSContext.Provider value={value as unknown as LifeOSContextValue}>
      <Host category={category} />
    </LifeOSContext.Provider>
  </MemoryRouter>);
}
function params() {
  return new URL(screen.getByLabelText("当前位置").textContent ?? "", "http://localhost").searchParams;
}
function text(label: string) {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}

describe("issue and decision template field contracts", () => {
  it("retains legacy issue text without silently truncating it into a draft", () => {
    const legacy = { causeHypothesis: "字".repeat(2000) };
    expect(normalizeIssueTemplateDefaults(legacy)).toEqual(legacy);
    expect(validateTemplate("issue", "旧模板", legacy).defaults).toEqual(legacy);
    expect(() => issueDraftDefaults(legacy)).toThrow("模板中心");
    expect(issueDraftDefaults({ description: "字".repeat(1200),
      causeHypothesis: "字".repeat(800), attempts: "", followUp: "" })).toMatchObject({ attempts: "" });
  });
  it("uses explicit importance only and does not infer status or importance from text", () => {
    expect(decisionDraftDefaults(decisionTemplate.defaults).importance).toBe("major");
    expect(decisionDraftDefaults({ options: "方案甲", choice: "尚未确认" }))
      .toEqual({ options: "方案甲", choice: "尚未确认" });
    expect(decisionDraftDefaults({ importance: "ordinary" })).toEqual({ importance: "ordinary" });
    const defaults = { background: "原文" };
    const patch = decisionDraftDefaults(defaults);
    patch.background = "改动";
    expect(defaults.background).toBe("原文");
  });
  it.each(["issue", "decision"] as const)("rejects instance fields and prototype keys for %s", category => {
    for (const defaults of [
      { title: "覆盖标题" }, { status: "decided" }, { goalId: "private" },
      { domainIds: [] }, { decidedOn: "2026-10-21" }, { occurrenceCount: 3 },
      { constructor: "unsafe" }, JSON.parse('{"__proto__":"unsafe"}'),
    ]) expect(() => validateTemplate(category, "模板", defaults)).toThrow();
  });
  it.each([null, true, "MAJOR", 1])("rejects invalid importance %j", importance => {
    expect(() => validateTemplate("decision", "模板", { importance })).toThrow();
  });
});

describe.each(["issue", "decision"] as const)("%s Chinese template requests", category => {
  const { template, path, field, title, create, save } = config[category];
  it("waits for a valid read, applies a snapshot, and consumes only opening parameters", async () => {
    const value = context();
    const pending = deferred<Template | null>();
    value.templateService.find.mockReturnValueOnce(pending.promise);
    mount(category, value, `${path}?template=${template.id}&create=${category}&keep=1&keep=2#source`);
    await screen.findByText(`正在读取${category === "issue" ? "问题" : "决策"}模板`);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((screen.getByRole("button", { name: create }) as HTMLButtonElement).disabled).toBe(true);
    expect(params().get("template")).toBe(template.id);
    await act(async () => pending.resolve(template));
    await screen.findByRole("dialog");
    expect(text(field)).toBe(template.defaults[category === "issue" ? "description" : "background"]);
    expect(text(title)).toBe("");
    if (category === "decision") {
      expect((screen.getByLabelText("重大决策档案") as HTMLInputElement).checked).toBe(true);
      expect(text("可选方案")).toBe(template.defaults.options);
      expect(text("状态")).toBe("considering");
    }
    await waitFor(() => expect(params().has("template")).toBe(false));
    expect(params().has("create")).toBe(false);
    expect(params().getAll("keep")).toEqual(["1", "2"]);
    expect(screen.getByLabelText("当前位置").textContent).toContain("#source");
    fireEvent.change(screen.getByLabelText(title), { target: { value: "确认创建" } });
    fireEvent.click(screen.getByRole("button", { name: save }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const service = category === "issue" ? value.issueService : value.decisionService;
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({
      title: "确认创建",
      [category === "issue" ? "description" : "background"]:
        template.defaults[category === "issue" ? "description" : "background"],
      status: category === "issue" ? "open" : "considering", domainIds: [], goalId: null,
    }));
    fireEvent.click(screen.getByRole("button", { name: create }));
    expect(text(field)).toBe("");
  });
  it("sanitizes read failures and retains the request for retry", async () => {
    const value = context();
    value.templateService.find.mockRejectedValueOnce(new Error("C:\\private\\data.db SELECT secret"));
    mount(category, value, `${path}?template=${template.id}`);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("private");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试读取模板" }));
    await screen.findByRole("dialog");
  });
  it("keeps same-page requests pending while a draft is open", async () => {
    const value = context();
    mount(category, value);
    fireEvent.click(await screen.findByRole("button", { name: create }));
    fireEvent.change(screen.getByLabelText(field), { target: { value: "未保存草稿" } });
    fireEvent.click(screen.getByText("切换模板请求"));
    expect(text(field)).toBe("未保存草稿");
    expect(params().get("template")).toBe(template.id);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(text(field)).toBe(
      template.defaults[category === "issue" ? "description" : "background"]));
    await waitFor(() => expect(params().has("template")).toBe(false));
  });
  it("keeps invalid requests until explicit cancellation", async () => {
    const value = context();
    value.templateService.find.mockResolvedValueOnce({ ...template, defaults: { status: "decided" } });
    mount(category, value, `${path}?template=bad&create=${category}&keep=1#source`);
    await screen.findByRole("alert");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(params().get("template")).toBe("bad");
    fireEvent.click(screen.getByRole("button", { name: "取消模板请求" }));
    await waitFor(() => expect(params().has("template")).toBe(false));
    expect(params().has("create")).toBe(false);
    expect(params().get("keep")).toBe("1");
  });
  it("drops replaced asynchronous reads", async () => {
    const value = context();
    const pending = deferred<Template | null>();
    value.templateService.find.mockReturnValueOnce(pending.promise);
    const view = mount(category, value, `${path}?template=old`);
    await screen.findByText(`正在读取${category === "issue" ? "问题" : "决策"}模板`);
    fireEvent.click(screen.getByText("切换模板请求"));
    await screen.findByRole("dialog");
    await act(async () => pending.resolve({ ...template, defaults: { background: "错误覆盖" } }));
    expect(text(field)).toBe(template.defaults[category === "issue" ? "description" : "background"]);
    view.unmount();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("does not open an editor from a read finishing after unmount", async () => {
    const value = context();
    const pending = deferred<Template | null>();
    value.templateService.find.mockReturnValueOnce(pending.promise);
    const view = mount(category, value, `${path}?template=${template.id}`);
    await screen.findByText(`正在读取${category === "issue" ? "问题" : "决策"}模板`);
    view.unmount();
    await act(async () => pending.resolve(template));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(value.issueService.create).not.toHaveBeenCalled();
    expect(value.decisionService.create).not.toHaveBeenCalled();
  });
  it.each([null, { ...template, category: "habit" as const }])(
    "rejects missing or wrong-category templates without opening a blank editor", async result => {
      const value = context();
      value.templateService.find.mockResolvedValueOnce(result);
      mount(category, value, `${path}?template=unusable`);
      await screen.findByRole("alert");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(params().get("template")).toBe("unusable");
    });
  it("preserves failed drafts and prevents duplicate saves and dismissal", async () => {
    const value = context();
    const service = category === "issue" ? value.issueService : value.decisionService;
    const saving = deferred<object>();
    service.create.mockRejectedValueOnce(new Error("保存失败")).mockReturnValueOnce(saving.promise);
    mount(category, value, `${path}?template=${template.id}`);
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText(title), { target: { value: "保留草稿" } });
    fireEvent.click(screen.getByRole("button", { name: save }));
    await screen.findByRole("alert");
    expect(text(title)).toBe("保留草稿");
    const form = screen.getByRole("dialog").querySelector("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(service.create).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText(title).closest("fieldset")?.disabled).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => saving.resolve({}));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("decision template compatibility and persistence", () => {
  it("makes advanced text accessible for legacy ordinary templates without guessing importance", () => {
    const value = context();
    render(<LifeOSContext.Provider value={value as unknown as LifeOSContextValue}>
      <DecisionEditorDialog template={{ ...decisionTemplate, defaults: { options: "原有方案" } }}
        domains={[]} goals={[]} onClose={() => {}} onSaved={() => {}} />
    </LifeOSContext.Provider>);
    expect(text("可选方案")).toBe("原有方案");
    expect((screen.getByLabelText("重大决策档案") as HTMLInputElement).checked).toBe(false);
  });
  it("ignores templates while editing existing issues and decisions", () => {
    const value = context();
    const issue = { id: "issue", title: "旧问题", description: "原描述", causeHypothesis: "",
      attempts: "", followUp: "", firstSeen: "2026-10-21", occurrenceCount: 1,
      status: "open", goalId: null, domainIds: [], createdAt: "", updatedAt: "" } as Issue;
    const view = render(<LifeOSContext.Provider value={value as unknown as LifeOSContextValue}>
      <IssueEditorDialog issue={issue} template={issueTemplate}
        domains={[]} goals={[]} onClose={() => {}} onSaved={() => {}} />
    </LifeOSContext.Provider>);
    expect(text("问题描述")).toBe("原描述");
    view.unmount();
    const decision = { id: "decision", title: "旧选择", decidedOn: "2026-10-21",
      importance: "major", status: "considering", background: "原背景", options: "",
      constraints: "", criteria: "", risks: "", opportunityCost: "", reversibility: "unknown",
      choice: "", rationale: "", executionConditions: "", outcome: "", reflection: "",
      goalId: null, domainIds: [], createdAt: "", updatedAt: "" } as Decision;
    render(<LifeOSContext.Provider value={value as unknown as LifeOSContextValue}>
      <DecisionEditorDialog decision={decision} template={decisionTemplate}
        domains={[]} goals={[]} onClose={() => {}} onSaved={() => {}} />
    </LifeOSContext.Provider>);
    expect(text("背景")).toBe("原背景");
    expect((screen.getByLabelText("重大决策档案") as HTMLInputElement).disabled).toBe(true);
  });
  it("provides a bounded enum control when copying the major-decision preset", async () => {
    const value = context();
    render(<MemoryRouter initialEntries={["/templates?category=decision"]}>
      <LifeOSContext.Provider value={value as unknown as LifeOSContextValue}>
        <TemplatesPage />
      </LifeOSContext.Provider>
    </MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "复制重大选择" }));
    expect(text("默认档案类型")).toBe("major");
    fireEvent.change(screen.getByLabelText("默认档案类型"), { target: { value: "ordinary" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));
    await waitFor(() => expect(value.templateService.save).toHaveBeenCalledWith(
      "decision", "重大选择（副本）", expect.objectContaining({ importance: "ordinary" }), undefined));
  });
  it("rereads explicit importance and legacy defaults without mutating template snapshots", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys=ON");
      const sql = nativeSqliteExecutor(db);
      const clock = { now: () => new Date("2026-10-21T04:00:00Z") };
      let sequence = 0;
      const ids = { next: () => `decision-template-${++sequence}` };
      await new MigrationRunner(sql, migrations, clock).run();
      const service = new TemplateService(new SqliteTemplateRepository(sql), clock, ids);
      const legacy = await service.save("decision", "旧档案", { options: "原方案" });
      const saved = await service.save("decision", "重大选择副本", decisionTemplate.defaults);
      const snapshot = decisionDraftDefaults(saved.defaults);
      await service.save("decision", "重大选择副本", { importance: "ordinary", options: "新方案" }, saved.id);
      const reread = new TemplateService(new SqliteTemplateRepository(sql), clock, ids);
      expect((await reread.find(saved.id))?.defaults).toEqual({ importance: "ordinary", options: "新方案" });
      expect((await reread.find(legacy.id))?.defaults).toEqual({ options: "原方案" });
      expect(snapshot.importance).toBe("major");
      expect(snapshot.options).toBe("有哪些可选方案？");
    } finally { db.close(); }
  });
});
