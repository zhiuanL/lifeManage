import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";
import type { Goal } from "../../src/domain/planning/Goal";
import { LifeRecordValidationError, normalizeEvent, normalizePerson, normalizeSkill,
  selectPersonEvents, type LifeEvent, type LifeEventDraft, type Person, type Skill } from "../../src/domain/records/LifeRecords";
import { PeoplePage, SkillsPage, TimelinePage } from "../../src/pages/LifeRecordsPages";
import { buildPersonRelationshipTimeline } from "../../src/domain/records/PersonRelationshipHistory";

afterEach(cleanup);
const timestamp = "2026-10-22T08:00:00Z";
const stored = { archived: false, createdAt: timestamp, updatedAt: timestamp };
const person: Person = { ...stored, id: "person-a", name: "老朋友", relationshipType: "朋友",
  state: "保持联系", importantDate: "2026-11-01", lastContact: "2026-10-20",
  sharedExperiences: "一起学习", notes: "已有备注", domainIds: ["health"] };
const event: LifeEvent = { ...stored, id: "event-a", title: "一起散步", happenedOn: "2026-10-20",
  description: "晚饭后", personId: person.id, goalId: null, domainIds: ["health"] };
const skill: Skill = { ...stored, id: "skill-a", name: "时间规划", currentLevel: 0,
  targetLevel: 3, learningPath: "按周练习", practice: "已经练习一次", reflection: "继续调整",
  goalId: null, domainIds: ["health"] };
const domain = { ...stored, id: "health", name: "健康", color: "fern", icon: "heart" } as LifeDomain;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  const [target, setTarget] = useState("");
  return <>
    <output data-testid="location">{location.pathname}{location.search}{location.hash}</output>
    <label>测试跳转<input value={target} onChange={(e) => setTarget(e.target.value)} /></label>
    <button onClick={() => navigate(target)}>测试导航</button>
  </>;
}

function setup(path = "/timeline", initialEvents: readonly LifeEvent[] = [event],
  initialPeople: readonly Person[] = [person], initialGoals: readonly Goal[] = []) {
  let events = [...initialEvents];
  const saveEvent = vi.fn(async (draft: LifeEventDraft, id?: string) => {
    const saved = { ...stored, ...draft, id: id ?? "new-event" } as LifeEvent;
    events = [...events.filter((entry) => entry.id !== saved.id), saved];
    return saved;
  });
  const savePerson = vi.fn(async () => person);
  const saveSkill = vi.fn(async () => skill);
  const listEvents = vi.fn(async () => events);
  const context = {
    lifeDomainService: { list: async () => [domain] },
    goalService: { list: async () => initialGoals },
    lifeRecordsService: { listPeople: async () => initialPeople, listEvents,
      listSkills: async () => [skill], saveEvent, savePerson, saveSkill,
      setArchived: vi.fn(async () => {}) },
    decisionService: { list: async () => [] },
    reviewService: { list: async () => [] },
    goalTimelineService: { list: async () => [] },
    domainTimelineService: { list: async () => [] },
    personRelationshipTimelineService: { list: async () => [] },
  } as unknown as LifeOSContextValue;
  const page = render(<LifeOSContext.Provider value={context}>
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/people" element={<PeoplePage />} />
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/skills" element={<SkillsPage />} />
      </Routes>
    </MemoryRouter>
  </LifeOSContext.Provider>);
  return { ...page, context, saveEvent, savePerson, saveSkill, listEvents };
}

