import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import type { Issue } from "../../src/domain/issues/Issue";
import type { Decision } from "../../src/domain/decisions/Decision";
import type { Review } from "../../src/domain/reviews/Review";
import { IssuesPage } from "../../src/pages/IssuesPage";
import { DecisionsPage } from "../../src/pages/DecisionsPage";
import { ReviewsPage } from "../../src/pages/ReviewsPage";

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

const timestamp = "2026-10-14T08:00:00.000Z";
const issue: Issue = {
  id: "问题 &1", title: "已解决的作息问题", description: "", firstSeen: "2026-10-01",
  occurrenceCount: 1, causeHypothesis: "", attempts: "", followUp: "", status: "resolved",
  goalId: null, domainIds: [], createdAt: timestamp, updatedAt: timestamp,
};
const decision: Decision = {
  id: "决策 &1", title: "已经选择的安排", decidedOn: "2026-10-01", importance: "ordinary",
  status: "decided", background: "", options: "", constraints: "", criteria: "", risks: "",
  opportunityCost: "", reversibility: "unknown", choice: "", rationale: "",
  executionConditions: "", outcome: "", reflection: "", goalId: null, domainIds: [],
  createdAt: timestamp, updatedAt: timestamp,
};
const review: Review = {
  id: "复盘 &1", title: "周末回顾", reflection: "", insight: "", nextFocus: "",
  domainId: null, domainIds: [], reviewedOn: "2026-10-01", createdAt: timestamp, updatedAt: timestamp,
};

function SourceNavigation({ href }: { href: string }) {
  const navigate = useNavigate();
  return createElement("button", { onClick: () => void navigate(href) }, "打开建议来源");
}

function show(page: ReactElement, path: string, source: string) {
  const value = {
    issueService: { list: vi.fn().mockResolvedValue([issue]) },
    decisionService: { list: vi.fn().mockResolvedValue([decision]) },
    reviewService: { list: vi.fn().mockResolvedValue([review]) },
    lifeDomainService: { list: vi.fn().mockResolvedValue([]) },
    goalService: { list: vi.fn().mockResolvedValue([]) },
    lifeNavigationService: { list: vi.fn().mockResolvedValue([]) },
    lifeRecordsService: { listPeople: vi.fn().mockResolvedValue([]) },
    resourceService: { list: vi.fn().mockResolvedValue([]) },
  } as unknown as LifeOSContextValue;
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
  render(createElement(MemoryRouter, { initialEntries: [path] },
    createElement(LifeOSContext.Provider, { value }, page,
      createElement(SourceNavigation, { href: source }))));
  return scroll;
}

describe("Inbox recommended-object source navigation", () => {
  it("shows and decodes a resolved issue source, then lets the user return to active issues", async () => {
    const source = `/issues#issue-${encodeURIComponent(issue.id)}`;
    const scroll = show(createElement(IssuesPage), source, source);
    await screen.findByRole("heading", { name: issue.title });
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: "全部" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "进行中" }));
    expect(screen.queryByRole("heading", { name: issue.title })).toBeNull();
    expect(screen.getByRole("tab", { name: "进行中" }).getAttribute("aria-selected")).toBe("true");
  });

  it("opens a decided source even when a previous same-page filter was considering", async () => {
    const source = `/decisions#decision-${encodeURIComponent(decision.id)}`;
    const scroll = show(createElement(DecisionsPage), "/decisions", source);
    await screen.findByRole("heading", { name: decision.title });
    fireEvent.click(screen.getByRole("tab", { name: "考虑中" }));
    expect(screen.queryByRole("heading", { name: decision.title })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "打开建议来源" }));
    await screen.findByRole("heading", { name: decision.title });
    expect(screen.getByRole("tab", { name: "全部" }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(scroll).toHaveBeenCalled());
  });

  it("decodes review source identifiers and ignores malformed source fragments", async () => {
    const scroll = show(createElement(ReviewsPage),
      `/reviews#review-${encodeURIComponent(review.id)}`, "/reviews#review-%E0%A4");
    await screen.findByRole("heading", { name: review.title });
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    const count = scroll.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "打开建议来源" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: review.title })).toBeTruthy());
    expect(scroll.mock.calls.length).toBe(count);
  });
});
