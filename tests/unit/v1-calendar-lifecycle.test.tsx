import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { localDate } from "../../src/domain/habits/Habit";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";
import { ActionValidationError, type Action } from "../../src/domain/planning/Action";
import type { Goal } from "../../src/domain/planning/Goal";
import { CalendarPage } from "../../src/pages/CalendarPage";

afterEach(cleanup);
const stamp = "2026-10-22T08:00:00.000Z";
const health: LifeDomain = { id: "health/中文", name: "健康", description: "", focus: "",
  currentState: "", longTermExpectation: "", color: "fern", icon: "heart", status: "active",
  sortOrder: 0, createdAt: stamp, updatedAt: stamp };
const work: LifeDomain = { ...health, id: "work", name: "事业", sortOrder: 1 };
const goal: Goal = { id: "goal", title: "健康目标", description: "", domainId: health.id,
  domainIds: [health.id], parentId: null, status: "active", targetDate: null,
  sortOrder: 0, completedAt: null, createdAt: stamp, updatedAt: stamp };
function action(id: string, title: string, domainIds: readonly string[], goalId: string | null = null,
  scheduledFor: string | null = localDate(new Date())): Action {
  return { id, title, notes: "", domainId: domainIds[0] ?? null, domainIds, goalId,
    scheduledFor, status: "open", sortOrder: 0, completedAt: null, createdAt: stamp, updatedAt: stamp };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function context() {
  let actions = [
    action("health-action", "健康行动", [health.id]),
    action("linked-action", "目标关联行动", [], goal.id),
    action("work-action", "事业行动", [work.id]),
    action("global-action", "独立行动", []),
    action("unplaced", "健康未安排", [], goal.id, null),
  ];
  const list = vi.fn<LifeOSContextValue["actionService"]["list"]>(async () => actions);
  const create = vi.fn<LifeOSContextValue["actionService"]["create"]>(async draft => {
    const saved = { ...action("new", draft.title, draft.domainIds ?? []), ...draft,
      domainIds: draft.domainIds ?? [] };
    actions = [...actions, saved]; return saved;
  });
  const update = vi.fn<LifeOSContextValue["actionService"]["update"]>(async (id, draft) => {
    const saved = { ...actions.find(item => item.id === id)!, ...draft, domainIds: draft.domainIds ?? [] };
    actions = actions.map(item => item.id === id ? saved : item); return saved;
  });
  const toggle = vi.fn<LifeOSContextValue["actionService"]["toggleCompletion"]>(async id => {
    const original = actions.find(item => item.id === id)!;
    const saved: Action = { ...original, status: original.status === "open" ? "completed" : "open" };
    actions = actions.map(item => item.id === id ? saved : item); return saved;
  });
  const domains = vi.fn<LifeOSContextValue["lifeDomainService"]["list"]>(async () => [health, work]);
  const goals = vi.fn<LifeOSContextValue["goalService"]["list"]>(async () => [goal]);
  const app = { lifeDomainService: { list: domains }, goalService: { list: goals },
    actionService: { list, create, update, toggleCompletion: toggle },
    lifeRecordsService: { listEvents: vi.fn(async () => []) },
    habitService: { list: vi.fn(async () => []), listLogs: vi.fn(async () => []) },
    reviewService: { list: vi.fn(async () => []) },
  } as unknown as LifeOSContextValue;
  return { app, list, create, update, toggle, domains, goals };
}
function LocationProbe() {
  const { pathname, search, hash } = useLocation();
  return <output aria-label="当前位置">{pathname}{search}{hash}</output>;
}
function Frame({ app, url = "/calendar" }: { app: LifeOSContextValue; url?: string }) {
  return <MemoryRouter initialEntries={[url]}><LifeOSContext.Provider value={app}>
    <CalendarPage /><LocationProbe />
    <Link to="/calendar?domain=missing&extra=a&extra=b#original">失效领域入口</Link>
    <Link to="/calendar?domain=work&extra=a&extra=b#original">事业入口</Link>
  </LifeOSContext.Provider></MemoryRouter>;
}

describe("V1 calendar context and saving lifecycle", () => {
  it("uses explicit domain context including linked goals, and preserves unrelated filters and the source hash", async () => {
    const services = context();
    render(<Frame app={services.app}
      url={`/calendar?domain=${encodeURIComponent(health.id)}&extra=a&extra=b#original`} />);
    await screen.findByRole("link", { name: "健康行动" });
    expect(screen.getByRole("link", { name: "目标关联行动" })).toBeTruthy();
    fireEvent.click(screen.getByText("未安排行动（1）", { selector: "summary" }));
    expect(screen.getByRole("link", { name: "健康未安排" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "事业行动" })).toBeNull();
    expect(screen.queryByRole("link", { name: "独立行动" })).toBeNull();
    expect(screen.getByLabelText("日历领域")).toHaveProperty("value", health.id);
    fireEvent.change(screen.getByLabelText("日历领域"), { target: { value: "" } });
    expect(screen.getByRole("link", { name: "独立行动" })).toBeTruthy();
    expect(screen.getByLabelText("当前位置").textContent).toBe("/calendar?extra=a&extra=b#original");
    fireEvent.change(screen.getByLabelText("日历领域"), { target: { value: work.id } });
    expect(screen.getByRole("link", { name: "事业行动" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "健康未安排" })).toBeNull();
    expect(screen.getByLabelText("当前位置").textContent).toBe("/calendar?extra=a&extra=b&domain=work#original");
    expect(services.create).not.toHaveBeenCalled();
    expect(services.update).not.toHaveBeenCalled();
    expect(services.toggle).not.toHaveBeenCalled();
  });

  it.each(["missing", ""])("does not broaden the invalid domain '%s' until explicitly cleared", async domainId => {
    const services = context();
    render(<Frame app={services.app} url={`/calendar?domain=${domainId}&extra=a&extra=b#original`} />);
    await screen.findByRole("heading", { name: "无法按当前领域查看日历" });
    expect(screen.queryByRole("link", { name: "独立行动" })).toBeNull();
    expect(screen.queryByRole("button", { name: "新增行动" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
    expect(screen.getByLabelText("当前位置").textContent).toBe("/calendar?extra=a&extra=b#original");
    expect(screen.getByRole("link", { name: "独立行动" })).toBeTruthy();
    expect(services.create).not.toHaveBeenCalled();
  });

  it("prefills only the explicit domain and saves only after confirmation", async () => {
    const services = context();
    render(<Frame app={services.app} url={`/calendar?domain=${encodeURIComponent(health.id)}`} />);
    fireEvent.click(await screen.findByRole("button", { name: "新增行动" }));
    expect(screen.getByRole("checkbox", { name: "健康" })).toHaveProperty("checked", true);
    expect(screen.getByRole("checkbox", { name: "事业" })).toHaveProperty("checked", false);
    expect(screen.getByLabelText("关联目标")).toHaveProperty("value", "");
    expect(services.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("行动名称"), { target: { value: "新下一步" } });
    fireEvent.click(screen.getByRole("button", { name: "创建行动" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(services.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      title: "新下一步", domainIds: [health.id], goalId: null,
    }));
    await screen.findByRole("heading", { name: "日历", level: 1 });
  });

  it("locks competing edits and filters, preserves failed drafts and retries the original action", async () => {
    const services = context();
    const pending = deferred<Action>();
    services.update.mockReturnValueOnce(pending.promise);
    render(<Frame app={services.app} />);
    await screen.findByRole("button", { name: "编辑行动：健康行动" });
    fireEvent.click(screen.getByText("未安排行动（1）", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑行动：健康行动" }));
    fireEvent.change(screen.getByLabelText("行动名称"), { target: { value: "保留原草稿" } });
    const dialog = screen.getByRole("dialog");
    fireEvent.submit(dialog.querySelector("form")!);
    fireEvent.submit(dialog.querySelector("form")!);
    fireEvent.change(screen.getByLabelText("行动名称"), { target: { value: "不能覆盖" } });
    fireEvent.click(screen.getByRole("button", { name: "新增行动" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑行动：健康未安排" }));
    fireEvent.click(screen.getByRole("button", { name: "标记为完成：事业行动" }));
    fireEvent.change(screen.getByLabelText("日历领域"), { target: { value: work.id } });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(services.update).toHaveBeenCalledTimes(1);
    expect(services.toggle).not.toHaveBeenCalled();
    expect(screen.getByLabelText("日历领域")).toHaveProperty("value", "");
    expect(screen.getByLabelText("行动名称")).toHaveProperty("value", "保留原草稿");
    await act(async () => pending.reject(new Error("SQLITE_BUSY C:\\private\\lifeos.db")));
    expect((await screen.findByRole("alert")).textContent).toBe("保存失败，请重试。");
    expect(screen.queryByText(/SQLITE_BUSY/)).toBeNull();
    expect(screen.getByLabelText("行动名称")).toHaveProperty("value", "保留原草稿");
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(services.update).toHaveBeenLastCalledWith("health-action",
      expect.objectContaining({ title: "保留原草稿" }), undefined);
    await screen.findByRole("link", { name: "保留原草稿" });
  });

  it("keeps the mounted draft on an invalid route and prevents clearing its context until closed", async () => {
    const services = context();
    render(<Frame app={services.app} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑行动：健康行动" }));
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "不得丢失" } });
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("link", { name: "失效领域入口" }));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByLabelText("备注")).toHaveProperty("value", "不得丢失");
    fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
    expect(screen.getByLabelText("当前位置").textContent).toContain("domain=missing");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
    expect(screen.getByLabelText("当前位置").textContent).toBe("/calendar?extra=a&extra=b#original");
    expect(services.update).not.toHaveBeenCalled();
  });

  it("retains draft and original option/service ownership through loading, error and replacement", async () => {
    const previous = context(), current = context();
    const replacement = deferred<readonly Action[]>();
    const page = render(<Frame app={previous.app} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑行动：健康行动" }));
    fireEvent.change(screen.getByLabelText("行动名称"), { target: { value: "原记录修改" } });
    const dialog = screen.getByRole("dialog");
    current.list.mockReturnValueOnce(replacement.promise);
    current.domains.mockResolvedValue([work]);
    current.goals.mockResolvedValue([{ ...goal, title: "新空间目标" }]);
    page.rerender(<Frame app={current.app} />);
    expect(screen.getByText("正在读取日历")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBe(dialog);
    await act(async () => replacement.reject(new Error("SQLITE_BUSY C:\\private\\lifeos.db")));
    await screen.findByRole("heading", { name: "暂时无法打开日历" });
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByRole("option", { name: "健康目标" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "新空间目标" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("heading", { name: "日历", level: 1 });
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByLabelText("行动名称")).toHaveProperty("value", "原记录修改");
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(previous.update).toHaveBeenCalledExactlyOnceWith("health-action",
      expect.objectContaining({ title: "原记录修改" }), undefined);
    expect(current.update).not.toHaveBeenCalled();
    await waitFor(() => expect(current.list).toHaveBeenCalledTimes(3));
    expect(previous.list).toHaveBeenCalledTimes(1);
  });

  it("ignores stale initial reads after service replacement", async () => {
    const previous = context(), current = context();
    const oldRead = deferred<readonly Action[]>(), newRead = deferred<readonly Action[]>();
    previous.list.mockReturnValueOnce(oldRead.promise);
    current.list.mockReturnValueOnce(newRead.promise);
    const page = render(<Frame app={previous.app} />);
    page.rerender(<Frame app={current.app} />);
    await act(async () => oldRead.resolve([action("old", "过期行动", [])]));
    expect(screen.getByText("正在读取日历")).toBeTruthy();
    await act(async () => newRead.resolve([action("new", "当前行动", [])]));
    await screen.findByRole("link", { name: "当前行动" });
    expect(screen.queryByRole("link", { name: "过期行动" })).toBeNull();
  });

  for (const phase of ["unmount", "replace"] as const) {
    it.each(["success", "failure"] as const)(`does not reread or report a late toggle ${phase} %s`, async outcome => {
      const previous = context(), current = context();
      const pending = deferred<Action>();
      previous.toggle.mockReturnValueOnce(pending.promise);
      const page = render(<Frame app={previous.app} />);
      fireEvent.click(await screen.findByRole("button", { name: "标记为完成：健康行动" }));
      fireEvent.click(screen.getByRole("button", { name: "标记为完成：健康行动" }));
      fireEvent.click(screen.getByRole("button", { name: "新增行动" }));
      expect(previous.toggle).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).toBeNull();
      if (phase === "unmount") {
        page.unmount(); render(<Frame app={current.app} />);
      } else page.rerender(<Frame app={current.app} />);
      await screen.findByRole("heading", { name: "日历", level: 1 });
      await act(async () => {
        if (outcome === "success") pending.resolve(action("health-action", "健康行动", [health.id]));
        else pending.reject(new Error("SQLITE_BUSY C:\\private\\lifeos.db"));
      });
      expect(previous.list).toHaveBeenCalledTimes(1);
      expect(current.list).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("button", { name: "新增行动" })).toHaveProperty("disabled", false);
    });
  }

  it.each([
    [new Error("SQLITE_BUSY C:\\private\\lifeos.db"), "无法更新行动状态，请重试。"],
    [new ActionValidationError("这个行动已经不存在了。"), "这个行动已经不存在了。"],
  ] as const)("sanitizes storage errors and retains actionable completion validation", async (failure, message) => {
    const services = context();
    services.toggle.mockRejectedValueOnce(failure);
    render(<Frame app={services.app} />);
    fireEvent.click(await screen.findByRole("button", { name: "标记为完成：健康行动" }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(screen.getByRole("button", { name: "新增行动" })).toHaveProperty("disabled", false);
    expect(services.list).toHaveBeenCalledTimes(1);
  });
});
