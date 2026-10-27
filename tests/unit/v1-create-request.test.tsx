import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState, type ComponentType } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";
import { GoalsPage } from "../../src/pages/GoalsPage";
import { ReviewsPage } from "../../src/pages/ReviewsPage";
import { IssuesPage } from "../../src/pages/IssuesPage";
import { DecisionsPage } from "../../src/pages/DecisionsPage";
import { HabitsPage } from "../../src/pages/HabitsPage";
import { builtInTemplates } from "../../src/domain/templates/Template";

interface EditorProps {
  onClose(): void;
  onSaved(): void;
  defaultDomainId?: string;
  onTemplateReady?(): void;
}

function TestEditor({ kind, onClose, onSaved, defaultDomainId, onTemplateReady }: EditorProps & { kind: string }) {
  const [draft, setDraft] = useState("");
  useEffect(() => { onTemplateReady?.(); }, [onTemplateReady]);
  return <section role="dialog" aria-label={`测试新建 ${kind}`}>
    <span data-testid="editor-domain">{defaultDomainId}</span>
    <input aria-label="测试草稿" value={draft} onChange={event => setDraft(event.target.value)} />
    <button onClick={onClose}>测试取消</button>
    <button onClick={onSaved}>测试保存回调</button>
  </section>;
}

vi.mock("../../src/components/GoalEditorDialog", () => ({
  GoalEditorDialog: (props: EditorProps) => <TestEditor {...props} kind="goal" />,
}));
vi.mock("../../src/components/ActionEditorDialog", () => ({
  ActionEditorDialog: (props: EditorProps) => <TestEditor {...props} kind="action" />,
}));
vi.mock("../../src/components/ReviewEditorDialog", () => ({
  ReviewEditorDialog: (props: EditorProps) => <TestEditor {...props} kind="review" />,
}));
vi.mock("../../src/components/IssueEditorDialog", () => ({
  IssueEditorDialog: (props: EditorProps) => <TestEditor {...props} kind="issue" />,
}));
vi.mock("../../src/components/DecisionEditorDialog", () => ({
  DecisionEditorDialog: (props: EditorProps) => <TestEditor {...props} kind="decision" />,
}));
vi.mock("../../src/components/HabitEditorDialog", () => ({
  HabitEditorDialog: (props: EditorProps) => <TestEditor {...props} kind="habit" />,
}));

afterEach(cleanup);

const domain: LifeDomain = {
  id: "领域 &1", name: "健康", description: "", focus: "", color: "fern", icon: "heart",
  currentState: "", longTermExpectation: "", status: "active", sortOrder: 0,
  createdAt: "2026-10-14T08:00:00.000Z", updatedAt: "2026-10-14T08:00:00.000Z",
};

function context() {
  const listDomains = vi.fn().mockResolvedValue([domain]);
  const value = {
    lifeDomainService: { list: listDomains },
    goalService: { list: vi.fn().mockResolvedValue([]) },
    actionService: { list: vi.fn().mockResolvedValue([]) },
    goalProgressItemService: { list: vi.fn().mockResolvedValue([]) },
    habitService: { list: vi.fn().mockResolvedValue([]), listLogs: vi.fn().mockResolvedValue([]) },
    reviewService: { list: vi.fn().mockResolvedValue([]) },
    issueService: { list: vi.fn().mockResolvedValue([]) },
    decisionService: { list: vi.fn().mockResolvedValue([]) },
    lifeNavigationService: { list: vi.fn().mockResolvedValue([]) },
    lifeRecordsService: { listPeople: vi.fn().mockResolvedValue([]) },
    resourceService: { list: vi.fn().mockResolvedValue([]) },
    templateService: { find: vi.fn(async (id: string) => {
      if (id === "tpl-中文") return { ...builtInTemplates.find(item => item.id === "default-smart")!, id };
      if (id === "issue-template") return { ...builtInTemplates.find(item => item.id === "default-issue")!, id };
      return builtInTemplates.find(item => item.id === id) ?? null;
    }) },
  } as unknown as LifeOSContextValue;
  return { value, listDomains };
}

function Host({ Page }: { Page: ComponentType }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  return <>
    <output data-testid="location">{JSON.stringify({
      pathname: location.pathname, search: location.search, hash: location.hash,
    })}</output>
    <button onClick={() => setRevision(value => value + 1)}>模拟页面刷新</button>
    <button onClick={() => void navigate(-1)}>测试返回</button>
    {location.pathname === "/search" ? <p>测试搜索页</p> : <Page key={revision} />}
  </>;
}

