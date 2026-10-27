import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { DecisionEditorDialog } from "../../src/components/DecisionEditorDialog";
import type { Decision } from "../../src/domain/decisions/Decision";
import type { Person } from "../../src/domain/records/LifeRecords";
afterEach(() => { cleanup(); people[0].archived = false; });
const timestamp = "2026-10-12T08:00:00Z";
const people: Person[] = [0, 1, 2].map((i) => ({
  id: "n" + i, name: "依据" + i, relationshipType: "朋友", state: "", importantDate: null, lastContact: null, sharedExperiences: "", notes: "", domainIds: [], archived: false, createdAt: timestamp, updatedAt: timestamp,
}));
function mount(decision?: Decision) {
  const update = vi.fn().mockRejectedValueOnce(new Error("保存失败")).mockResolvedValue(undefined);
  const create = vi.fn().mockResolvedValue(undefined), saved = vi.fn();
  const value = { decisionService: { update, create }, templateService: { find: vi.fn() } } as unknown as LifeOSContextValue;
  render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider, { value }, createElement(DecisionEditorDialog, {
    resourceNeeds: [{ id: "need", goalId: "g", kind: "time", description: "每周两小时", skillId: null, personId: null, met: false, createdAt: timestamp, updatedAt: timestamp }],
    decision, people, domains: [], goals: [], onClose: vi.fn(), onSaved: saved,
  }))));
  fireEvent.click(screen.getByText(/关联人物/));
  return { update, create, saved };
}
it("selects Chinese person references without replacing decision fields", async () => {
  const { create, saved } = mount();
  fireEvent.change(screen.getByRole("textbox", { name: "决策议题" }), { target: { value: "新选择" } });
  for (const item of people) fireEvent.click(screen.getByRole("checkbox", { name: item.name }));
  fireEvent.submit(screen.getByRole("textbox", { name: "决策议题" }).closest("form")!);
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(create.mock.calls[0][0]).toMatchObject({ title: "新选择", personIds: people.map(n => n.id) });
});
it("retains archived references and draft after failed save, then explicitly clears them", async () => {
  people[0].archived = true;
  const decision: Decision = { id: "d", title: "旧选择", decidedOn: "2026-10-12", importance: "major", status: "considering", background: "正文",
    options: "", constraints: "约束", criteria: "", risks: "", opportunityCost: "", reversibility: "unknown", choice: "", rationale: "",
    executionConditions: "", outcome: "", reflection: "", goalId: null, domainIds: [], personIds: ["n0"], createdAt: timestamp, updatedAt: timestamp };
  const { update, saved } = mount(decision);
  const archived = screen.getByRole("checkbox", { name: "依据0（已归档）" }) as HTMLInputElement;
  expect(archived.checked).toBe(true);
  fireEvent.submit(archived.closest("form")!);
  await screen.findByText("保存决策失败，请重试。");
  expect(saved).not.toHaveBeenCalled(); expect(archived.checked).toBe(true);
  fireEvent.click(archived);
  expect(screen.getByRole("checkbox", { name: "依据0（已归档）" })).toBeTruthy();
  fireEvent.submit(archived.closest("form")!);
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(update.mock.calls[1][1]).toMatchObject({ title: "旧选择", constraints: "约束", personIds: [] });
  people[0].archived = false;
});

it("selects resource references in the folded Chinese section", async () => {
  const { create, saved } = mount();
  const summary = screen.getByText(/关联资源需求/);
  expect(summary.closest("details")?.open).toBe(false);
  fireEvent.click(summary);
  fireEvent.change(screen.getByRole("textbox", { name: "决策议题" }), { target: { value: "安排学习" } });
  const checkbox = screen.getByRole("checkbox", { name: /时间.*每周两小时.*缺口/ }) as HTMLInputElement;
  fireEvent.click(checkbox);
  expect(checkbox.checked).toBe(true);
  fireEvent.click(checkbox);
  expect(checkbox.checked).toBe(false);
  fireEvent.click(checkbox);
  fireEvent.submit(checkbox.closest("form")!);
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(create.mock.calls[0][0]).toMatchObject({ title: "安排学习", resourceNeedIds: ["need"] });
});


