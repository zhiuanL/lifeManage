import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { DecisionEditorDialog } from "../../src/components/DecisionEditorDialog";
import { IssueEditorDialog } from "../../src/components/IssueEditorDialog";
import { DecisionValidationError, normalizeDecisionDraft, type Decision } from "../../src/domain/decisions/Decision";
import { IssueValidationError, normalizeIssueDraft, type Issue } from "../../src/domain/issues/Issue";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";
import { builtInTemplates } from "../../src/domain/templates/Template";
import { DecisionsPage } from "../../src/pages/DecisionsPage";
import { IssuesPage } from "../../src/pages/IssuesPage";
import type { DecisionRepository } from "../../src/repositories/decisions/DecisionRepository";
import type { IssueRepository } from "../../src/repositories/issues/IssueRepository";
import type { LifeDomainRepository } from "../../src/repositories/life/LifeDomainRepository";
import type { GoalRepository } from "../../src/repositories/planning/GoalRepository";
import { DecisionService } from "../../src/services/decisions/DecisionService";
import { IssueRecurrenceRecordedError, IssueService } from "../../src/services/issues/IssueService";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const timestamp = "2026-10-22T08:00:00Z";
const domain: LifeDomain = {
  id: "health", name: "健康", description: "", focus: "", color: "fern", icon: "heart",
  longTermExpectation: "", currentState: "", status: "active", sortOrder: 0,
  createdAt: timestamp, updatedAt: timestamp,
};
const issue: Issue = {
  id: "issue-a", title: "睡眠被打断", description: "", firstSeen: "2026-10-01",
  occurrenceCount: 2, causeHypothesis: "", attempts: "", followUp: "", status: "open",
  goalId: null, domainIds: [domain.id], createdAt: timestamp, updatedAt: timestamp,
};
const decision: Decision = {
  id: "decision-a", title: "调整作息", decidedOn: "2026-10-01", importance: "ordinary",
  status: "considering", background: "", options: "", constraints: "", criteria: "",
  risks: "", opportunityCost: "", reversibility: "unknown", choice: "", rationale: "",
  executionConditions: "", outcome: "", reflection: "", goalId: null, domainIds: [domain.id],
  navigationIds: [], personIds: [], resourceNeedIds: [], createdAt: timestamp, updatedAt: timestamp,
};
const storageError = new Error("SQLITE_BUSY C:\\private\\lifeos.db SELECT secret");
type Category = "issue" | "decision";
const config = {
  issue: { title: "问题名称", create: "记录问题", record: issue, page: <IssuesPage /> },
  decision: { title: "决策议题", create: "记录决策", record: decision, page: <DecisionsPage /> },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function services() {
  return {
    issueService: { list: vi.fn().mockResolvedValue([issue]), create: vi.fn().mockResolvedValue(issue),
      update: vi.fn().mockResolvedValue(issue), recordRecurrence: vi.fn().mockResolvedValue(issue) },
    decisionService: { list: vi.fn().mockResolvedValue([decision]), create: vi.fn().mockResolvedValue(decision),
      update: vi.fn().mockResolvedValue(decision) },
    lifeDomainService: { list: vi.fn().mockResolvedValue([domain]) },
    goalService: { list: vi.fn().mockResolvedValue([]) },
    lifeNavigationService: { list: vi.fn().mockResolvedValue([]) },
    lifeRecordsService: { listPeople: vi.fn().mockResolvedValue([]) },
    resourceService: { list: vi.fn().mockResolvedValue([]) },
    templateService: { find: vi.fn().mockResolvedValue(null) },
  };
}
function service(value: ReturnType<typeof services>, category: Category) {
  return category === "issue" ? value.issueService : value.decisionService;
}
function Host({ children }: { children: ReactNode }) {
  const location = useLocation(), navigate = useNavigate();
  return <><output aria-label="当前位置">{location.search + location.hash}</output>
    <button onClick={() => navigate("?domain=missing&keep=1&keep=2#source")}>失效领域链接</button>
    <button onClick={() => navigate("?domain=health&keep=1&keep=2#source")}>有效领域链接</button>
    {children}</>;
}
function tree(value: ReturnType<typeof services>, children: ReactNode, path = "/") {
  return <MemoryRouter initialEntries={[path]}>
    <LifeOSContext.Provider value={value as unknown as LifeOSContextValue}>
      <Host>{children}</Host>
    </LifeOSContext.Provider>
  </MemoryRouter>;
}
function editor(category: Category, onSaved: () => void, otherRecord = false) {
  const props = { domains: [domain], goals: [], onClose: vi.fn(), onSaved };
  return category === "issue"
    ? <IssueEditorDialog {...props} issue={otherRecord ? { ...issue, id: "other" } : issue} />
    : <DecisionEditorDialog {...props} decision={otherRecord ? { ...decision, id: "other" } : decision} />;
}

it("keeps pure validation and missing links typed but preserves repository failures", async () => {
  expect(() => normalizeIssueDraft({ ...issue, title: "" })).toThrow(IssueValidationError);
  expect(() => normalizeDecisionDraft({ ...decision, title: "" })).toThrow(DecisionValidationError);
  const domains = { findById: vi.fn().mockResolvedValue(domain) };
  const goals = { findById: vi.fn().mockResolvedValue(null) };
  const repository = { create: vi.fn().mockRejectedValue(storageError) };
  const args = [domains as unknown as LifeDomainRepository, goals as unknown as GoalRepository,
    { now: () => new Date(timestamp) }, { next: () => "new" }] as const;
  const issues = new IssueService(repository as unknown as IssueRepository, ...args);
  const decisions = new DecisionService(repository as unknown as DecisionRepository, ...args);
  await expect(issues.create(issue)).rejects.toBe(storageError);
  await expect(decisions.create(decision)).rejects.toBe(storageError);
  domains.findById.mockResolvedValue(null);
  await expect(issues.create(issue)).rejects.toBeInstanceOf(IssueValidationError);
  await expect(decisions.create(decision)).rejects.toBeInstanceOf(DecisionValidationError);
  expect(repository.create).toHaveBeenCalledTimes(2);
});

it.each(["issue", "decision"] as const)("%s editor owns the original service/record, locks fields and retries", async category => {
  const original = services(), replacement = services(), saving = deferred<unknown>();
  const oldSaved = vi.fn(), latestSaved = vi.fn(), first = service(original, category);
  first.update.mockReturnValueOnce(saving.promise);
  const view = render(tree(original, editor(category, oldSaved)));
  const title = screen.getByLabelText(config[category].title);
  fireEvent.change(title, { target: { value: "  保留原文  " } });
  fireEvent.submit(title.closest("form")!); fireEvent.submit(title.closest("form")!);
  fireEvent.change(title, { target: { value: "覆盖" } });
  fireEvent.keyDown(window, { key: "Escape" });
  expect(title).toBeDisabled();
  expect(title).toHaveValue("  保留原文  ");
  expect(first.update).toHaveBeenCalledOnce();
  view.rerender(tree(replacement, editor(category, latestSaved, true)));
  await act(async () => { saving.reject(storageError); });
  expect(screen.getByRole("alert")).toHaveTextContent(`保存${category === "issue" ? "问题" : "决策"}失败，请重试。`);
  expect(screen.getByRole("alert")).not.toHaveTextContent("private");
  expect(title).toHaveValue("  保留原文  ");
  fireEvent.submit(title.closest("form")!);
  await waitFor(() => expect(latestSaved).toHaveBeenCalledOnce());
  expect(oldSaved).not.toHaveBeenCalled();
  expect(first.update).toHaveBeenLastCalledWith(config[category].record.id,
    expect.objectContaining({ title: "  保留原文  " }));
  expect(service(replacement, category).update).not.toHaveBeenCalled();
});

it.each(["issue", "decision"] as const)("%s editor does not notify after unmount", async category => {
  const value = services(), saving = deferred<unknown>(), saved = vi.fn();
  service(value, category).update.mockReturnValueOnce(saving.promise);
  const view = render(tree(value, editor(category, saved)));
  fireEvent.submit(screen.getByLabelText(config[category].title).closest("form")!);
  view.unmount();
  await act(async () => { saving.resolve(config[category].record); });
  expect(saved).not.toHaveBeenCalled();
});

it.each(["issue", "decision"] as const)("%s displays actionable validation without exposing storage details", async category => {
  const value = services();
  service(value, category).update.mockRejectedValueOnce(category === "issue"
    ? new IssueValidationError("关联的目标已经不存在了。")
    : new DecisionValidationError("已归档的人物不能新增引用。"));
  render(tree(value, editor(category, vi.fn())));
  fireEvent.submit(screen.getByLabelText(config[category].title).closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent(category === "issue"
    ? "关联的目标已经不存在了。" : "已归档的人物不能新增引用。");
});

it.each(["issue", "decision"] as const)("%s rejects explicit missing/empty domains until recovery, preserving other parameters", async category => {
  for (const requested of ["missing", ""]) {
    const value = services();
    const view = render(tree(value, config[category].page, `/?domain=${requested}&keep=1&keep=2#source`));
    await screen.findByRole("button", { name: "清除失效筛选" });
    expect(screen.queryByText(config[category].record.title)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
    await screen.findByText(config[category].record.title);
    expect(screen.getByLabelText("当前位置")).toHaveTextContent("?keep=1&keep=2#source");
    view.unmount();
  }
});

it.each(["issue", "decision"] as const)("%s preserves editor and original candidates through source replacement, errors and invalid routes", async category => {
  const original = services(), replacement = services(), pending = deferred<unknown>();
  const view = render(tree(original, config[category].page, "/?domain=health"));
  fireEvent.click(await screen.findByRole("button", { name: config[category].create }));
  const dialog = screen.getByRole("dialog"), title = within(dialog).getByLabelText(config[category].title);
  fireEvent.change(title, { target: { value: "待保存草稿" } });
  expect(screen.getByLabelText("按生活领域筛选")).toBeDisabled();
  if (category === "issue") {
    expect(screen.getByRole("button", { name: `记录再次出现：${issue.title}` })).toBeDisabled();
  }
  service(replacement, category).list.mockReturnValueOnce(pending.promise);
  replacement.lifeDomainService.list.mockResolvedValue([]);
  view.rerender(tree(replacement, config[category].page));
  expect(screen.getByRole("dialog")).toBe(dialog);
  await act(async () => { pending.reject(storageError); });
  await screen.findByRole("heading", { name: `暂时无法打开${category === "issue" ? "问题" : "决策"}记录` });
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(title).toHaveValue("待保存草稿");
  expect(within(dialog).getByLabelText("健康")).toBeChecked();
  fireEvent.click(screen.getByText("失效领域链接"));
  fireEvent.submit(title.closest("form")!);
  await waitFor(() => expect(service(original, category).create).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await screen.findByRole("button", { name: "清除失效筛选" });
  expect(service(original, category).create).toHaveBeenCalledWith(
    expect.objectContaining({ title: "待保存草稿", domainIds: ["health"] }));
  expect(service(replacement, category).create).not.toHaveBeenCalled();
  expect(service(original, category).list).toHaveBeenCalledOnce();
});

it.each(["issue", "decision"] as const)("%s ignores old source reads", async category => {
  const original = services(), replacement = services(), pending = deferred<unknown>();
  service(original, category).list.mockReturnValueOnce(pending.promise);
  service(replacement, category).list.mockResolvedValue([{ ...config[category].record, title: "新来源记录" }]);
  const view = render(tree(original, config[category].page));
  view.rerender(tree(replacement, config[category].page));
  await screen.findByText("新来源记录");
  await act(async () => { pending.resolve([config[category].record]); });
  expect(screen.queryByText(config[category].record.title)).toBeNull();
  expect(screen.getByText("新来源记录")).toBeInTheDocument();
});

it.each(["issue", "decision"] as const)("%s leaves create/template requests pending when the domain is invalid", async category => {
  const value = services(), template = builtInTemplates.find(item => item.id === `default-${category}`)!;
  value.templateService.find.mockResolvedValue(template);
  render(tree(value, config[category].page,
    `/?domain=missing&create=${category}&template=${template.id}&keep=1#source`));
  await screen.findByRole("button", { name: "清除失效筛选" });
  expect(value.templateService.find).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
  await screen.findByRole("dialog");
  await waitFor(() => expect(screen.getByLabelText("当前位置")).toHaveTextContent("?keep=1#source"));
});

it("recurrence failure keeps records visible and late completion cannot reload a new source", async () => {
  const original = services(), replacement = services(), pending = deferred<Issue>();
  original.issueService.recordRecurrence.mockRejectedValueOnce(storageError).mockReturnValueOnce(pending.promise);
  const view = render(tree(original, <IssuesPage />));
  const button = await screen.findByRole("button", { name: `记录再次出现：${issue.title}` });
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("记录失败，请重试。");
  expect(screen.getByText(issue.title)).toBeInTheDocument();
  expect(original.issueService.list).toHaveBeenCalledOnce();
  fireEvent.click(button); fireEvent.click(button);
  expect(original.issueService.recordRecurrence).toHaveBeenCalledTimes(2);
  view.rerender(tree(replacement, <IssuesPage />));
  await waitFor(() => expect(replacement.issueService.list).toHaveBeenCalledOnce());
  await act(async () => { pending.resolve(issue); });
  expect(original.issueService.list).toHaveBeenCalledOnce();
  expect(replacement.issueService.list).toHaveBeenCalledOnce();
});

it("acknowledges a committed recurrence even when its reread fails, and retries only the read", async () => {
  const repository = { recordRecurrence: vi.fn().mockResolvedValue(true),
    findById: vi.fn().mockRejectedValue(storageError) };
  const issues = new IssueService(repository as unknown as IssueRepository,
    {} as LifeDomainRepository, {} as GoalRepository,
    { now: () => new Date(timestamp) }, { next: () => "new" });
  await expect(issues.recordRecurrence(issue.id)).rejects.toBeInstanceOf(IssueRecurrenceRecordedError);
  expect(repository.recordRecurrence).toHaveBeenCalledOnce();
  const value = services();
  value.issueService.recordRecurrence.mockRejectedValueOnce(new IssueRecurrenceRecordedError());
  render(tree(value, <IssuesPage />));
  fireEvent.click(await screen.findByRole("button", { name: `记录再次出现：${issue.title}` }));
  await screen.findByText("已记录再次出现，但无法读取最新问题。请重试读取，不要重复记录。");
  expect(screen.queryByRole("button", { name: `记录再次出现：${issue.title}` })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByText(issue.title);
  expect(value.issueService.list).toHaveBeenCalledTimes(2);
  expect(value.issueService.recordRecurrence).toHaveBeenCalledOnce();
});
