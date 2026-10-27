import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";
import type { LifeEvent, Person, Skill } from "../../src/domain/records/LifeRecords";
import { PeoplePage, SkillsPage, TimelinePage } from "../../src/pages/LifeRecordsPages";

afterEach(cleanup);
const stamp = "2026-10-22T08:00:00Z";
const stored = { archived: false, createdAt: stamp, updatedAt: stamp };
const domain = { id: "health", name: "健康", color: "fern", icon: "heart" } as LifeDomain;
const person: Person = { ...stored, id: "person", name: "原人物", relationshipType: "朋友",
  state: "", importantDate: null, lastContact: null, sharedExperiences: "", notes: "",
  domainIds: [domain.id] };
const event: LifeEvent = { ...stored, id: "event", title: "原事件", happenedOn: "2026-10-22",
  description: "", personId: person.id, goalId: null, domainIds: [domain.id] };
const skill: Skill = { ...stored, id: "skill", name: "原能力", currentLevel: 0,
  targetLevel: 3, learningPath: "", practice: "", reflection: "", goalId: null, domainIds: [domain.id] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function context() {
  const services = {
    lifeDomainService: { list: vi.fn(async () => [domain]) },
    goalService: { list: vi.fn(async () => []) },
    decisionService: { list: vi.fn(async () => []) },
    reviewService: { list: vi.fn(async () => []) },
    lifeRecordsService: {
      listPeople: vi.fn(async () => [person]), listEvents: vi.fn(async () => [event]),
      listSkills: vi.fn(async () => [skill]), savePerson: vi.fn(async () => person),
      saveEvent: vi.fn(async () => event), saveSkill: vi.fn(async () => skill),
      setArchived: vi.fn(async () => {}),
    },
    goalTimelineService: { list: vi.fn(async () => []) },
    domainTimelineService: { list: vi.fn(async () => []) },
    personRelationshipTimelineService: { list: vi.fn(async () => []) },
  };
  return { services, app: services as unknown as LifeOSContextValue };
}
const cases = [
  { kind: "people", Page: PeoplePage, edit: "编辑人物：原人物", title: "名称", label: "人物", save: "savePerson" },
  { kind: "timeline", Page: TimelinePage, edit: "编辑重要事件：原事件", title: "事件标题",
    label: "重要事件", save: "saveEvent" },
  { kind: "skills", Page: SkillsPage, edit: "编辑能力成长：原能力", title: "名称",
    label: "能力成长", save: "saveSkill" },
] as const;
function Host({ entry }: { entry: typeof cases[number] }) {
  const location = useLocation(), navigate = useNavigate();
  const { Page, kind } = entry;
  return <>
    <output aria-label="当前位置">{location.pathname}{location.search}{location.hash}</output>
    <button onClick={() => void navigate(`/${kind}?domain=&keep=a&keep=b#source`)}>失效入口</button>
    <Page />
  </>;
}
function Frame({ app, entry, path = `/${entry.kind}` }: {
  app: LifeOSContextValue; entry: typeof cases[number]; path?: string;
}) {
  return <MemoryRouter initialEntries={[path]}><LifeOSContext.Provider value={app}>
    <Host entry={entry} />
  </LifeOSContext.Provider></MemoryRouter>;
}

describe.each(cases)("$kind record ownership", entry => {
  it("preserves recovery parameters without URLSearchParams.size", async () => {
    const size = vi.spyOn(URLSearchParams.prototype, "size", "get")
      .mockReturnValue(undefined as unknown as number);
    try {
      render(<Frame app={context().app} entry={entry}
        path={`/${entry.kind}?domain=missing&keep=a&keep=b#source`} />);
      await screen.findByRole("heading", { name: `无法按当前领域查看${entry.label}` });
      fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
      await screen.findByRole("button", { name: entry.edit });
      expect(screen.getByLabelText("当前位置").textContent)
        .toBe(`/${entry.kind}?keep=a&keep=b#source`);
    } finally { size.mockRestore(); }
  });

  it.each(["", "missing"])("blocks domain '%s' until explicit recovery", async id => {
    render(<Frame app={context().app} entry={entry}
      path={`/${entry.kind}?domain=${id}&keep=a&keep=b#source`} />);
    await screen.findByRole("heading", { name: `无法按当前领域查看${entry.label}` });
    expect(screen.queryByRole("button", { name: entry.edit })).toBeNull();
    expect(screen.queryByRole("region", { name: "关系变化" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清除失效筛选" }));
    await screen.findByRole("button", { name: entry.edit });
    expect(screen.getByLabelText("当前位置").textContent).toBe(`/${entry.kind}?keep=a&keep=b#source`);
  });

  it("keeps the original inline draft without global records on invalid navigation", async () => {
    const original = context();
    render(<Frame app={original.app} entry={entry} />);
    fireEvent.click(await screen.findByRole("button", { name: entry.edit }));
    const editor = screen.getByRole("region", { name: `编辑${entry.label}` });
    fireEvent.change(screen.getByLabelText(entry.title), { target: { value: "保留草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "失效入口" }));
    expect(screen.getByRole("region", { name: `编辑${entry.label}` })).toBe(editor);
    expect(screen.queryByRole("button", { name: entry.edit })).toBeNull();
    expect(screen.getByRole("button", { name: "清除失效筛选" })).toHaveProperty("disabled", true);
    expect(screen.getByLabelText(entry.title)).toHaveProperty("value", "保留草稿");
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    await waitFor(() => expect(original.services.lifeRecordsService[entry.save]).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("region", { name: `编辑${entry.label}` })).toBeNull());
  });

  it("retains its service and candidates through replacement loading, failed read and retry", async () => {
    const original = context(), replacement = context();
    const reading = deferred<LifeDomain[]>();
    replacement.services.lifeDomainService.list.mockReturnValueOnce(reading.promise)
      .mockResolvedValue([{ ...domain, id: "new", name: "新领域" }]);
    const view = render(<Frame app={original.app} entry={entry} />);
    fireEvent.click(await screen.findByRole("button", { name: entry.edit }));
    const editor = screen.getByRole("region", { name: `编辑${entry.label}` });
    fireEvent.change(screen.getByLabelText(entry.title), { target: { value: "原来源草稿" } });
    view.rerender(<Frame app={replacement.app} entry={entry} />);
    expect(screen.getByRole("region", { name: `编辑${entry.label}` })).toBe(editor);
    expect(screen.queryByRole("button", { name: entry.edit })).toBeNull();
    await act(async () => reading.reject(new Error("C:\\private\\life.db")));
    expect(screen.getByRole("region", { name: `编辑${entry.label}` })).toBe(editor);
    expect(screen.queryByText(/private/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("button", { name: entry.edit });
    expect(screen.getByRole("checkbox", { name: "健康" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "新领域" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存记录" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: `编辑${entry.label}` })).toBeNull());
    expect(original.services.lifeRecordsService[entry.save]).toHaveBeenCalledTimes(1);
    expect(replacement.services.lifeRecordsService[entry.save]).not.toHaveBeenCalled();
    expect(replacement.services.lifeDomainService.list).toHaveBeenCalledTimes(3);
    expect(original.services.lifeDomainService.list).toHaveBeenCalledTimes(1);
  });

  it("retains rows and sanitizes an archive failure without rereading", async () => {
    const original = context();
    original.services.lifeRecordsService.setArchived.mockRejectedValueOnce(new Error("SQL private"));
    render(<Frame app={original.app} entry={entry} />);
    fireEvent.click(await screen.findByRole("button", { name: `归档${entry.label}` }));
    expect((await screen.findByRole("alert")).textContent).toBe("更新归档状态失败，请重试。");
    expect(screen.getByRole("button", { name: entry.edit })).toBeTruthy();
    expect(original.services.lifeDomainService.list).toHaveBeenCalledTimes(1);
  });

  it.each(["resolve", "reject"] as const)("ignores an old archive %s after source replacement", async outcome => {
    const original = context(), replacement = context();
    const writing = deferred<void>();
    original.services.lifeRecordsService.setArchived.mockReturnValueOnce(writing.promise);
    const view = render(<Frame app={original.app} entry={entry} />);
    fireEvent.click(await screen.findByRole("button", { name: `归档${entry.label}` }));
    view.rerender(<Frame app={replacement.app} entry={entry} />);
    await screen.findByRole("button", { name: entry.edit });
    await act(async () => {
      if (outcome === "resolve") writing.resolve();
      else writing.reject(new Error("old private"));
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(original.services.lifeDomainService.list).toHaveBeenCalledTimes(1);
    expect(replacement.services.lifeDomainService.list).toHaveBeenCalledTimes(1);
  });
});

it.each(["", "missing"])("blocks explicit person '%s' without mounting global timeline sections", async id => {
  render(<Frame app={context().app} entry={cases[1]}
    path={`/timeline?person=${id}&domain=health&keep=a&keep=b#source`} />);
  await screen.findByRole("heading", { name: "无法按当前人物查看重要事件" });
  expect(screen.queryByRole("region", { name: "关系变化" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "其他人生节点" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "清除失效人物筛选" }));
  await screen.findByRole("button", { name: cases[1].edit });
  expect(screen.getByLabelText("当前位置").textContent).toBe("/timeline?domain=health&keep=a&keep=b#source");
});
