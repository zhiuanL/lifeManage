import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { RecommendedDomainsDialog } from "../../src/components/RecommendedDomainsDialog";
import { LandscapeSettings } from "../../src/components/LandscapeSettings";
import { defaultLandscapePreference, type LandscapePreference } from "../../src/domain/life/LandscapePreference";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";
import { LandscapePage } from "../../src/pages/LandscapePage";

afterEach(cleanup);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function domain(name: string): LifeDomain {
  return { id: name, name, color: "fern", icon: "heart", sortOrder: 0,
    description: "", focus: "", status: "active", createdAt: "2026-10-22T00:00:00Z",
    updatedAt: "2026-10-22T00:00:00Z" };
}
function view(app: LifeOSContextValue) {
  return <MemoryRouter><LifeOSContext.Provider value={app}><LandscapePage /></LifeOSContext.Provider></MemoryRouter>;
}
it("hides old domain nodes during source replacement and ignores late original reads", async () => {
  const app = createApplicationDependencies();
  const first = deferred<readonly LifeDomain[]>();
  const second = deferred<readonly LifeDomain[]>();
  const old = { ...app, lifeDomainService: { list: vi.fn().mockReturnValue(first.promise) } } as unknown as LifeOSContextValue;
  const next = { ...app, lifeDomainService: { list: vi.fn().mockReturnValue(second.promise) } } as unknown as LifeOSContextValue;
  const rendered = render(view(old));
  rendered.rerender(view(next));
  await act(async () => first.resolve([domain("旧来源")]));
  expect(screen.queryByRole("link", { name: "进入旧来源领域" })).toBeNull();
  await act(async () => second.resolve([domain("新来源")]));
  expect(await screen.findByRole("link", { name: "进入新来源领域" })).toBeTruthy();
  const third = deferred<readonly LifeDomain[]>();
  rendered.rerender(view({ ...app, lifeDomainService: { list: () => third.promise } } as unknown as LifeOSContextValue));
  expect(screen.queryByRole("link", { name: "进入新来源领域" })).toBeNull();
  expect(screen.getByRole("status", { name: "正在读取生活领域" })).toBeTruthy();
  await act(async () => third.resolve([]));
});
it("binds summary facts to their service rather than only the same domain/options key", async () => {
  const app = createApplicationDependencies();
  const base = await app.landscapeFactService.getSnapshot({
    domainIds: [], navigation: false, goals: false, attention: false, trends: false, reviews: false,
  });
  const old = { ...app, lifeDomainService: { list: async () => [domain("健康")] },
    landscapeFactService: { getSnapshot: async () => ({ ...base, today: "2026-10-21" }) } } as unknown as LifeOSContextValue;
  const rendered = render(view(old));
  expect(await screen.findByText("2026-10-21")).toBeTruthy();
  const pending = deferred<typeof base>();
  rendered.rerender(view({ ...old, landscapeFactService: { getSnapshot: () => pending.promise } } as unknown as LifeOSContextValue));
  expect(screen.queryByText("2026-10-21")).toBeNull();
  await act(async () => pending.resolve({ ...base, today: "2026-10-22" }));
  expect(await screen.findByText("2026-10-22")).toBeTruthy();
});
it("locks recommendation controls, preserves failures and retries only the original service", async () => {
  const pending = deferred<void>();
  const original = { addRecommended: vi.fn().mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error("SQL private path")).mockResolvedValue(undefined) };
  const replacement = { addRecommended: vi.fn() };
  const close = vi.fn();
  const saved = vi.fn();
  const makeView = (service: typeof original, available: string[]) => <LifeOSContext.Provider
    value={{ lifeDomainService: service } as unknown as LifeOSContextValue}>
    <RecommendedDomainsDialog available={available} onClose={close} onSaved={saved} />
  </LifeOSContext.Provider>;
  const rendered = render(makeView(original, ["健康", "成长"]));
  fireEvent.click(screen.getByRole("checkbox", { name: "成长" }));
  fireEvent.click(screen.getByRole("button", { name: "添加所选领域" }));
  fireEvent.click(screen.getByRole("button", { name: "正在添加" }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(original.addRecommended).toHaveBeenCalledOnce();
  expect((screen.getByRole("checkbox", { name: "健康" }) as HTMLInputElement).disabled).toBe(true);
  expect(close).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  expect(saved).toHaveBeenCalledOnce();
  rendered.rerender(makeView(replacement, ["财务"]));
  expect(screen.queryByRole("checkbox", { name: "财务" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "添加所选领域" }));
  expect((await screen.findByRole("alert")).textContent).toContain("选择已保留");
  expect((screen.getByRole("checkbox", { name: "健康" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "添加所选领域" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
  expect(original.addRecommended).toHaveBeenLastCalledWith(["健康"]);
  expect(replacement.addRecommended).not.toHaveBeenCalled();
});

it("hides loaded settings on source replacement and ignores old pending reads", async () => {
  const app = createApplicationDependencies();
  const originalRead = deferred<LandscapePreference>();
  const newRead = deferred<LandscapePreference>();
  const original = { get: () => originalRead.promise, save: vi.fn() };
  const replacement = { get: () => newRead.promise, save: vi.fn() };
  const makeView = (service: typeof original) => <LifeOSContext.Provider value={{
    ...app, landscapePreferenceService: service,
  } as unknown as LifeOSContextValue}><LandscapeSettings /></LifeOSContext.Provider>;
  const rendered = render(makeView(original));
  rendered.rerender(makeView(replacement));
  await act(async () => originalRead.resolve(defaultLandscapePreference()));
  expect(screen.queryByRole("checkbox", { name: "当下关注" })).toBeNull();
  await act(async () => newRead.resolve({ ...defaultLandscapePreference(), showFocus: false }));
  expect((await screen.findByRole("checkbox", { name: "当下关注" }) as HTMLInputElement).checked).toBe(false);
  const pending = deferred<LandscapePreference>();
  rendered.rerender(makeView({ ...original, get: () => pending.promise }));
  expect(screen.queryByRole("checkbox", { name: "当下关注" })).toBeNull();
  await act(async () => pending.resolve(defaultLandscapePreference()));
});
it("keeps original settings drafts/candidates on replacement failure and saves only their original service", async () => {
  const app = createApplicationDependencies();
  const original = { get: vi.fn().mockResolvedValue(defaultLandscapePreference()),
    save: vi.fn().mockRejectedValueOnce(new Error("private SQL")).mockResolvedValue(undefined) };
  const replacement = { get: vi.fn().mockRejectedValueOnce(new Error("private read"))
    .mockResolvedValue({ ...defaultLandscapePreference(), showReviews: false }), save: vi.fn() };
  const makeView = (service: typeof original, candidates: LifeDomain[]) => <LifeOSContext.Provider
    value={{ ...app, landscapePreferenceService: service } as unknown as LifeOSContextValue}>
    <LandscapeSettings domainsOverride={candidates} />
  </LifeOSContext.Provider>;
  const rendered = render(makeView(original, [domain("原领域")]));
  const focus = await screen.findByRole("checkbox", { name: "当下关注" });
  fireEvent.click(focus);
  rendered.rerender(makeView(replacement, [domain("替换领域")]));
  await screen.findByRole("alert");
  expect(screen.getByRole("checkbox", { name: "原领域" })).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: "替换领域" })).toBeNull();
  expect((focus as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("景观设置保存失败，请重试。");
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  await waitFor(() => expect(screen.queryByText("景观设置读取失败，请重试。")).toBeNull());
  expect((focus as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("原景观设置已保存");
  expect(original.save).toHaveBeenCalledTimes(2);
  expect(original.save).toHaveBeenLastCalledWith({ ...defaultLandscapePreference(), showFocus: false });
  expect(replacement.save).not.toHaveBeenCalled();
  expect(screen.queryByRole("checkbox", { name: "原领域" })).toBeNull();
  expect(screen.getByRole("checkbox", { name: "替换领域" })).toBeTruthy();
  expect((screen.getByRole("checkbox", { name: "最近回顾" }) as HTMLInputElement).checked).toBe(false);
});
it("protects settings during writes, reports pending edits and offers explicit undo without a write", async () => {
  const app = createApplicationDependencies();
  const pending = deferred<void>();
  const preference = defaultLandscapePreference();
  const service = { get: vi.fn().mockResolvedValue(preference), save: vi.fn().mockReturnValue(pending.promise) };
  const onPending = vi.fn();
  render(<LifeOSContext.Provider value={{ ...app, landscapePreferenceService: service } as unknown as LifeOSContextValue}>
    <LandscapeSettings onPendingChange={onPending} />
  </LifeOSContext.Provider>);
  const focus = await screen.findByRole("checkbox", { name: "当下关注" });
  await waitFor(() => expect(onPending).toHaveBeenLastCalledWith(false));
  fireEvent.click(focus);
  expect(onPending).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "撤销未保存修改" }));
  expect((focus as HTMLInputElement).checked).toBe(true);
  expect(service.save).not.toHaveBeenCalled();
  fireEvent.click(focus);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
  fireEvent.click(screen.getByRole("button", { name: "撤销未保存修改" }));
  expect(service.save).toHaveBeenCalledOnce();
  expect(focus.closest("fieldset")?.disabled).toBe(true);
  expect((focus as HTMLInputElement).checked).toBe(false);
  await act(async () => pending.resolve());
  expect(await screen.findByText("已保存")).toBeTruthy();
  await waitFor(() => expect(onPending).toHaveBeenLastCalledWith(false));
  expect(service.get).toHaveBeenCalledOnce();
});
