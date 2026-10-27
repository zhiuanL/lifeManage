import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { DecisionEditorDialog } from "../../src/components/DecisionEditorDialog";
import type { Decision } from "../../src/domain/decisions/Decision";
import type { LifeNavigation } from "../../src/domain/life/LifeNavigation";
afterEach(() => { cleanup(); navigation[0].archivedAt = null; });
const timestamp = "2026-10-12T08:00:00Z";
const navigation: LifeNavigation[] = ["mission", "value", "vision", "principle"].map((kind, i) => ({
  id: "n" + i, kind: kind as LifeNavigation["kind"], title: "依据" + i, description: "正文", archivedAt: null, createdAt: timestamp, updatedAt: timestamp,
}));
function mount(decision?: Decision) {
  const update = vi.fn().mockRejectedValueOnce(new Error("保存失败")).mockResolvedValue(undefined);
  const create = vi.fn().mockResolvedValue(undefined), saved = vi.fn();
  const value = { decisionService: { update, create }, templateService: { find: vi.fn() } } as unknown as LifeOSContextValue;
  render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider, { value }, createElement(DecisionEditorDialog, {
    decision, navigation, domains: [], goals: [], onClose: vi.fn(), onSaved: saved,
  }))));
  fireEvent.click(screen.getByText(/人生导航依据/));
  return { update, create, saved };
}
it("selects all four Chinese navigation kinds without replacing decision fields", async () => {
  const { create, saved } = mount();
  fireEvent.change(screen.getByRole("textbox", { name: "决策议题" }), { target: { value: "新选择" } });
  for (const item of navigation) fireEvent.click(screen.getByRole("checkbox", { name: item.title }));
  fireEvent.submit(screen.getByRole("textbox", { name: "决策议题" }).closest("form")!);
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(create.mock.calls[0][0]).toMatchObject({ title: "新选择", navigationIds: navigation.map(n => n.id) });
});
it("retains archived references and draft after failed save, then explicitly clears them", async () => {
  navigation[0].archivedAt = timestamp;
  const decision: Decision = { id: "d", title: "旧选择", decidedOn: "2026-10-12", importance: "major", status: "considering", background: "正文",
    options: "", constraints: "约束", criteria: "", risks: "", opportunityCost: "", reversibility: "unknown", choice: "", rationale: "",
    executionConditions: "", outcome: "", reflection: "", goalId: null, domainIds: [], navigationIds: ["n0"], createdAt: timestamp, updatedAt: timestamp };
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
  expect(update.mock.calls[1][1]).toMatchObject({ title: "旧选择", constraints: "约束", navigationIds: [] });
  navigation[0].archivedAt = null;
});

