import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { AttentionSettingsEditor } from "../../src/components/AttentionSettingsEditor";
import { defaultAttentionSettings, type AttentionSettings } from "../../src/domain/attention/Attention";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";

afterEach(cleanup);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function domain(id: string, name: string): LifeDomain {
  return { id, name, description: "", color: "fern", icon: "heart", status: "active",
    sortOrder: 0, focus: "", currentState: "", longTermExpectation: "",
    createdAt: "2026-10-22T08:00:00Z", updatedAt: "2026-10-22T08:00:00Z" };
}
function context() {
  const app = createApplicationDependencies();
  vi.spyOn(app.attentionService, "getSettings").mockResolvedValue({ ...defaultAttentionSettings });
  vi.spyOn(app.lifeDomainService, "list").mockResolvedValue([domain("original", "原领域")]);
  vi.spyOn(app.attentionService, "setSettings").mockResolvedValue(undefined);
  return { ...app, theme: "mist", setTheme: vi.fn() } satisfies LifeOSContextValue;
}
function page(value: LifeOSContextValue, domains?: readonly LifeDomain[], pending?: (value: boolean) => void) {
  return <LifeOSContext.Provider value={value}>
    <AttentionSettingsEditor domainsOverride={domains} onPendingChange={pending} />
  </LifeOSContext.Provider>;
}

it("hides clean old-source settings immediately and ignores late reads including ABA", async () => {
  const original = context();
  const replacement = context();
  const late = deferred<AttentionSettings>();
  vi.mocked(original.attentionService.getSettings)
    .mockReturnValueOnce(late.promise).mockResolvedValue({ ...defaultAttentionSettings, planAdjustments: 7 });
  const next = deferred<AttentionSettings>();
  vi.mocked(replacement.attentionService.getSettings).mockReturnValue(next.promise);
  const view = render(page(original));
  view.rerender(page(replacement));
  view.rerender(page(original));
  expect(await screen.findByLabelText("28 天内改期次数")).toHaveProperty("value", "7");
  await act(async () => {
    next.resolve({ ...defaultAttentionSettings, planAdjustments: 8 });
    late.resolve({ ...defaultAttentionSettings, planAdjustments: 9 });
  });
  expect(screen.getByLabelText("28 天内改期次数")).toHaveProperty("value", "7");
  const unread = deferred<AttentionSettings>();
  vi.mocked(replacement.attentionService.getSettings).mockReturnValue(unread.promise);
  view.rerender(page(replacement));
  expect(screen.queryByLabelText("28 天内改期次数")).toBeNull();
  await act(async () => unread.reject(new Error("SQLITE C:/private")));
  expect((await screen.findByRole("alert")).textContent).toContain("提醒规则读取失败，请重试。");
  expect(screen.queryByLabelText("28 天内改期次数")).toBeNull();
  vi.mocked(replacement.attentionService.getSettings).mockResolvedValue({ ...defaultAttentionSettings, planAdjustments: 6 });
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  expect(await screen.findByLabelText("28 天内改期次数")).toHaveProperty("value", "6");
});

it("preserves the original dirty draft and domain candidates while a replacement read fails", async () => {
  const original = context();
  const replacement = context();
  vi.mocked(replacement.attentionService.getSettings).mockRejectedValue(new Error("private"));
  const view = render(page(original, [domain("first", "原候选")]));
  const field = await screen.findByLabelText("28 天内改期次数");
  fireEvent.change(field, { target: { value: "5" } });
  fireEvent.click(screen.getAllByLabelText("指定领域")[0]);
  fireEvent.click(screen.getByLabelText("原候选"));
  view.rerender(page(replacement, [domain("second", "替换候选")]));
  await screen.findByRole("alert");
  expect(field).toHaveProperty("value", "5");
  expect(screen.getAllByText("原候选").length).toBeGreaterThan(0);
  expect(screen.queryByText("替换候选")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "保存规则" }));
  await screen.findByText("原提醒规则已保存");
  expect(original.attentionService.setSettings).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ planAdjustments: 5 }));
  expect(replacement.attentionService.setSettings).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("28 天内改期次数")).toBeNull();
});

