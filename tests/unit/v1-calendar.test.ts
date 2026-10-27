import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext } from "../../src/app/LifeOSContext";
import { CalendarPage } from "../../src/pages/CalendarPage";
import { buildCalendarEntries, calendarDates, moveCalendarAnchor } from "../../src/domain/planning/Calendar";
import { localDate } from "../../src/domain/habits/Habit";
import { createReviewStructure } from "../../src/domain/reviews/ReviewStructure";

afterEach(cleanup);
it("uses Monday weeks, leap-month cells and year-safe navigation", () => {
  expect(calendarDates("2024-02-29", "agenda")).toEqual(["2024-02-26", "2024-02-27", "2024-02-28", "2024-02-29", "2024-03-01", "2024-03-02", "2024-03-03"]);
  const month = calendarDates("2024-02-29", "month");
  expect(month).toHaveLength(42);
  expect(month).toContain("2024-02-29");
  expect(month[0]).toBe("2024-01-29");
  expect(moveCalendarAnchor("2026-12-31", "month", 1)).toBe("2027-01-01");
});
it("aggregates saved sources and filters the Chinese agenda without mutating them", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  const today = localDate(new Date());
  const domain = await app.lifeDomainService.create({ name: "日历领域", description: "", focus: "", color: "fern", icon: "heart" });
  const goal = await app.goalService.create({ title: "月度截止", description: "", domainId: domain.id, status: "active", horizon: "month", targetDate: today });
  const action = await app.actionService.create({ title: "日历行动", notes: "", domainId: null, domainIds: [], goalId: goal.id, scheduledFor: today });
  const habit = await app.habitService.create({ title: "日历习惯", intention: "", weeklyTarget: 3, stableContext: "", triggerCondition: "", obstacle: "", adjustment: "", startOn: today, domainIds: [domain.id] });
  await app.habitService.saveLog(habit.id, today, true);
  await app.reviewService.create({ title: "日历复盘", reflection: "", insight: "", nextFocus: "", reviewedOn: today, domainId: null, goalIds: [goal.id], structure: createReviewStructure("weekly", today) });
  await app.lifeRecordsService.saveEvent({ title: "日历事件", happenedOn: today, description: "", domainIds: [], goalId: goal.id, personId: null });
  const sources = { goals: await app.goalService.list(), actions: await app.actionService.list(), habits: await app.habitService.list(), logs: await app.habitService.listLogs(), reviews: await app.reviewService.list(), events: await app.lifeRecordsService.listEvents() };
  const entries = buildCalendarEntries(sources, calendarDates(today, "week"), domain.id);
  expect(new Set(entries.map(entry => entry.kind)).size).toBe(5);
  expect(entries.filter(entry => entry.id.startsWith("habit-plan"))).toHaveLength(1);
  expect(entries.find(entry => entry.sourceId === action.id)?.href).toBe("/goals#action-" + action.id);
  const savedLog = sources.logs.find(log => log.habitId === habit.id)!;
  expect(entries.find(entry => entry.id === "habit-log-" + savedLog.id)?.href)
    .toBe("/habits#habit-log-" + encodeURIComponent(savedLog.id));
  expect(entries.find(entry => entry.id.startsWith("habit-plan-"))?.href)
    .toBe("/habits#habit-" + encodeURIComponent(habit.id));
  render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider, { value: app }, createElement(CalendarPage))));
  expect(await screen.findByRole("link", { name: "日历行动" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "议程" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("checkbox", { name: "行动" }));
  expect(screen.queryByRole("link", { name: "日历行动" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "月", exact: true }));
  expect(document.querySelectorAll(".calendar-date-cell")).toHaveLength(42);
  fireEvent.click(screen.getByRole("button", { name: "周", exact: true }));
  expect(document.querySelectorAll(".calendar-date-cell")).toHaveLength(7);
  fireEvent.click(screen.getByRole("checkbox", { name: "行动" }));
  fireEvent.click(screen.getByRole("button", { name: "标记为完成：日历行动" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "恢复为未完成：日历行动" })).toBeTruthy());
  expect((await app.actionService.findById(action.id))?.scheduledFor).toBe(today);
  expect((await app.goalService.findById(goal.id))?.targetDate).toBe(today);
});

