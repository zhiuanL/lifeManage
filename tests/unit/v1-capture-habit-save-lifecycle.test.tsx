import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { HabitEditorDialog } from "../../src/components/HabitEditorDialog";
import { InboxConvertDialog } from "../../src/components/InboxConvertDialog";
import { inboxChangedEvent, QuickCapture } from "../../src/components/QuickCapture";
import { HabitValidationError, normalizeHabit, type Habit } from "../../src/domain/habits/Habit";
import { InboxValidationError, validateInboxContent, type InboxItem } from "../../src/domain/inbox/InboxItem";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";
import { HabitsPage } from "../../src/pages/HabitsPage";
import { InboxPage } from "../../src/pages/InboxPage";
import { HabitService } from "../../src/services/habits/HabitService";
import type { HabitRepository } from "../../src/repositories/habits/HabitRepository";
import type { LifeDomainRepository } from "../../src/repositories/life/LifeDomainRepository";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const timestamp = "2026-10-22T08:00:00Z";
const habit: Habit = {
  id: "habit-a", title: "散步", intention: "", weeklyTarget: 3, stableContext: "",
  triggerCondition: "", obstacle: "", adjustment: "", startOn: "2026-01-01",
  domainIds: ["health"], archived: false, createdAt: timestamp, updatedAt: timestamp,
};
const domain: LifeDomain = {
  id: "health", name: "健康", description: "", focus: "", color: "fern", icon: "heart",
  longTermExpectation: "", currentState: "", status: "active", sortOrder: 0,
  createdAt: timestamp, updatedAt: timestamp,
};
const item: InboxItem = {
  id: "capture-a", content: "安排散步", source: "inbox", status: "unprocessed",
  targetType: null, targetId: null, createdAt: timestamp, updatedAt: timestamp,
};
const storageError = new Error("SQLITE_BUSY C:\\private\\lifeos.db");
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function services() {
  return {
    habitService: {
      list: vi.fn().mockResolvedValue([habit]), listLogs: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(habit), update: vi.fn().mockResolvedValue(habit),
      saveLog: vi.fn().mockResolvedValue(undefined), setArchived: vi.fn().mockResolvedValue(undefined),
    },
    lifeDomainService: { list: vi.fn().mockResolvedValue([domain]) },
    goalService: { list: vi.fn().mockResolvedValue([]) },
    templateService: { find: vi.fn().mockResolvedValue(null) },
    lifeRecordsService: { listPeople: vi.fn().mockResolvedValue([]) },
    inboxService: {
      list: vi.fn().mockResolvedValue([item]), capture: vi.fn().mockResolvedValue(item),
      archive: vi.fn().mockResolvedValue(undefined), restore: vi.fn().mockResolvedValue(undefined),
      convert: vi.fn().mockResolvedValue({ ...item, status: "organized" }),
      hasReservedTarget: vi.fn().mockResolvedValue(false),
      finishProcessing: vi.fn().mockResolvedValue({ ...item, status: "organized" }),
      suggestObjects: vi.fn().mockResolvedValue([]),
    },
  };
}
function Host({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output aria-label="当前位置">{location.search + location.hash}</output>
    <button onClick={() => navigate("?domain=missing&tag=one&tag=two#source")}>失效领域链接</button>
    {children}</>;
}
function tree(value: ReturnType<typeof services>, children: ReactNode, path = "/") {
  return <MemoryRouter initialEntries={[path]}>
    <LifeOSContext.Provider value={value as unknown as LifeOSContextValue}>
      <Host>{children}</Host>
    </LifeOSContext.Provider>
  </MemoryRouter>;
}

it("distinguishes habit and capture input rules from repository errors", async () => {
  expect(() => normalizeHabit({ ...habit, title: "" }, "2026-10-22")).toThrow(HabitValidationError);
  expect(() => validateInboxContent(" ")).toThrow(InboxValidationError);
  const repository = {
    list: vi.fn().mockResolvedValue([habit]), listLogs: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockRejectedValue(storageError),
  };
  const domains = { findById: vi.fn().mockResolvedValue(domain) };
  const service = new HabitService(repository as unknown as HabitRepository,
    domains as unknown as LifeDomainRepository, { now: () => new Date(timestamp) }, { next: () => "new" });
  await expect(service.create(habit)).rejects.toBe(storageError);
  domains.findById.mockResolvedValue(null);
  await expect(service.create(habit)).rejects.toBeInstanceOf(HabitValidationError);
  expect(repository.create).toHaveBeenCalledOnce();
});

it("quick capture keeps the original service and draft, locks fields, and retries with the latest callback", async () => {
  const original = services(), replacement = services();
  const saving = deferred<InboxItem>();
  original.inboxService.capture.mockReturnValueOnce(saving.promise);
  const oldClose = vi.fn(), latestClose = vi.fn();
  const view = render(tree(original, <QuickCapture onClose={oldClose} />));
  fireEvent.change(screen.getByLabelText("记录内容"), { target: { value: "  原文\n不先分类  " } });
  const form = screen.getByLabelText("记录内容").closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(original.inboxService.capture).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("记录内容")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("记录内容"), { target: { value: "覆盖" } });
  view.rerender(tree(replacement, <QuickCapture onClose={latestClose} />));
  await act(async () => { saving.reject(storageError); });
  expect(screen.getByRole("alert")).toHaveTextContent("暂时无法保存，请重试。");
  expect(screen.getByLabelText("记录内容")).toHaveValue("  原文\n不先分类  ");
  expect(screen.queryByText(/SQLITE_BUSY/)).toBeNull();
  fireEvent.submit(form);
  await waitFor(() => expect(latestClose).toHaveBeenCalledOnce());
  expect(oldClose).not.toHaveBeenCalled();
  expect(replacement.inboxService.capture).not.toHaveBeenCalled();
  expect(original.inboxService.capture).toHaveBeenLastCalledWith("  原文\n不先分类  ", "quick-capture");
});

