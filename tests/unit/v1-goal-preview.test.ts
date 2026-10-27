import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { GoalPreview } from "../../src/components/GoalPreview";
import type { Goal } from "../../src/domain/planning/Goal";
import type { Action } from "../../src/domain/planning/Action";
import { GoalsPage } from "../../src/pages/GoalsPage";

afterEach(cleanup);
const goal: Goal = { id: "root", title: "年度方向", description: "留出学习时间", domainId: null,
  domainIds: [], parentId: null, status: "active", targetDate: null, sortOrder: 0,
  completedAt: null, createdAt: "2026-10-12", updatedAt: "2026-10-12" };
const child: Goal = { ...goal, id: "child", title: "季度重点", parentId: "root", progressWeight: 3 };
const action: Action = { id: "step", title: "阅读一章", notes: "", domainId: null, domainIds: [],
  goalId: "root", scheduledFor: null, status: "open", sortOrder: 0, completedAt: null,
  createdAt: "2026-10-12", updatedAt: "2026-10-12" };
function context() {
  return { goalService: { list: vi.fn().mockResolvedValue([goal, child]) },
    actionService: { list: vi.fn().mockResolvedValue([action]), toggleCompletion: vi.fn() },
    lifeDomainService: { list: vi.fn().mockResolvedValue([]) },
    goalProgressItemService: { list: vi.fn().mockResolvedValue([]) },
    habitService: { list: vi.fn().mockResolvedValue([]), listLogs: vi.fn().mockResolvedValue([]) }
  } as unknown as LifeOSContextValue;
}
function page(entries = ["/goals"]) {
  const value = context();
  render(createElement(MemoryRouter, { initialEntries: entries },
    createElement(LifeOSContext.Provider, { value }, createElement(GoalsPage))));
  return value;
}

describe("V1 read-only goal preview", () => {
  it("shows facts, unknown progress and related objects without editable fields", () => {
    render(createElement(MemoryRouter, null, createElement(GoalPreview, {
      goal, goals: [goal, child], actions: [action], domains: [], onClose: vi.fn(),
      progress: { percent: null, childGoalCount: 1, actionCount: 1 },
    })));
    const preview = screen.getByRole("complementary", { name: goal.title });
    expect(within(preview).getByText("暂无可用进度")).toBeTruthy();
    expect(within(preview).getByText("中")).toBeTruthy();
    expect(within(preview).getByText("未设置")).toBeTruthy();
    expect(within(preview).getByText("未关联")).toBeTruthy();
    expect(within(preview).getByRole("link", { name: child.title }).getAttribute("href")).toBe("/goals#goal-child");
    expect(within(preview).getByRole("link", { name: action.title }).getAttribute("href")).toBe("/goals#action-step");
    expect(preview.querySelector("input, textarea, select, form")).toBeNull();
    expect(document.activeElement).toBe(within(preview).getByRole("heading", { name: goal.title }));
  });

  it("shows parent, contribution weight, empty relationships and removes Escape listener", () => {
    const close = vi.fn();
    const view = render(createElement(MemoryRouter, null, createElement(GoalPreview, {
      goal: child, goals: [goal, child], actions: [], domains: [], onClose: close,
      progress: { percent: 0, childGoalCount: 0, actionCount: 0 },
    })));
    expect(screen.getByText(goal.title)).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.getByText("暂无下级目标")).toBeTruthy();
    expect(screen.getByText("暂无关联行动")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
    view.unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("opens on title click and restores actions and keyboard focus on close without mutations", async () => {
    const value = page();
    const trigger = await screen.findByRole("button", { name: "查看目标：年度方向" });
    fireEvent.click(trigger);
    expect(screen.getByRole("complementary", { name: goal.title })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "行动清单" })).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByRole("heading", { name: "行动清单" })).toBeTruthy();
    expect(document.activeElement).toBe(trigger);
    expect(value.actionService.toggleCompletion).not.toHaveBeenCalled();
  });

  it("switches to a child preview without scrolling away from it", async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    try {
      page();
      fireEvent.click(await screen.findByRole("button", { name: "查看目标：年度方向" }));
      fireEvent.click(within(screen.getByRole("complementary", { name: goal.title }))
        .getByRole("link", { name: child.title }));
      await screen.findByRole("complementary", { name: child.title });
      expect(scroll).not.toHaveBeenCalled();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.getByRole("heading", { name: "行动清单" })).toBeTruthy();
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", original);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  it("does not close the preview when an overlaid editor handles Escape", () => {
    const close = vi.fn();
    render(createElement(MemoryRouter, null, createElement(GoalPreview, {
      goal, goals: [goal], actions: [], domains: [], suspended: true, onClose: close,
    })));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
  });

  it("follows an action from preview back to its list", async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    try {
      page();
      fireEvent.click(await screen.findByRole("button", { name: "查看目标：年度方向" }));
      const preview = await screen.findByRole("complementary", { name: goal.title });
      fireEvent.click(within(preview).getByRole("link", { name: action.title }));
      await screen.findByRole("heading", { name: "行动清单" });
      expect(screen.queryByRole("complementary")).toBeNull();
      expect(scroll).toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", original);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });
});
