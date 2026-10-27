import { cleanup, fireEvent, render as renderView, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { InboxConvertDialog } from "../../src/components/InboxConvertDialog";
import type { InboxItem } from "../../src/domain/inbox/InboxItem";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";
import type { InboxService } from "../../src/services/inbox/InboxService";

afterEach(cleanup);

function render(ui: ReactElement) {
  return renderView(createElement(MemoryRouter, null, ui));
}

const processingItem: InboxItem = {
  id: "capture-1",
  content: "安排体检",
  source: "inbox",
  status: "processing",
  targetType: "action",
  targetId: "inbox-capture-1",
  createdAt: "2026-09-23T08:00:00.000Z",
  updatedAt: "2026-09-23T08:00:00.000Z",
};

function showDialog(inboxService: Partial<InboxService>, onSaved = vi.fn()) {
  const value = { inboxService: { suggestObjects: vi.fn().mockResolvedValue([]), ...inboxService } } as LifeOSContextValue;
  render(createElement(LifeOSContext.Provider, { value },
    createElement(InboxConvertDialog, {
      item: processingItem, domains: [], goals: [], onClose: vi.fn(), onSaved,
      onStatusChanged: vi.fn(),
    }),
  ));
  return onSaved;
}

describe("Inbox conversion recovery dialog", () => {
  it("only finishes the inbox status when the formal action already exists", async () => {
    const finishProcessing = vi.fn().mockResolvedValue({ ...processingItem, status: "organized" });
    const convert = vi.fn();
    const onSaved = showDialog({
      hasReservedTarget: vi.fn().mockResolvedValue(true),
      finishProcessing,
      convert,
    });

    await screen.findByText(/正式行动已经保存/);
    expect(screen.queryByRole("textbox", { name: "行动名称" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "完成整理" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(finishProcessing).toHaveBeenCalledWith(processingItem.id);
    expect(convert).not.toHaveBeenCalled();
  });

  it("keeps the editable form when the formal action was not created", async () => {
    const convert = vi.fn().mockResolvedValue({ ...processingItem, status: "organized" });
    const finishProcessing = vi.fn();
    const onSaved = showDialog({
      hasReservedTarget: vi.fn().mockResolvedValue(false),
      finishProcessing,
      convert,
    });

    await screen.findByText(/上次未完成创建/);
    fireEvent.change(screen.getByRole("textbox", { name: "行动名称" }), {
      target: { value: "预约体检" },
    });
    fireEvent.click(screen.getByRole("button", { name: "继续整理" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(convert).toHaveBeenCalledWith(processingItem.id, expect.objectContaining({
      type: "action", draft: expect.objectContaining({ title: "预约体检" }),
    }));
    expect(finishProcessing).not.toHaveBeenCalled();
  });

  it("offers issue conversion with two domain links and the original description", async () => {
    const item: InboxItem = {
      ...processingItem, status: "unprocessed", targetType: null, targetId: null,
      content: "睡眠总是被工作打断",
    };
    const domains: LifeDomain[] = [
      { id: "health", name: "健康", description: "", focus: "", color: "fern", icon: "heart",
        longTermExpectation: "", currentState: "", status: "active",
        sortOrder: 0, createdAt: item.createdAt, updatedAt: item.updatedAt },
      { id: "work", name: "事业", description: "", focus: "", color: "ocean", icon: "briefcase",
        longTermExpectation: "", currentState: "", status: "active",
        sortOrder: 1, createdAt: item.createdAt, updatedAt: item.updatedAt },
    ];
    const convert = vi.fn().mockResolvedValue({ ...item, status: "organized" });
    const onSaved = vi.fn();
    const value = { inboxService: { convert, suggestObjects: vi.fn().mockResolvedValue([]) } as Partial<InboxService> } as LifeOSContextValue;
    render(createElement(LifeOSContext.Provider, { value },
      createElement(InboxConvertDialog, {
        item, domains, goals: [], onClose: vi.fn(), onSaved, onStatusChanged: vi.fn(),
      }),
    ));

    expect(screen.getByRole("button", { name: "问题" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("textbox", { name: "问题描述" }) as HTMLTextAreaElement).value)
      .toBe(item.content);
    fireEvent.click(screen.getByRole("checkbox", { name: "健康" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "事业" }));
    fireEvent.change(screen.getByLabelText("出现次数"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("首次发现"), { target: { value: "2026-09-20" } });
    fireEvent.click(screen.getByRole("button", { name: "确认整理" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(convert).toHaveBeenCalledWith(item.id, {
      type: "issue", draft: {
        title: item.content, description: item.content, firstSeen: "2026-09-20",
        occurrenceCount: 3, status: "open", goalId: null, domainIds: ["health", "work"],
        causeHypothesis: "", attempts: "", followUp: "",
      },
    });
  });

  it("offers a major decision dossier while preserving the captured background", async () => {
    const item: InboxItem = {
      ...processingItem, status: "unprocessed", targetType: null, targetId: null,
      content: "要不要调整工作节奏",
    };
    const convert = vi.fn().mockResolvedValue({ ...item, status: "organized" });
    const onSaved = vi.fn();
    const value = { inboxService: { convert, suggestObjects: vi.fn().mockResolvedValue([]) } as Partial<InboxService> } as LifeOSContextValue;
    render(createElement(LifeOSContext.Provider, { value },
      createElement(InboxConvertDialog, {
        item, domains: [], goals: [], onClose: vi.fn(), onSaved, onStatusChanged: vi.fn(),
      }),
    ));
    expect(screen.getByRole("button", { name: "决策" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("checkbox", { name: "重大决策档案" }));
    fireEvent.click(screen.getByRole("button", { name: "确认整理" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(convert).toHaveBeenCalledWith(item.id, {
      type: "decision", draft: expect.objectContaining({
        title: item.content, background: item.content, importance: "major", status: "considering",
      }),
    });
  });

  it("creates an event only after confirmation with an explicit person and date", async () => {
    const item: InboxItem = { ...processingItem, content: "重要事件：毕业",
      status: "unprocessed", targetType: null, targetId: null };
    const convert = vi.fn().mockResolvedValue({ ...item, status: "organized" });
    const onSaved = vi.fn();
    const listPeople = vi.fn().mockResolvedValue([{ id: "person-1", name: "小林", archived: false }]);
    const value = { inboxService: { convert, suggestObjects: vi.fn().mockResolvedValue([]) },
      lifeRecordsService: { listPeople } } as unknown as LifeOSContextValue;
    render(createElement(LifeOSContext.Provider, { value },
      createElement(InboxConvertDialog, { item, domains: [], goals: [],
        onClose: vi.fn(), onSaved, onStatusChanged: vi.fn() })));
    await screen.findByRole("option", { name: "小林" });
    expect(screen.getByRole("button", { name: "事件" }).getAttribute("aria-pressed")).toBe("true");
    expect(convert).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "事件标题" }), { target: { value: "毕业" } });
    fireEvent.change(screen.getByLabelText("发生日期"), { target: { value: "2026-09-22" } });
    fireEvent.change(screen.getByLabelText("相关人物"), { target: { value: "person-1" } });
    fireEvent.click(screen.getByRole("button", { name: "确认整理" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(convert).toHaveBeenCalledWith(item.id, { type: "event", draft: {
      title: "毕业", description: item.content, happenedOn: "2026-09-22",
      personId: "person-1", goalId: null, domainIds: [],
    } });
  });

  it("keeps person details optional and captures the original notes", async () => {
    const item: InboxItem = { ...processingItem, content: "认识了新朋友",
      status: "unprocessed", targetType: null, targetId: null };
    const convert = vi.fn().mockResolvedValue({ ...item, status: "organized" });
    const onSaved = vi.fn();
    const value = { inboxService: { convert, suggestObjects: vi.fn().mockResolvedValue([]) } } as unknown as LifeOSContextValue;
    render(createElement(LifeOSContext.Provider, { value },
      createElement(InboxConvertDialog, { item, domains: [], goals: [],
        onClose: vi.fn(), onSaved, onStatusChanged: vi.fn() })));
    expect(screen.getByRole("button", { name: "人物" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByRole("textbox", { name: "人物姓名" }), { target: { value: "小林" } });
    fireEvent.click(screen.getByRole("button", { name: "确认整理" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(convert).toHaveBeenCalledWith(item.id, { type: "person", draft: {
      name: "小林", notes: item.content, domainIds: [], relationshipType: "", state: "",
      importantDate: null, lastContact: null, sharedExperiences: "",
    } });
  });

  it("allows retrying the event people list without creating anything", async () => {
    const item: InboxItem = { ...processingItem, content: "重要事件",
      status: "unprocessed", targetType: null, targetId: null };
    const convert = vi.fn();
    const listPeople = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([{ id: "p", name: "小林", archived: true }]);
    const value = { inboxService: { convert, suggestObjects: vi.fn().mockResolvedValue([]) },
      lifeRecordsService: { listPeople } } as unknown as LifeOSContextValue;
    render(createElement(LifeOSContext.Provider, { value },
      createElement(InboxConvertDialog, { item, domains: [], goals: [],
        onClose: vi.fn(), onSaved: vi.fn(), onStatusChanged: vi.fn() })));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await screen.findByRole("option", { name: "小林（已归档）" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(convert).not.toHaveBeenCalled();
  });

  it("finishes an existing person without displaying a second creation form", async () => {
    const item: InboxItem = { ...processingItem, targetType: "person" };
    const finishProcessing = vi.fn().mockResolvedValue({ ...item, status: "organized" });
    const convert = vi.fn();
    const onSaved = vi.fn();
    const value = { inboxService: { hasReservedTarget: vi.fn().mockResolvedValue(true),
      finishProcessing, convert } } as unknown as LifeOSContextValue;
    render(createElement(LifeOSContext.Provider, { value },
      createElement(InboxConvertDialog, { item, domains: [], goals: [],
        onClose: vi.fn(), onSaved, onStatusChanged: vi.fn() })));
    await screen.findByText(/正式人物已经保存/);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "完成整理" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(finishProcessing).toHaveBeenCalledWith(item.id);
    expect(convert).not.toHaveBeenCalled();
  });

  it("keeps recommended dates and domain/goal links empty until explicitly adopted", async () => {
    const item: InboxItem = { ...processingItem, content: "明天安排健康的睡眠调整",
      status: "unprocessed", targetType: null, targetId: null };
    const domain = { id: "health", name: "健康" } as LifeDomain;
    const goal = { id: "sleep", title: "睡眠调整" } as import("../../src/domain/planning/Goal").Goal;
    const convert = vi.fn().mockResolvedValue({ ...item, status: "organized" });
    const suggestObjects = vi.fn().mockResolvedValue([
      { type: "goal", id: "sleep", name: "睡眠调整", state: "进行中",
        reason: "原文包含已有名称「睡眠调整」", href: "/goals#goal-sleep" },
      { type: "domain", id: "health", name: "健康", state: "",
        reason: "原文包含已有名称「健康」", href: "/domains/health" },
    ]);
    const onSaved = vi.fn();
    const value = { inboxService: { convert, suggestObjects } } as unknown as LifeOSContextValue;
    render(createElement(LifeOSContext.Provider, { value },
      createElement(InboxConvertDialog, { item, domains: [domain], goals: [goal],
        onClose: vi.fn(), onSaved, onStatusChanged: vi.fn() })));
    fireEvent.click(screen.getByText("整理建议"));
    await screen.findByRole("button", { name: "关联目标 睡眠调整" });
    expect((screen.getByLabelText("安排日期") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("关联目标") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("关联生活领域") as HTMLSelectElement).value).toBe("");
    expect(convert).not.toHaveBeenCalled();
    expect(screen.getByText(/以收集日期 2026-09-23 为参照/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "采用日期 2026-09-24" }));
    fireEvent.click(screen.getByRole("button", { name: "关联目标 睡眠调整" }));
    fireEvent.click(screen.getByRole("button", { name: "关联领域 健康" }));
    expect((screen.getByRole("button", { name: "已关联目标 睡眠调整" }) as HTMLButtonElement).disabled).toBe(true);
    expect(convert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认整理" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(convert).toHaveBeenCalledWith(item.id, { type: "action", draft: expect.objectContaining({
      goalId: "sleep", domainId: "health", scheduledFor: "2026-09-24",
    }) });
  });

  it("retries object recommendations without losing edited fields or applying dates", async () => {
    const item: InboxItem = { ...processingItem, content: "明天安排体检",
      status: "unprocessed", targetType: null, targetId: null };
    const suggestObjects = vi.fn().mockRejectedValueOnce(new Error("private sqlite path"))
      .mockResolvedValueOnce([]);
    const convert = vi.fn();
    const value = { inboxService: { convert, suggestObjects } } as unknown as LifeOSContextValue;
    render(createElement(LifeOSContext.Provider, { value },
      createElement(InboxConvertDialog, { item, domains: [], goals: [],
        onClose: vi.fn(), onSaved: vi.fn(), onStatusChanged: vi.fn() })));
    fireEvent.click(screen.getByText("整理建议"));
    await screen.findByText("已有对象建议暂时无法读取。");
    expect(screen.queryByText(/private sqlite path/)).toBeNull();
    fireEvent.change(screen.getByLabelText("行动名称"), { target: { value: "电话预约" } });
    fireEvent.click(screen.getByRole("button", { name: "重试匹配" }));
    await screen.findByText("没有名称匹配的已有对象。");
    expect((screen.getByLabelText("行动名称") as HTMLInputElement).value).toBe("电话预约");
    expect((screen.getByLabelText("安排日期") as HTMLInputElement).value).toBe("");
    expect(convert).not.toHaveBeenCalled();
  });
});