it("quick capture does not emit refresh or close callbacks after unmount", async () => {
  const value = services(), saving = deferred<InboxItem>(), close = vi.fn(), changed = vi.fn();
  value.inboxService.capture.mockReturnValue(saving.promise);
  window.addEventListener(inboxChangedEvent, changed);
  try {
    const view = render(tree(value, <QuickCapture onClose={close} />));
    fireEvent.change(screen.getByLabelText("记录内容"), { target: { value: "记住原文" } });
    fireEvent.submit(screen.getByLabelText("记录内容").closest("form")!);
    view.unmount();
    await act(async () => { saving.resolve(item); });
    expect(close).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  } finally { window.removeEventListener(inboxChangedEvent, changed); }
});

it.each(["missing", ""])("habit scope '%s' must be explicitly cleared without losing repeated params", async id => {
  render(tree(services(), <HabitsPage />, `/habits?domain=${id}&tag=one&tag=two#source`));
  await screen.findByRole("heading", { name: "无法按当前领域查看习惯" });
  expect(screen.queryByRole("heading", { name: "散步" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
  await screen.findByRole("heading", { name: "散步" });
  expect(screen.getByLabelText("当前位置")).toHaveTextContent("?tag=one&tag=two#source");
});

it("habit editor keeps its original record, candidates and service across reload errors and invalid routes", async () => {
  const original = services(), replacement = services(), save = deferred<Habit>();
  original.habitService.update.mockReturnValueOnce(save.promise);
  const view = render(tree(original, <HabitsPage />, "/habits?domain=health"));
  fireEvent.click(await screen.findByRole("button", { name: "编辑习惯：散步" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("习惯名称"), { target: { value: "饭后散步" } });
  replacement.habitService.list.mockRejectedValue(storageError);
  view.rerender(tree(replacement, <HabitsPage />, "/habits?domain=health"));
  await screen.findByRole("heading", { name: "暂时无法打开习惯" });
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(within(dialog).getByLabelText("习惯名称")).toHaveValue("饭后散步");
  replacement.habitService.list.mockResolvedValue([]);
  replacement.lifeDomainService.list.mockResolvedValue([]);
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByRole("heading", { name: "无法按当前领域查看习惯" });
  expect(within(dialog).getByLabelText("健康")).toBeChecked();
  expect(screen.getByRole("button", { name: "清除失效筛选" })).toBeDisabled();
  fireEvent.submit(within(dialog).getByLabelText("习惯名称").closest("form")!);
  fireEvent.change(within(dialog).getByLabelText("习惯名称"), { target: { value: "覆盖" } });
  await act(async () => { save.reject(new HabitValidationError("开始日期不能晚于已经记录的打卡日期。")); });
  expect(within(dialog).getByRole("alert")).toHaveTextContent("开始日期不能晚于");
  expect(within(dialog).getByLabelText("习惯名称")).toHaveValue("饭后散步");
  expect(original.habitService.update).toHaveBeenCalledWith(habit.id, expect.objectContaining({ title: "饭后散步" }));
  expect(replacement.habitService.update).not.toHaveBeenCalled();
});

it("habit log failure preserves adjustment text without reloading or leaking storage errors", async () => {
  const value = services(), saving = deferred<void>();
  value.habitService.saveLog.mockReturnValueOnce(saving.promise);
  render(tree(value, <HabitsPage />));
  await screen.findByRole("heading", { name: "散步" });
  const adjustment = screen.getByLabelText("接下来的调整");
  fireEvent.change(adjustment, { target: { value: "改成室内走动" } });
  const form = adjustment.closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(adjustment).toBeDisabled();
  fireEvent.change(adjustment, { target: { value: "覆盖" } });
  expect(value.habitService.saveLog).toHaveBeenCalledOnce();
  await act(async () => { saving.reject(storageError); });
  expect(screen.getByRole("alert")).toHaveTextContent("操作失败，请重试。");
  expect(adjustment).toHaveValue("改成室内走动");
  expect(value.habitService.list).toHaveBeenCalledOnce();
});

it("habit dialog does not notify a departed parent", async () => {
  const value = services(), saving = deferred<Habit>(), saved = vi.fn();
  value.habitService.update.mockReturnValueOnce(saving.promise);
  const view = render(tree(value, <HabitEditorDialog habit={habit} domains={[domain]}
    defaultDomainId="health" onClose={vi.fn()} onSaved={saved} />));
  fireEvent.submit(screen.getByLabelText("习惯名称").closest("form")!);
  view.unmount();
  await act(async () => { saving.resolve(habit); });
  expect(saved).not.toHaveBeenCalled();
});

it("inbox capture failure preserves original input, suppresses duplicate saves and does not reread", async () => {
  const value = services(), saving = deferred<InboxItem>();
  value.inboxService.capture.mockReturnValueOnce(saving.promise);
  render(tree(value, <InboxPage />));
  const input = await screen.findByLabelText("记录内容");
  fireEvent.change(input, { target: { value: "  未分类原文  " } });
  fireEvent.submit(input.closest("form")!); fireEvent.submit(input.closest("form")!);
  fireEvent.change(input, { target: { value: "覆盖" } });
  expect(input).toBeDisabled();
  expect(value.inboxService.capture).toHaveBeenCalledOnce();
  await act(async () => { saving.reject(storageError); });
  expect(screen.getByRole("alert")).toHaveTextContent("保存失败，请重试。");
  expect(input).toHaveValue("  未分类原文  ");
  expect(value.inboxService.list).toHaveBeenCalledOnce();
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(value.inboxService.list).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByLabelText("记录内容")).toHaveValue(""));
});

it("inbox conversion stays mounted when a refresh fails, and preserves the reserved record for retry", async () => {
  const value = services(), saving = deferred<InboxItem>();
  value.inboxService.convert.mockReturnValueOnce(saving.promise);
  const view = render(tree(value, <InboxPage />));
  fireEvent.click(await screen.findByRole("button", { name: "整理" }));
  const dialog = screen.getByRole("dialog");
  const title = within(dialog).getByLabelText("行动名称");
  fireEvent.change(title, { target: { value: "晚饭后散步" } });
  value.inboxService.list.mockRejectedValueOnce(storageError);
  await act(async () => { window.dispatchEvent(new Event(inboxChangedEvent)); });
  await screen.findByRole("heading", { name: "暂时无法打开收集箱" });
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(title).toHaveValue("晚饭后散步");
  fireEvent.submit(title.closest("form")!); fireEvent.submit(title.closest("form")!);
  fireEvent.change(title, { target: { value: "覆盖" } });
  expect(value.inboxService.convert).toHaveBeenCalledOnce();
  const reserved: InboxItem = { ...item, status: "processing", targetType: "action", targetId: `inbox-${item.id}` };
  value.inboxService.list.mockResolvedValue([reserved]);
  await act(async () => { saving.reject(storageError); });
  await screen.findByText("上次未完成创建，请确认下方内容后继续。");
  const recoveredTitle = within(dialog).getByLabelText("行动名称");
  expect(recoveredTitle).toHaveValue("晚饭后散步");
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(within(dialog).getByRole("alert")).toHaveTextContent("整理失败，请重试。");
  fireEvent.submit(recoveredTitle.closest("form")!);
  await waitFor(() => expect(value.inboxService.convert).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(value.inboxService.convert).toHaveBeenLastCalledWith(item.id,
    expect.objectContaining({ draft: expect.objectContaining({ title: "晚饭后散步" }) }));
  view.unmount();
});

it("conversion retains original service and id but uses the latest mounted callback", async () => {
  const original = services(), replacement = services(), saving = deferred<InboxItem>();
  original.inboxService.convert.mockReturnValueOnce(saving.promise);
  const oldSaved = vi.fn(), latestSaved = vi.fn();
  const props = { item, domains: [domain], goals: [], onClose: vi.fn(), onStatusChanged: vi.fn() };
  const view = render(tree(original, <InboxConvertDialog {...props} onSaved={oldSaved} />));
  fireEvent.submit(screen.getByLabelText("行动名称").closest("form")!);
  view.rerender(tree(replacement, <InboxConvertDialog {...props}
    item={{ ...item, id: "other-record" }} onSaved={latestSaved} />));
  await act(async () => { saving.resolve({ ...item, status: "organized" }); });
  expect(latestSaved).toHaveBeenCalledOnce();
  expect(oldSaved).not.toHaveBeenCalled();
  expect(original.inboxService.convert).toHaveBeenCalledWith(item.id, expect.anything());
  expect(replacement.inboxService.convert).not.toHaveBeenCalled();
});

it("conversion does not reread recovery or notify a parent after unmount", async () => {
  const value = services(), saving = deferred<InboxItem>(), saved = vi.fn(), changed = vi.fn();
  value.inboxService.convert.mockReturnValue(saving.promise);
  const view = render(tree(value, <InboxConvertDialog item={item} domains={[]} goals={[]}
    onClose={vi.fn()} onSaved={saved} onStatusChanged={changed} />));
  fireEvent.submit(screen.getByLabelText("行动名称").closest("form")!);
  view.unmount();
  await act(async () => { saving.reject(storageError); });
  expect(saved).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  expect(value.inboxService.list).not.toHaveBeenCalled();
});