it("retries an original failed save after ABA without rereading or overwriting the current settings", async () => {
  const original = context();
  const replacement = context();
  vi.mocked(replacement.attentionService.getSettings).mockResolvedValue({ ...defaultAttentionSettings, planAdjustments: 8 });
  const request = deferred<void>();
  vi.mocked(original.attentionService.setSettings).mockReturnValueOnce(request.promise);
  const view = render(page(original));
  fireEvent.change(await screen.findByLabelText("28 天内改期次数"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "保存规则" }));
  view.rerender(page(replacement));
  view.rerender(page(original));
  await waitFor(() => expect(original.attentionService.getSettings).toHaveBeenCalledTimes(2));
  await act(async () => request.reject(new Error("private")));
  expect((await screen.findByRole("alert")).textContent).toBe("提醒规则保存失败，请重试。");
  expect(screen.getByLabelText("28 天内改期次数")).toHaveProperty("value", "5");
  fireEvent.click(screen.getByRole("button", { name: "保存规则" }));
  await screen.findByText("原提醒规则已保存");
  expect(original.attentionService.setSettings).toHaveBeenCalledTimes(2);
  expect(original.attentionService.setSettings).toHaveBeenLastCalledWith(
    expect.objectContaining({ planAdjustments: 5 }));
  expect(original.attentionService.getSettings).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText("28 天内改期次数")).toHaveProperty("value", String(defaultAttentionSettings.planAdjustments));
  expect(replacement.attentionService.setSettings).not.toHaveBeenCalled();
});

it("explicit discard follows the current read and current domain candidates without writing", async () => {
  const original = context();
  const replacement = context();
  const pending = vi.fn();
  vi.mocked(replacement.attentionService.getSettings).mockResolvedValue({ ...defaultAttentionSettings, planAdjustments: 8 });
  const view = render(page(original, [domain("first", "原候选")], pending));
  fireEvent.change(await screen.findByLabelText("28 天内改期次数"), { target: { value: "5" } });
  view.rerender(page(replacement, [domain("second", "替换候选")], pending));
  await waitFor(() => expect(replacement.attentionService.getSettings).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "撤销未保存修改" }));
  expect(screen.getByLabelText("28 天内改期次数")).toHaveProperty("value", "8");
  await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false));
  fireEvent.click(screen.getAllByLabelText("指定领域")[0]);
  expect(screen.getAllByText("替换候选").length).toBeGreaterThan(0);
  expect(screen.queryByText("原候选")).toBeNull();
  expect(original.attentionService.setSettings).not.toHaveBeenCalled();
  expect(replacement.attentionService.setSettings).not.toHaveBeenCalled();
  await waitFor(() => expect(pending).toHaveBeenLastCalledWith(true));
});

it("keeps an unchanged save bound to its original service during replacement", async () => {
  const original = context();
  const replacement = context();
  const request = deferred<void>();
  vi.mocked(original.attentionService.setSettings).mockReturnValue(request.promise);
  vi.mocked(replacement.attentionService.getSettings).mockResolvedValue({ ...defaultAttentionSettings, planAdjustments: 8 });
  const view = render(page(original));
  fireEvent.click(await screen.findByRole("button", { name: "保存规则" }));
  view.rerender(page(replacement));
  await waitFor(() => expect(replacement.attentionService.getSettings).toHaveBeenCalledTimes(1));
  await act(async () => request.resolve());
  await screen.findByText("原提醒规则已保存");
  expect(screen.getByLabelText("28 天内改期次数")).toHaveProperty("value", "8");
  expect(original.attentionService.getSettings).toHaveBeenCalledTimes(1);
  expect(replacement.attentionService.getSettings).toHaveBeenCalledTimes(1);
  expect(replacement.attentionService.setSettings).not.toHaveBeenCalled();
});
