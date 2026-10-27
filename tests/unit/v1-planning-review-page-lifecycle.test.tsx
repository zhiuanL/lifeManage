import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { ReviewEditorDialog } from "../../src/components/ReviewEditorDialog";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";
import type { Action } from "../../src/domain/planning/Action";
import type { Goal } from "../../src/domain/planning/Goal";
import type { Review } from "../../src/domain/reviews/Review";
import { GoalsPage } from "../../src/pages/GoalsPage";
import { ReviewsPage } from "../../src/pages/ReviewsPage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const stamp = "2026-10-22T08:00:00.000Z";
const domain: LifeDomain = { id: "health", name: "健康", description: "", focus: "",
  currentState: "", longTermExpectation: "", color: "fern", icon: "heart", status: "active",
  sortOrder: 0, createdAt: stamp, updatedAt: stamp };
const goal: Goal = { id: "goal", title: "原目标", description: "", domainId: domain.id,
  domainIds: [domain.id], parentId: null, status: "active", targetDate: null,
  sortOrder: 0, completedAt: null, createdAt: stamp, updatedAt: stamp };
const action: Action = { id: "action", title: "原行动", notes: "", domainId: domain.id,
  domainIds: [domain.id], goalId: goal.id, scheduledFor: null, status: "open",
  sortOrder: 0, completedAt: null, createdAt: stamp, updatedAt: stamp };
const review: Review = { id: "review", title: "原回顾", reflection: "", insight: "", nextFocus: "",
  domainId: domain.id, domainIds: [domain.id], goalIds: [], issueIds: [],
  reviewedOn: "2026-10-22", createdAt: stamp, updatedAt: stamp };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function context() {
  const services = {
    lifeDomainService: { list: vi.fn(async () => [domain]) },
    goalService: { list: vi.fn(async () => [goal]), update: vi.fn(async () => goal), create: vi.fn(async () => goal) },
    actionService: { list: vi.fn(async () => [action]), update: vi.fn(async () => action),
      create: vi.fn(async () => action), toggleCompletion: vi.fn(async () => action) },
    goalProgressItemService: { list: vi.fn(async () => []), replace: vi.fn(async () => []) },
    habitService: { list: vi.fn(async () => []), listLogs: vi.fn(async () => []) },
    lifeNavigationService: { list: vi.fn(async () => []) },
    reviewService: { list: vi.fn(async () => [review]), update: vi.fn(async () => review),
      create: vi.fn(async () => review) },
    issueService: { list: vi.fn(async () => []) },
    templateService: { getDefaultTemplate: vi.fn(async () => null), find: vi.fn(async () => null) },
    reviewFactService: { generate: vi.fn(async () => ({ answers: {}, omitted: 0 })) },
  };
  return { services, app: services as unknown as LifeOSContextValue };
}
function Host({ kind }: { kind: "goals" | "reviews" }) {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  return <>
    <output aria-label="当前位置">{pathname}{search}{hash}</output>
    <button onClick={() => void navigate(`/${kind}?domain=missing&keep=a&keep=b#source`)}>失效入口</button>
    {kind === "goals" ? <GoalsPage /> : <ReviewsPage />}
  </>;
}
function Frame({ app, kind, path = `/${kind}` }: {
  app: LifeOSContextValue; kind: "goals" | "reviews"; path?: string;
}) {
  return <MemoryRouter initialEntries={[path]}><LifeOSContext.Provider value={app}>
    <Host kind={kind} />
  </LifeOSContext.Provider></MemoryRouter>;
}

