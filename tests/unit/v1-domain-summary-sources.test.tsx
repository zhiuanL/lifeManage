import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";
import type { Goal } from "../../src/domain/planning/Goal";
import { DomainContextPage } from "../../src/pages/DomainContextPage";

afterEach(cleanup);
const stamp = "2026-10-22T08:00:00.000Z";
const domain: LifeDomain = {
  id: "健康/自选", name: "健康", description: "", focus: "", currentState: "",
  longTermExpectation: "", color: "fern", icon: "heart", status: "active",
  sortOrder: 0, createdAt: stamp, updatedAt: stamp,
};
const domainIds = [domain.id, "work"];
const stored = { archived: false, createdAt: stamp, updatedAt: stamp, domainIds };
const makeGoal = (id: string, status: Goal["status"]): Goal => ({
  id, title: id, status, description: "", domainId: null, domainIds,
  targetDate: null, completedAt: null, sortOrder: 0, createdAt: stamp, updatedAt: stamp,
});

function setup(disabled = false) {
  const goals = ["completed", "archived", "abandoned", "paused", "candidate"].map(status =>
    makeGoal(status, status as Goal["status"]));
  goals.push(makeGoal("仍在推进/目标", "active"));
  const actions = [{ ...stored, id: "行动/中文", title: "近期行动", notes: "", goalId: goals[0].id,
    domainId: null, domainIds: [], status: "open", completedAt: null, scheduledFor: null, sortOrder: 0 }];
  const people = [{ ...stored, id: "人物/中文", name: "重要的人", relationshipType: "朋友", state: "",
    importantDate: null, lastContact: null, sharedExperiences: "", notes: "" }];
  const events = [{ ...stored, id: "事件/中文", title: "重要经历", happenedOn: "2026-10-21",
    description: "", personId: people[0].id, goalId: null }];
  const skills = [{ ...stored, id: "能力/中文", name: "正在学习", currentLevel: 0, targetLevel: 2,
    learningPath: "", practice: "", reflection: "", goalId: null }];
  const readGoals = vi.fn(async () => goals);
  const readActions = vi.fn(async () => actions);
  const app = {
    modulePreference: { disabledModules: disabled
      ? ["goals", "reviews", "habits", "issues", "decisions", "people", "timeline", "skills"] : [] },
    lifeDomainService: { findById: async () => domain, list: async () => [domain] },
    goalService: { list: readGoals }, actionService: { list: readActions },
    reviewService: { list: async () => [{ id: "复盘/中文", title: "最近复盘", domainIds }] },
    issueService: { list: async () => [{ id: "问题/中文", title: "待跟进", domainIds, status: "open" }] },
    decisionService: { list: async () => [{ id: "决策/中文", title: "正在考虑", domainIds }] },
    habitService: { list: async () => [{ ...stored, id: "习惯/中文", title: "日常节奏", weeklyTarget: 3 }] },
    lifeRecordsService: {
      listPeople: async () => [
        { ...people[0], id: "archived-person", name: "已归档人物", archived: true },
        { ...people[0], id: "unlinked-person", name: "其他领域人物", domainIds: ["work"] }, ...people,
      ],
      listEvents: async () => [
        { ...events[0], id: "archived-event", title: "已归档事件", archived: true }, ...events,
      ],
      listSkills: async () => skills,
    },
    domainMetricService: { listDefinitions: async () => [], listRecords: async () => [],
      listSatisfactionLinks: async () => [] },
  } as unknown as LifeOSContextValue;
  render(<MemoryRouter initialEntries={[`/domains/${encodeURIComponent(domain.id)}`]}>
    <LifeOSContext.Provider value={app}>
      <Routes><Route path="/domains/:domainId" element={<DomainContextPage />} /></Routes>
    </LifeOSContext.Provider>
  </MemoryRouter>);
  return { goals, actions, readGoals, readActions };
}

describe("V1 domain summaries retain source identity", () => {
  for (const disabled of [false, true]) {
    it(`${disabled ? "disabled" : "enabled"} capabilities preserve facts without exposing ended goals or unrelated records`, async () => {
      const { goals, actions, readGoals, readActions } = setup(disabled);
      await screen.findByText("仍在推进/目标");
      for (const status of ["completed", "archived", "abandoned", "paused", "candidate"]) {
        expect(screen.queryByText(status)).toBeNull();
      }
      for (const title of ["已归档人物", "其他领域人物", "已归档事件"]) {
        expect(screen.queryByText(title)).toBeNull();
      }
      for (const [path, type, id, title] of [
        ["/goals", "goal", "仍在推进/目标", "仍在推进/目标"],
        ["/goals", "action", "行动/中文", "近期行动"],
        ["/reviews", "review", "复盘/中文", "最近复盘"],
        ["/issues", "issue", "问题/中文", "待跟进"],
        ["/decisions", "decision", "决策/中文", "正在考虑"],
        ["/people", "person", "人物/中文", "重要的人"],
        ["/timeline", "event", "事件/中文", "重要经历"],
        ["/skills", "skill", "能力/中文", "正在学习"],
        ["/habits", "habit", "习惯/中文", "日常节奏"],
      ]) {
        expect(screen.getAllByText(title).length).toBeGreaterThan(0);
        if (disabled) expect(screen.queryByRole("link", { name: title })).toBeNull();
        else expect(screen.getByRole("link", { name: title }).getAttribute("href"))
          .toBe(`${path}?domain=${encodeURIComponent(domain.id)}#${type}-${encodeURIComponent(id)}`);
      }
      expect(readGoals).toHaveBeenCalledTimes(1);
      expect(readActions).toHaveBeenCalledTimes(1);
      expect(goals).toHaveLength(6);
      expect(goals[0].status).toBe("completed");
      expect(actions[0].domainIds).toEqual([]);
    });
  }
});
