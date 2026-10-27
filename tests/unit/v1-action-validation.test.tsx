import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { ActionEditorDialog } from "../../src/components/ActionEditorDialog";
import { ActionValidationError, normalizeActionDraft, type Action, type ActionDraft } from "../../src/domain/planning/Action";
import { normalizeActionDetails, parseActionDetails } from "../../src/domain/planning/ActionDetails";
import { normalizePlanAdjustment } from "../../src/domain/planning/ActionPlanChange";
import type { ActionRepository } from "../../src/repositories/planning/ActionRepository";
import type { GoalRepository } from "../../src/repositories/planning/GoalRepository";
import type { LifeDomainRepository } from "../../src/repositories/life/LifeDomainRepository";
import { ActionService } from "../../src/services/planning/ActionService";

afterEach(cleanup);
const draft: ActionDraft = { title: "下一步", notes: "", domainId: null,
  domainIds: [], goalId: null, scheduledFor: null };

describe("V1 actionable action validation", () => {
  it.each([
    { title: "" }, { title: "a".repeat(121) }, { notes: "a".repeat(801) },
    { scheduledFor: "2026-02-30" }, { progressWeight: 0 }, { progressWeight: Infinity },
    { details: { actualMinutes: -1 } }, { details: { actualResult: "a".repeat(2001) } },
  ] satisfies Partial<ActionDraft>[])("types draft validation without changing its message", patch => {
    expect(() => normalizeActionDraft({ ...draft, ...patch })).toThrow(ActionValidationError);
  });
  it("keeps valid zero-minute feedback and optional weight defaults", () => {
    expect(normalizeActionDraft({ ...draft, details: { actualMinutes: 0 } })).toMatchObject({
      details: { actualMinutes: 0 }, progressWeight: 1, domainIds: [],
    });
    expect(() => normalizeActionDetails({ unknown: "" })).toThrow(ActionValidationError);
    expect(() => normalizePlanAdjustment(undefined)).toThrow(ActionValidationError);
    expect(() => normalizePlanAdjustment({ reason: "external", note: "a".repeat(501) })).toThrow(ActionValidationError);
    // Corrupt persisted content is not an editable-draft validation failure.
    let failure: unknown;
    try { parseActionDetails("{bad"); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ActionValidationError);
  });
  it("types missing actions and references but does not relabel storage failures", async () => {
    const repository = { findById: vi.fn(async () => null), list: vi.fn(async () => []),
      create: vi.fn(async () => undefined) } as unknown as ActionRepository;
    const service = new ActionService(repository,
      { findById: vi.fn(async () => null) } as unknown as GoalRepository,
      { findById: vi.fn(async () => null) } as unknown as LifeDomainRepository,
      { now: () => new Date("2026-10-22T08:00:00.000Z") }, { next: () => "action" });
    await expect(service.update("missing", draft)).rejects.toBeInstanceOf(ActionValidationError);
    await expect(service.toggleCompletion("missing")).rejects.toBeInstanceOf(ActionValidationError);
    await expect(service.create({ ...draft, goalId: "missing" })).rejects.toBeInstanceOf(ActionValidationError);
    await expect(service.create({ ...draft, domainIds: ["missing"] })).rejects.toBeInstanceOf(ActionValidationError);
    const failure = new Error("SQLITE_BUSY C:\\private\\lifeos.db");
    vi.mocked(repository.create).mockRejectedValueOnce(failure);
    await expect(service.create(draft)).rejects.toBe(failure);
  });
  it.each([
    [new Error("SQLITE_BUSY C:\\private\\lifeos.db"), "保存失败，请重试。"],
    [new ActionValidationError("关联的目标已经不存在了。"), "关联的目标已经不存在了。"],
  ] as const)("sanitizes storage failures without hiding editable validation", async (failure, message) => {
    const create = vi.fn().mockRejectedValueOnce(failure);
    render(<LifeOSContext.Provider value={{ actionService: { create } } as unknown as LifeOSContextValue}>
      <ActionEditorDialog goals={[]} domains={[]} onClose={vi.fn()} onSaved={vi.fn()} />
    </LifeOSContext.Provider>);
    fireEvent.change(screen.getByLabelText("行动名称"), { target: { value: "保留草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "创建行动" }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(screen.getByLabelText("行动名称")).toHaveProperty("value", "保留草稿");
    expect(screen.queryByText(/SQLITE_BUSY/)).toBeNull();
  });
  it("keeps original action/service ownership and calls only the latest mounted parent", async () => {
    let finish!: (value: Action) => void;
    const pending = new Promise<Action>(resolve => { finish = resolve; });
    const previousUpdate = vi.fn().mockReturnValue(pending), nextUpdate = vi.fn();
    const previousSaved = vi.fn(), nextSaved = vi.fn();
    const original = { ...draft, domainIds: [], id: "original", status: "open",
      sortOrder: 0, completedAt: null, createdAt: "", updatedAt: "" } as Action;
    function Frame({ replaced = false }: { replaced?: boolean }) {
      return <LifeOSContext.Provider value={{ actionService: {
        update: replaced ? nextUpdate : previousUpdate,
      } } as unknown as LifeOSContextValue}>
        <ActionEditorDialog action={replaced ? { ...original, id: "replacement" } : original}
          goals={[]} domains={[]} onClose={vi.fn()} onSaved={replaced ? nextSaved : previousSaved} />
      </LifeOSContext.Provider>;
    }
    const page = render(<Frame />);
    fireEvent.change(screen.getByLabelText("行动名称"), { target: { value: "原记录的草稿" } });
    page.rerender(<Frame replaced />);
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(previousUpdate).toHaveBeenCalledExactlyOnceWith("original",
      expect.objectContaining({ title: "原记录的草稿" }), undefined);
    expect(nextUpdate).not.toHaveBeenCalled();
    await act(async () => finish(original));
    expect(previousSaved).not.toHaveBeenCalled();
    expect(nextSaved).toHaveBeenCalledExactlyOnceWith(original);
  });
});