describe.each(["goals", "reviews"] as const)("%s page context and read ownership", kind => {
  const heading = kind === "goals" ? "无法按当前领域查看目标与行动" : "无法按当前领域查看回顾";
  const edit = kind === "goals" ? "编辑行动：原行动" : "编辑回顾：原回顾";
  const title = kind === "goals" ? "行动名称" : "标题";

  it.each(["", "missing"])("blocks explicit invalid domain '%s' and preserves other URL values on recovery", async id => {
    const { app } = context();
    render(<Frame app={app} kind={kind} path={`/${kind}?domain=${id}&keep=a&keep=b#source`} />);
    await screen.findByRole("heading", { name: heading });
    expect(screen.queryByRole("button", { name: edit })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
    await screen.findByRole("button", { name: edit });
    expect(screen.getByLabelText("当前位置").textContent).toBe(`/${kind}?keep=a&keep=b#source`);
  });

  it("retains the same draft on an invalid route without exposing global records", async () => {
    const { app, services } = context();
    render(<Frame app={app} kind={kind} />);
    fireEvent.click(await screen.findByRole("button", { name: edit }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(screen.getByLabelText(title), { target: { value: "保留草稿" } });
    fireEvent.change(screen.getByLabelText("按生活领域筛选"), { target: { value: "" } });
    expect(screen.getByLabelText("当前位置").textContent).toBe(`/${kind}`);
    fireEvent.click(screen.getByRole("button", { name: "失效入口" }));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByLabelText(title)).toHaveProperty("value", "保留草稿");
    expect(screen.getByRole("button", { name: "清除失效筛选" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: edit })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const update = kind === "goals" ? services.actionService.update : services.reviewService.update;
    expect(update).toHaveBeenCalledWith(kind === "goals" ? action.id : review.id,
      expect.objectContaining({ title: "保留草稿" }), ...(kind === "goals" ? [undefined] : []));
  });

  it("keeps the editor and original candidates through replacement loading, failure and retry", async () => {
    const original = context(), replacement = context();
    const reading = deferred<LifeDomain[]>();
    replacement.services.lifeDomainService.list.mockReturnValueOnce(reading.promise);
    replacement.services.lifeDomainService.list.mockResolvedValue([{ ...domain, id: "new", name: "新领域" }]);
    const view = render(<Frame app={original.app} kind={kind} />);
    fireEvent.click(await screen.findByRole("button", { name: edit }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(screen.getByLabelText(title), { target: { value: "原来源草稿" } });
    view.rerender(<Frame app={replacement.app} kind={kind} />);
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.queryByRole("button", { name: edit })).toBeNull();
    expect(screen.getByRole("checkbox", { name: domain.name })).toBeTruthy();
    await act(async () => reading.reject(new Error("SQL C:\\private\\life.db")));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.queryByText(/private/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试", exact: true }));
    await waitFor(() => expect(screen.queryByText("正在整理你的回顾记录")).toBeNull());
    expect(screen.getByRole("checkbox", { name: domain.name })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "新领域" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const oldUpdate = kind === "goals" ? original.services.actionService.update : original.services.reviewService.update;
    const newUpdate = kind === "goals" ? replacement.services.actionService.update : replacement.services.reviewService.update;
    expect(oldUpdate).toHaveBeenCalledTimes(1);
    expect(newUpdate).not.toHaveBeenCalled();
  });

  it("ignores late reads from the previous source", async () => {
    const original = context(), replacement = context();
    const reading = deferred<LifeDomain[]>();
    original.services.lifeDomainService.list.mockReturnValueOnce(reading.promise);
    const view = render(<Frame app={original.app} kind={kind} />);
    view.rerender(<Frame app={replacement.app} kind={kind} />);
    await screen.findByRole("button", { name: edit });
    await act(async () => reading.reject(new Error("old source")));
    expect(screen.getByRole("button", { name: edit })).toBeTruthy();
    expect(screen.queryByText("old source")).toBeNull();
  });
});

it("keeps visible action records after a failed toggle without another read", async () => {
  const { app, services } = context();
  services.actionService.toggleCompletion.mockRejectedValueOnce(new Error("SQL private"));
  render(<Frame app={app} kind="goals" />);
  fireEvent.click(await screen.findByRole("button", { name: "标记为完成：原行动" }));
  expect((await screen.findByRole("alert")).textContent).toBe("无法更新行动状态，请重试。");
  expect(screen.getByRole("button", { name: "编辑行动：原行动" })).toBeTruthy();
  expect(services.actionService.list).toHaveBeenCalledTimes(1);
});

it("does not reload the replaced action service when an old toggle completes", async () => {
  const original = context(), replacement = context();
  const saving = deferred<Action>();
  original.services.actionService.toggleCompletion.mockReturnValueOnce(saving.promise);
  const view = render(<Frame app={original.app} kind="goals" />);
  fireEvent.click(await screen.findByRole("button", { name: "标记为完成：原行动" }));
  view.rerender(<Frame app={replacement.app} kind="goals" />);
  await waitFor(() => expect(replacement.services.actionService.list).toHaveBeenCalledTimes(1));
  await act(async () => saving.resolve(action));
  expect(original.services.actionService.list).toHaveBeenCalledTimes(1);
  expect(replacement.services.actionService.list).toHaveBeenCalledTimes(1);
});

it.each(["cycle=bad", "status=bad"])("requires explicit recovery for review filter %s", async query => {
  const { app, services } = context();
  render(<Frame app={app} kind="reviews" path={`/reviews?${query}&create=review&keep=a&keep=b#source`} />);
  await screen.findByRole("heading", { name: "无法按当前周期或状态查看回顾" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(services.templateService.getDefaultTemplate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "清除失效状态筛选" }));
  await screen.findByRole("dialog");
  await waitFor(() => expect(screen.getByLabelText("当前位置").textContent).toBe("/reviews?keep=a&keep=b#source"));
});

it("retries the original review and calls the latest mounted callback while locking its draft", async () => {
  const original = context(), replacement = context();
  const saving = deferred<Review>();
  original.services.reviewService.update.mockReturnValueOnce(saving.promise);
  const firstSaved = vi.fn(), latestSaved = vi.fn(), onClose = vi.fn();
  function Editor({ app, saved }: { app: LifeOSContextValue; saved: typeof firstSaved }) {
    return <MemoryRouter><LifeOSContext.Provider value={app}>
      <ReviewEditorDialog review={app === original.app ? review : { ...review, id: "new" }}
        domains={app === original.app ? [domain] : []} onSaved={saved} onClose={onClose} />
    </LifeOSContext.Provider></MemoryRouter>;
  }
  const view = render(<Editor app={original.app} saved={firstSaved} />);
  fireEvent.change(screen.getByLabelText("标题"), { target: { value: "固定草稿" } });
  const form = screen.getByRole("dialog").querySelector("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  fireEvent.change(screen.getByLabelText("标题"), { target: { value: "不能替换" } });
  fireEvent.keyDown(window, { key: "Escape" });
  view.rerender(<Editor app={replacement.app} saved={latestSaved} />);
  expect(screen.getByLabelText("标题")).toHaveProperty("value", "固定草稿");
  expect(form.getAttribute("aria-busy")).toBe("true");
  expect(original.services.reviewService.update).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => saving.reject(new Error("SQL private")));
  expect((await screen.findByRole("alert")).textContent).toBe("保存回顾失败，请重试。");
  fireEvent.submit(form);
  await waitFor(() => expect(latestSaved).toHaveBeenCalledWith(review));
  expect(firstSaved).not.toHaveBeenCalled();
  expect(replacement.services.reviewService.update).not.toHaveBeenCalled();
  expect(original.services.reviewService.update).toHaveBeenLastCalledWith(review.id,
    expect.objectContaining({ title: "固定草稿" }));
});