describe("V1 explicit person-event facts", () => {
  it("shows distinct dates and saves an edited birthday without changing legacy or named dates", async () => {
    const datedPerson: Person = { ...person, dates: [
      { kind: "birthday", label: "生日", date: "1990-02-28" },
      { kind: "important", label: "第一次合作", date: "2024-02-29" },
    ] };
    const { savePerson } = setup("/people", [], [datedPerson]);
    expect(await screen.findByText("生日 1990-02-28")).toBeTruthy();
    fireEvent.click(screen.getByText("其他重要日期"));
    expect(screen.getByText("第一次合作")).toBeTruthy();
    expect(screen.getByText("2024-02-29")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "编辑人物：老朋友" }));
    expect(screen.getByLabelText("重要日期")).toHaveProperty("value", person.importantDate);
    expect(screen.getByLabelText("日期名称 1")).toHaveProperty("value", "第一次合作");
    fireEvent.change(screen.getByLabelText("生日"), { target: { value: "1990-03-01" } });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    await waitFor(() => expect(savePerson).toHaveBeenCalledWith(expect.objectContaining({
      importantDate: person.importantDate, dates: [
        { kind: "birthday", label: "生日", date: "1990-03-01" },
        { kind: "important", label: "第一次合作", date: "2024-02-29" },
      ],
    }), person.id));
    expect(datedPerson.dates?.[0].date).toBe("1990-02-28");
  });

  it("selects only explicit links, intersects domain/archive filters and never changes the source", () => {
    const records = [
      event,
      { ...event, id: "event-b", title: "较晚事件", happenedOn: "2026-10-21" },
      { ...event, id: "event-c", domainIds: ["career"] },
      { ...event, id: "event-d", archived: true },
      { ...event, id: "event-e", personId: "other" },
      { ...event, id: "event-f", personId: null },
    ];
    expect(selectPersonEvents(records, person.id, "health").map((entry) => entry.id))
      .toEqual(["event-b", "event-a"]);
    expect(selectPersonEvents(records, person.id, "health", true).map((entry) => entry.id))
      .toEqual(["event-b", "event-a", "event-d"]);
    expect(selectPersonEvents(records, person.id).map((entry) => entry.id))
      .toEqual(["event-b", "event-a", "event-c"]);
    expect(selectPersonEvents(records, "")).toEqual([]);
    expect(records.map((entry) => entry.id))
      .toEqual(["event-a", "event-b", "event-c", "event-d", "event-e", "event-f"]);
  });

  it("keeps actionable record validation distinct from persistence errors", () => {
    expect(() => normalizePerson({ ...person, name: "" })).toThrow(LifeRecordValidationError);
    expect(() => normalizeEvent({ ...event, happenedOn: "2026-02-30" }))
      .toThrow(LifeRecordValidationError);
    expect(() => normalizeSkill({ ...skill, currentLevel: 6 })).toThrow(LifeRecordValidationError);
  });

  it("shows scoped important events on people and follows the same event source", async () => {
    setup("/people?domain=health", [event,
      { ...event, id: "career-event", title: "其他领域事件", domainIds: ["career"] },
      { ...event, id: "unrelated-event", title: "无关事件", personId: "other" },
      { ...event, id: "archived-event", title: "归档事件", archived: true }]);
    fireEvent.click(await screen.findByText("重要事件 · 1"));
    expect(screen.queryByText("其他领域事件")).toBeNull();
    expect(screen.queryByText("无关事件")).toBeNull();
    expect(screen.queryByText("归档事件")).toBeNull();
    const link = screen.getByRole("link", { name: "一起散步", hidden: true });
    expect(link.getAttribute("href")).toBe("/timeline?person=person-a&domain=health#event-event-a");
    fireEvent.click(screen.getByRole("link", { name: "查看人物事件：老朋友", hidden: true }));
    expect(await screen.findByRole("combobox", { name: "按人物筛选" }))
      .toHaveProperty("value", person.id);
    expect(screen.getByRole("combobox", { name: "按生活领域筛选" })).toHaveProperty("value", "health");
    expect(screen.getByRole("heading", { name: "一起散步" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "其他人生节点" })).toBeNull();
  });

  it("shows archived event history only when requested", async () => {
    setup("/people", [event, { ...event, id: "old", title: "旧事件", archived: true }]);
    expect(await screen.findByText("重要事件 · 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "显示归档" }));
    expect(screen.getByText("重要事件 · 2")).toBeTruthy();
    expect(screen.getByRole("link", { name: "旧事件", hidden: true })).toBeTruthy();
  });

  it("opens relationship history with the explicit person and domain context", async () => {
    const { context, savePerson, saveEvent } = setup("/people?domain=health");
    const before = { name: person.name, relationshipType: "朋友", state: "保持联系",
      domainIds: ["health"] };
    const entries = buildPersonRelationshipTimeline([
      { id: 1, personId: person.id, changedAt: timestamp, before,
        after: { ...before, state: "暂时疏远", domainIds: ["career"] } },
      { id: 2, personId: "other", changedAt: timestamp, before,
        after: { ...before, name: "其他人物", state: "恢复联系" } },
      { id: 3, personId: person.id, changedAt: timestamp,
        before: { ...before, domainIds: ["career"] },
        after: { ...before, state: "恢复联系", domainIds: ["career"] } },
    ]);
    vi.spyOn(context.personRelationshipTimelineService, "list").mockResolvedValue(entries);
    fireEvent.click(await screen.findByText("重要事件 · 1"));
    const link = screen.getByRole("link", { name: "查看关系变化：老朋友", hidden: true });
    expect(link.getAttribute("href")).toBe("/timeline?person=person-a&domain=health#person-relationships");
    fireEvent.click(link);
    expect(await screen.findByRole("combobox", { name: "按人物筛选" })).toHaveProperty("value", person.id);
    const history = await screen.findByRole("region", { name: "关系变化" });
    expect(await within(history).findByText("关系状态：保持联系 → 暂时疏远")).toBeTruthy();
    expect(within(history).queryByText("其他人物")).toBeNull();
    expect(within(history).queryByText("关系状态：保持联系 → 恢复联系")).toBeNull();
    expect(within(history).getByRole("link", { name: person.name }).getAttribute("href"))
      .toBe("/people#person-person-a");
    expect(screen.queryByRole("heading", { name: "其他人生节点" })).toBeNull();
    expect(savePerson).not.toHaveBeenCalled();
    expect(saveEvent).not.toHaveBeenCalled();
  });

  it("does not infer event domains from the selected person or write before confirmation", async () => {
    const { saveEvent } = setup("/timeline?person=person-a");
    fireEvent.click(await screen.findByRole("button", { name: "新增重要事件" }));
    expect(screen.getByRole("combobox", { name: "相关人物", hidden: true }))
      .toHaveProperty("value", person.id);
    expect(screen.getByRole("checkbox", { name: "健康" })).toHaveProperty("checked", false);
    expect(saveEvent).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("事件标题"), { target: { value: "再聚一次" } });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    expect(await screen.findByRole("heading", { name: "再聚一次" })).toBeTruthy();
    expect(saveEvent).toHaveBeenCalledWith(expect.objectContaining({
      title: "再聚一次", personId: person.id, goalId: null, domainIds: [],
    }), undefined);
    expect(screen.getByTestId("location").textContent).toBe("/timeline?person=person-a");
  });

  it("prefills the explicit domain and retains both filters after saving", async () => {
    const { saveEvent } = setup("/timeline?domain=health&person=person-a&extra=a&extra=b");
    fireEvent.click(await screen.findByRole("button", { name: "新增重要事件" }));
    fireEvent.change(screen.getByLabelText("事件标题"), { target: { value: "领域内事件" } });
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    expect(await screen.findByRole("heading", { name: "领域内事件" })).toBeTruthy();
    expect(saveEvent).toHaveBeenCalledWith(expect.objectContaining({
      personId: person.id, domainIds: ["health"],
    }), undefined);
    expect(screen.getByTestId("location").textContent)
      .toBe("/timeline?domain=health&person=person-a&extra=a&extra=b");
  });

  it("clears only invalid person context and preserves domain, duplicate parameters and hash", async () => {
    setup("/timeline?person=missing&domain=health&extra=a&extra=b#source");
    expect(await screen.findByRole("heading", { name: "无法按当前人物查看重要事件" })).toBeTruthy();
    expect(screen.queryByText("一起散步")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清除失效人物筛选" }));
    expect(await screen.findByRole("heading", { name: "一起散步" })).toBeTruthy();
    expect(screen.getByTestId("location").textContent)
      .toBe("/timeline?domain=health&extra=a&extra=b#source");
  });

  it("retains person context when clearing a missing domain and changing domain filters", async () => {
    setup("/timeline?domain=missing&person=person-a&extra=a&extra=b#source");
    fireEvent.click(await screen.findByRole("button", { name: "清除失效筛选" }));
    expect(await screen.findByRole("combobox", { name: "按人物筛选" })).toHaveProperty("value", person.id);
    fireEvent.change(screen.getByRole("combobox", { name: "按生活领域筛选" }),
      { target: { value: "health" } });
    expect(screen.getByTestId("location").textContent)
      .toBe("/timeline?person=person-a&extra=a&extra=b&domain=health#source");
  });

  it("shows archived person history, disables contextual creation and retains old event references", async () => {
    const { saveEvent } = setup("/timeline?person=person-a", [event], [{ ...person, archived: true }]);
    expect(await screen.findByRole("button", { name: "新增重要事件" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("heading", { name: "一起散步" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "编辑重要事件：一起散步" }));
    expect(screen.getByRole("combobox", { name: "相关人物", hidden: true }))
      .toHaveProperty("value", person.id);
    expect(screen.getAllByRole("option", { name: "老朋友（已归档）", hidden: true })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    await waitFor(() => expect(saveEvent).toHaveBeenCalledWith(
      expect.objectContaining({ personId: person.id, description: event.description }), event.id));
  });

  it("excludes archived people from ordinary new-event choices", async () => {
    setup("/timeline", [event], [person, { ...person, id: "old-person", name: "旧人物", archived: true }]);
    fireEvent.click(await screen.findByRole("button", { name: "新增重要事件" }));
    fireEvent.click(screen.getByText("关联人物与目标"));
    const select = screen.getByRole("combobox", { name: "相关人物", hidden: true });
    expect(within(select).queryByRole("option", { name: "旧人物（已归档）", hidden: true })).toBeNull();
  });

  it("freezes drafts across later URL context and does not let list operations replace them", async () => {
    const { saveEvent } = setup("/timeline?person=person-a&domain=health");
    fireEvent.click(await screen.findByRole("button", { name: "新增重要事件" }));
    fireEvent.change(screen.getByLabelText("事件标题"), { target: { value: "保留草稿" } });
    expect(screen.getByRole("button", { name: "编辑重要事件：一起散步" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "归档重要事件" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("测试跳转"),
      { target: { value: "/timeline?person=missing&domain=missing" } });
    fireEvent.click(screen.getByText("测试导航"));
    expect(screen.getByLabelText("事件标题")).toHaveProperty("value", "保留草稿");
    expect(screen.getByRole("heading", { name: "无法按当前领域查看重要事件" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "清除失效筛选" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("heading", { name: "一起散步" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    await waitFor(() => expect(saveEvent).toHaveBeenCalledWith(expect.objectContaining({
      title: "保留草稿", personId: person.id, domainIds: ["health"],
    }), undefined));
    expect(await screen.findByRole("heading", { name: "无法按当前领域查看重要事件" })).toBeTruthy();
  });

  it("blocks duplicate writes, all fields and close paths while saving, then keeps a failed draft", async () => {
    const { saveEvent } = setup("/timeline?person=person-a");
    const request = deferred<LifeEvent>();
    saveEvent.mockImplementationOnce(() => request.promise);
    fireEvent.click(await screen.findByRole("button", { name: "新增重要事件" }));
    fireEvent.change(screen.getByLabelText("事件标题"), { target: { value: "不能丢" } });
    const form = screen.getByLabelText("事件标题").closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(saveEvent).toHaveBeenCalledTimes(1);
    expect(form.querySelector(".record-edit-fields")).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("事件标题"), { target: { value: "覆盖尝试" } });
    expect(screen.getByLabelText("事件标题")).toHaveProperty("value", "不能丢");
    expect(screen.getByRole("button", { name: "关闭编辑" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "取消" })).toHaveProperty("disabled", true);
    request.reject(new Error("sqlite at C:\\private\\lifeos.db"));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "保存记录失败，请重试。");
    expect(screen.getByLabelText("事件标题")).toHaveProperty("value", "不能丢");
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    expect(await screen.findByRole("heading", { name: "不能丢" })).toBeTruthy();
    expect(saveEvent).toHaveBeenCalledTimes(2);
  });

  it("retains actionable validation messages without replacing a person's existing optional fields", async () => {
    const { savePerson } = setup("/people");
    savePerson.mockRejectedValueOnce(new LifeRecordValidationError("关联的生活领域已不存在。"));
    fireEvent.click(await screen.findByRole("button", { name: "编辑人物：老朋友" }));
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "关联的生活领域已不存在。");
    expect(savePerson).toHaveBeenCalledWith(expect.objectContaining({
      importantDate: person.importantDate, lastContact: person.lastContact,
      sharedExperiences: person.sharedExperiences, notes: person.notes,
    }), person.id);
  });

  it("keeps all skill fields and a zero level when editing from the records page", async () => {
    const { saveSkill } = setup("/skills");
    fireEvent.click(await screen.findByRole("button", { name: "编辑能力成长：时间规划" }));
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    await waitFor(() => expect(saveSkill).toHaveBeenCalledWith(expect.objectContaining({
      currentLevel: 0, targetLevel: 3, learningPath: skill.learningPath,
      practice: skill.practice, reflection: skill.reflection, goalId: null,
    }), skill.id));
  });

  it("sanitizes read failures and retries without partial facts", async () => {
    setupReadFailure();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "记录读取失败，请重试。");
    expect(screen.queryByText("一起散步")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("heading", { name: "一起散步" })).toBeTruthy();
  });

  it("includes completed goals linked to a secondary domain without duplicating timeline nodes", async () => {
    const goal: Goal = { id: "goal-a", title: "跨领域完成目标", description: "",
      domainId: "career", domainIds: ["career", "health"], parentId: null,
      targetDate: null, status: "completed", completedAt: timestamp,
      sortOrder: 0, createdAt: timestamp, updatedAt: timestamp };
    setup("/timeline?domain=health", [], [person], [goal,
      { ...goal, id: "other-goal", title: "无关完成目标", domainIds: ["career"] }]);
    expect(await screen.findByRole("link", { name: "跨领域完成目标" }))
      .toHaveProperty("href", expect.stringContaining("/goals#goal-goal-a"));
    expect(screen.getAllByRole("link", { name: "跨领域完成目标" })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "无关完成目标" })).toBeNull();
  });

  for (const outcome of ["resolve", "reject"] as const) {
    it(`does not re-open or refresh the departed page after save ${outcome}`, async () => {
      const { saveEvent, listEvents } = setup("/timeline?person=person-a");
      const request = deferred<LifeEvent>();
      saveEvent.mockImplementationOnce(() => request.promise);
      fireEvent.click(await screen.findByRole("button", { name: "新增重要事件" }));
      fireEvent.change(screen.getByLabelText("事件标题"), { target: { value: "离页草稿" } });
      fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
      const previousReads = listEvents.mock.calls.length;
      fireEvent.change(screen.getByLabelText("测试跳转"), { target: { value: "/people" } });
      fireEvent.click(screen.getByText("测试导航"));
      expect(await screen.findByRole("heading", { name: "人物" })).toBeTruthy();
      await waitFor(() => expect(listEvents.mock.calls.length).toBe(previousReads + 1));
      if (outcome === "resolve") request.resolve(event);
      else request.reject(new Error("private database error"));
      await request.promise.catch(() => {});
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
      expect(screen.getByTestId("location").textContent).toBe("/people");
      expect(listEvents.mock.calls.length).toBe(previousReads + 1);
    });
  }
});

function setupReadFailure() {
  const listEvents = vi.fn().mockRejectedValueOnce(new Error("raw private database path"))
    .mockResolvedValue([event]);
  const context = { lifeDomainService: { list: async () => [domain] },
    goalTimelineService: { list: async () => [] }, domainTimelineService: { list: async () => [] },
    personRelationshipTimelineService: { list: async () => [] },
    goalService: { list: async () => [] }, decisionService: { list: async () => [] },
    reviewService: { list: async () => [] },
    lifeRecordsService: { listPeople: async () => [person], listEvents, listSkills: async () => [] },
  } as unknown as LifeOSContextValue;
  render(<LifeOSContext.Provider value={context}><MemoryRouter>
    <TimelinePage />
  </MemoryRouter></LifeOSContext.Provider>);
}