function show(Page: ComponentType, path: string, value = context().value) {
  render(<LifeOSContext.Provider value={value}>
    <MemoryRouter initialEntries={["/search", path]} initialIndex={1}>
      <Host Page={Page} />
    </MemoryRouter>
  </LifeOSContext.Provider>);
}

function currentLocation(): { pathname: string; search: string; hash: string } {
  return JSON.parse(screen.getByTestId("location").textContent ?? "{}");
}

const cases = [
  { kind: "goal", path: "/goals", Page: GoalsPage },
  { kind: "action", path: "/goals", Page: GoalsPage },
  { kind: "review", path: "/reviews", Page: ReviewsPage },
  { kind: "issue", path: "/issues", Page: IssuesPage },
  { kind: "decision", path: "/decisions", Page: DecisionsPage },
  { kind: "habit", path: "/habits", Page: HabitsPage },
];

describe("V1 one-time search create request", () => {
  it.each(cases)("consumes $kind only on editor mount and preserves context after cancel", async ({
    kind, path, Page,
  }) => {
    const params = new URLSearchParams({ create: kind, domain: domain.id, view: "中文列表" });
    params.append("tag", "一");
    params.append("tag", "二");
    const hash = "#source-%E4%B8%AD%E6%96%87";
    show(Page, `${path}?${params}${hash}`);
    await screen.findByRole("dialog", { name: `测试新建 ${kind}` });
    await waitFor(() => expect(new URLSearchParams(currentLocation().search).has("create")).toBe(false));
    const remaining = new URLSearchParams(currentLocation().search);
    expect(remaining.get("domain")).toBe(domain.id);
    expect(remaining.get("view")).toBe("中文列表");
    expect(remaining.getAll("tag")).toEqual(["一", "二"]);
    expect(currentLocation().hash).toBe(hash);
    expect(screen.getByTestId("editor-domain").textContent).toBe(domain.id);
    fireEvent.change(screen.getByRole("textbox", { name: "测试草稿" }), { target: { value: "保留草稿" } });
    expect((screen.getByRole("textbox", { name: "测试草稿" }) as HTMLInputElement).value).toBe("保留草稿");
    fireEvent.click(screen.getByRole("button", { name: "测试取消" }));
    fireEvent.click(screen.getByRole("button", { name: "模拟页面刷新" }));
    await waitFor(() => expect(screen.queryByText(/正在/)).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "测试返回" }));
    expect(screen.getByText("测试搜索页")).toBeTruthy();
  });

  it("does not reopen after the save callback and subsequent page remount", async () => {
    show(IssuesPage, "/issues?create=issue");
    await screen.findByRole("dialog");
    await waitFor(() => expect(currentLocation().search).toBe(""));
    fireEvent.click(screen.getByRole("button", { name: "测试保存回调" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "模拟页面刷新" }));
    await waitFor(() => expect(screen.queryByText(/正在/)).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a request on read failure and consumes it only after retry opens the editor", async () => {
    const { value, listDomains } = context();
    listDomains.mockRejectedValueOnce(new Error("测试读取失败"));
    show(ReviewsPage, "/reviews?create=review", value);
    await screen.findByRole("heading", { name: "暂时无法打开回顾" });
    expect(new URLSearchParams(currentLocation().search).get("create")).toBe("review");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("dialog", { name: "测试新建 review" });
    await waitFor(() => expect(currentLocation().search).toBe(""));
  });

  it("consumes the applied goal template and its superseded action request together", async () => {
    show(GoalsPage, "/goals?template=tpl-%E4%B8%AD%E6%96%87&create=action#source");
    await screen.findByRole("dialog", { name: "测试新建 goal" });
    expect(screen.queryByRole("dialog", { name: "测试新建 action" })).toBeNull();
    await waitFor(() => expect(new URLSearchParams(currentLocation().search).has("create")).toBe(false));
    expect(new URLSearchParams(currentLocation().search).has("template")).toBe(false);
    expect(currentLocation().hash).toBe("#source");
  });

  it("leaves unknown or wrong-capability requests untouched", async () => {
    show(IssuesPage, "/issues?create=action&template=issue-template");
    await screen.findByRole("dialog", { name: "测试新建 issue" });
    expect(new URLSearchParams(currentLocation().search).get("create")).toBe("action");
  });

  it("does not consume a goal request while an unavailable domain blocks the editor", async () => {
    show(GoalsPage, "/goals?create=goal&domain=missing");
    await screen.findByRole("heading", { name: "无法按当前领域查看目标与行动" });
    expect(new URLSearchParams(currentLocation().search).get("create")).toBe("goal");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
