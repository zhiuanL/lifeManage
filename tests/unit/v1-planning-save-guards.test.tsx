import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { ActionEditorDialog } from "../../src/components/ActionEditorDialog";
import { GoalProgressDialog } from "../../src/components/GoalProgressDialog";
import type { Action } from "../../src/domain/planning/Action";
import type { Goal } from "../../src/domain/planning/Goal";

afterEach(cleanup);
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const goal = { id: "goal", title: "原目标" } as Goal;

describe.each(["action", "progress"] as const)("%s saving protection", kind => {
  function mount() {
    const pending = deferred();
    const save = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({});
    const onSaved = vi.fn(), onClose = vi.fn();
    const value = { actionService: { create: save }, goalProgressItemService: { replace: save } };
    const view = render(<LifeOSContext.Provider value={value as unknown as LifeOSContextValue}>
      {kind === "action" ? <ActionEditorDialog goals={[]} domains={[]} onClose={onClose} onSaved={onSaved} /> :
        <GoalProgressDialog goal={goal} items={[]} onClose={onClose} onSaved={onSaved} />}
    </LifeOSContext.Provider>);
    const title = kind === "action" ? "行动名称" : "名称";
    fireEvent.change(screen.getByLabelText(title), { target: { value: "保留草稿" } });
    return { view, pending, save, onSaved, onClose, title };
  }
  it("blocks synchronous repeated submissions, Escape, backdrop and editing; preserves failure drafts", async () => {
    const { pending, save, onSaved, onClose, title } = mount();
    const dialog = screen.getByRole("dialog");
    fireEvent.submit(dialog.querySelector("form")!);
    fireEvent.submit(dialog.querySelector("form")!);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement!);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(title).matches(":disabled")).toBe(true);
    expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => pending.reject(new Error("保存失败，请重试。")));
    expect((await screen.findByRole("alert")).textContent).toBe("保存失败，请重试。");
    expect((screen.getByLabelText(title) as HTMLInputElement).value).toBe("保留草稿");
    expect(screen.getByLabelText(title).matches(":disabled")).toBe(false);
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("does not call a stale parent after the editor unmounts during save", async () => {
    const { view, pending, onSaved, onClose } = mount();
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    view.unmount();
    await act(async () => pending.resolve());
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

it("retains explicit action adjustment reasons and feedback while retrying the same draft", async () => {
  const update = vi.fn().mockRejectedValueOnce(new Error("保存失败，请重试。")).mockResolvedValue({});
  const action = { id: "action", title: "原行动", notes: "", goalId: null, domainId: null,
    domainIds: [], scheduledFor: "2026-10-20" } as Action;
  render(<LifeOSContext.Provider value={{ actionService: { update } } as unknown as LifeOSContextValue}>
    <ActionEditorDialog action={action} goals={[]} domains={[]} onClose={vi.fn()} onSaved={vi.fn()} />
  </LifeOSContext.Provider>);
  fireEvent.change(screen.getByLabelText("安排日期"), { target: { value: "2026-10-22" } });
  fireEvent.change(screen.getByLabelText("调整原因"), { target: { value: "external" } });
  fireEvent.change(screen.getByLabelText("补充说明（可选）"), { target: { value: "对方改期" } });
  fireEvent.click(screen.getByText("行动反馈（可选）", { selector: "summary" }));
  fireEvent.change(screen.getByLabelText("实际结果"), { target: { value: "已有进展" } });
  fireEvent.change(screen.getByLabelText("投入时间（分钟）"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("调整原因") as HTMLSelectElement).value).toBe("external");
  expect((screen.getByLabelText("补充说明（可选）") as HTMLTextAreaElement).value).toBe("对方改期");
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update).toHaveBeenLastCalledWith("action", expect.objectContaining({
    scheduledFor: "2026-10-22", goalId: null, domainIds: [],
    details: expect.objectContaining({ actualResult: "已有进展", actualMinutes: 0 }),
  }), { reason: "external", note: "对方改期" });
});
