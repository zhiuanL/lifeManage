import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { defaultAttentionSettings, type AttentionSettings, type AttentionSignal } from "../../src/domain/attention/Attention";
import { AttentionPage } from "../../src/pages/AttentionPage";

afterEach(cleanup);
type Snapshot = { settings: AttentionSettings; signals: readonly AttentionSignal[] };
const signals: readonly AttentionSignal[] = [
  { id: "health", kind: "recurring-issue", title: "健康原事实", summary: "原始记录", domainIds: ["health"],
    rule: "明确规则", baseline: "原基线", period: "2026-10-22", sources: [] },
  { id: "work", kind: "recurring-issue", title: "工作原事实", summary: "原始记录", domainIds: ["work"],
    rule: "明确规则", baseline: "原基线", period: "2026-10-22", sources: [] },
];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function services() {
  let settings = { ...defaultAttentionSettings };
  return {
    attentionService: {
      getSnapshot: vi.fn(async (): Promise<Snapshot> => ({ settings, signals })),
      setSettings: vi.fn(async (next: AttentionSettings) => { settings = next; }),
    },
    lifeDomainService: { list: vi.fn(async () => [{ id: "health", name: "健康" }, { id: "work", name: "工作" }]) },
  };
}
function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output aria-label="当前位置">{location.pathname + location.search + location.hash}</output>
    <button type="button" onClick={() => navigate("/attention?domain=work&keep=1#source")}>切换领域入口</button></>;
}
function frame(value: ReturnType<typeof services>, path = "/attention") {
  return <MemoryRouter initialEntries={[path]}><LifeOSContext.Provider value={value as unknown as LifeOSContextValue}>
    <AttentionPage /><Navigation />
  </LifeOSContext.Provider></MemoryRouter>;
}

describe("attention source, context and setting lifecycle", () => {
  it("hides old facts on refresh, sanitizes failures and retries reading only", async () => {
    const value = services();
    const pending = deferred<Snapshot>();
    value.attentionService.getSnapshot.mockReturnValueOnce(Promise.resolve({
      settings: { ...defaultAttentionSettings }, signals,
    })).mockReturnValueOnce(pending.promise);
    render(frame(value));
    await screen.findByRole("heading", { name: "健康原事实" });
    fireEvent.click(screen.getByRole("button", { name: "重新查看注意事项" }));
    expect(screen.queryByRole("heading", { name: "健康原事实" })).toBeNull();
    await act(async () => pending.reject(new Error("SQL C:\\private\\life.db")));
    expect((await screen.findByRole("alert")).textContent).toBe("无法读取注意事项，请重试。已有记录不会被修改。");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("heading", { name: "健康原事实" });
    expect(value.attentionService.getSnapshot).toHaveBeenCalledTimes(3);
    expect(value.attentionService.setSettings).not.toHaveBeenCalled();
  });

  it.each(["attentionService", "lifeDomainService"] as const)("immediately hides facts on %s replacement", async key => {
    const original = services();
    const replacement = services();
    const pendingSnapshot = deferred<Snapshot>();
    const pendingDomains = deferred<{ id: string; name: string }[]>();
    replacement.attentionService.getSnapshot.mockReturnValueOnce(pendingSnapshot.promise);
    replacement.lifeDomainService.list.mockReturnValueOnce(pendingDomains.promise);
    const view = render(frame(original));
    await screen.findByRole("heading", { name: "健康原事实" });
    const next = key === "attentionService" ? { ...original, attentionService: replacement.attentionService }
      : { ...original, lifeDomainService: replacement.lifeDomainService };
    view.rerender(frame(next));
    expect(screen.queryByRole("heading", { name: "健康原事实" })).toBeNull();
    await act(async () => {
      if (key === "attentionService") pendingSnapshot.resolve({ settings: { ...defaultAttentionSettings }, signals: [] });
      else pendingDomains.resolve([{ id: "work", name: "工作" }]);
    });
    if (key === "attentionService") await screen.findByText("目前没有符合条件的注意事项。");
    else {
      await screen.findByRole("heading", { name: "健康原事实" });
      expect(screen.getByLabelText("生活领域").querySelector('option[value="health"]')).toBeNull();
    }
  });

  it.each(["resolve", "reject"] as const)("ignores an old pending read %s", async outcome => {
    const original = services();
    const pending = deferred<Snapshot>();
    original.attentionService.getSnapshot.mockReturnValueOnce(pending.promise);
    const replacement = services();
    replacement.attentionService.getSnapshot.mockResolvedValue({ settings: { ...defaultAttentionSettings }, signals: [] });
    const view = render(frame(original));
    view.rerender(frame(replacement));
    await screen.findByText("目前没有符合条件的注意事项。");
    await act(async () => {
      if (outcome === "resolve") pending.resolve({ settings: { ...defaultAttentionSettings }, signals });
      else pending.reject(new Error("old private"));
    });
    expect(screen.queryByRole("heading", { name: "健康原事实" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["", "missing"])("requires explicit recovery for invalid domain '%s'", async domain => {
    const value = services();
    render(frame(value, `/attention?domain=${domain}&keep=1&keep=2#source`));
    await screen.findByText("链接中的领域不可用，请明确清除领域筛选后继续。");
    expect(screen.queryByRole("heading", { name: "健康原事实" })).toBeNull();
    expect(screen.queryByText("目前没有符合条件的注意事项。")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清除领域筛选" }));
    await screen.findByRole("heading", { name: "健康原事实" });
    expect(screen.getByLabelText("当前位置").textContent).toBe("/attention?keep=1&keep=2#source");
    expect(value.attentionService.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it("follows same-page domain navigation and preserves unrelated params when changing the filter", async () => {
    const value = services();
    render(frame(value, "/attention?domain=health&keep=1&keep=2#source"));
    await screen.findByRole("heading", { name: "健康原事实" });
    expect(screen.queryByRole("heading", { name: "工作原事实" })).toBeNull();
    fireEvent.change(screen.getByLabelText("生活领域"), { target: { value: "work" } });
    expect(screen.getByLabelText("当前位置").textContent).toBe("/attention?domain=work&keep=1&keep=2#source");
    await screen.findByRole("heading", { name: "工作原事实" });
    fireEvent.change(screen.getByLabelText("生活领域"), { target: { value: "health" } });
    fireEvent.click(screen.getByRole("button", { name: "切换领域入口" }));
    await screen.findByRole("heading", { name: "工作原事实" });
    expect(value.attentionService.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it("locks competing settings, refresh and filters; retains a failed choice for explicit retry", async () => {
    const value = services();
    const pending = deferred<void>();
    value.attentionService.setSettings.mockReturnValueOnce(pending.promise);
    render(frame(value));
    await screen.findByRole("heading", { name: "健康原事实" });
    fireEvent.change(screen.getByLabelText("问题出现次数"), { target: { value: "4" } });
    expect(screen.getByLabelText("行动观察期")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("生活领域")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "重新查看注意事项" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("行动观察期"), { target: { value: "9" } });
    expect(value.attentionService.setSettings).toHaveBeenCalledTimes(1);
    await act(async () => pending.reject(new Error("SQL private")));
    expect((await screen.findByRole("alert")).textContent).toBe("提醒设置保存失败，已保留本次选择。请重试或撤销。");
    expect(screen.getByLabelText("问题出现次数")).toHaveProperty("value", "4");
    fireEvent.click(screen.getByRole("button", { name: "重试保存提醒设置" }));
    await waitFor(() => expect(screen.getByLabelText("问题出现次数")).toHaveProperty("disabled", false));
    expect(value.attentionService.setSettings).toHaveBeenCalledTimes(2);
    expect(value.attentionService.setSettings.mock.calls[1][0]).toEqual(value.attentionService.setSettings.mock.calls[0][0]);
    expect(screen.getByLabelText("问题出现次数")).toHaveProperty("value", "4");
  });

  it("cancels only the unsaved choice without writing defaults or discarding extended settings", async () => {
    const value = services();
    const original: AttentionSettings = { ...defaultAttentionSettings, recentEventDays: 8,
      rules: { "recent-event": { enabled: true, scope: "domains", domainIds: ["health"] } } };
    value.attentionService.getSnapshot.mockResolvedValue({ settings: original, signals });
    value.attentionService.setSettings.mockRejectedValueOnce(new Error("private"));
    render(frame(value));
    await screen.findByRole("heading", { name: "健康原事实" });
    fireEvent.change(screen.getByLabelText("行动观察期"), { target: { value: "8" } });
    await screen.findByRole("button", { name: "撤销未保存选择" });
    expect(value.attentionService.setSettings).toHaveBeenCalledWith({ ...original, idleWeeks: 8 });
    fireEvent.click(screen.getByRole("button", { name: "撤销未保存选择" }));
    expect(screen.getByLabelText("行动观察期")).toHaveProperty("value", String(original.idleWeeks));
    expect(value.attentionService.setSettings).toHaveBeenCalledTimes(1);
    expect(value.attentionService.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a committed setting when its subsequent snapshot read fails", async () => {
    const value = services();
    value.attentionService.getSnapshot.mockResolvedValueOnce({ settings: { ...defaultAttentionSettings }, signals })
      .mockRejectedValueOnce(new Error("private read"));
    render(frame(value));
    await screen.findByRole("heading", { name: "健康原事实" });
    fireEvent.change(screen.getByLabelText("问题出现次数"), { target: { value: "4" } });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "提醒设置已保存，但注意事项读取失败。请重试读取，不要重复保存。");
    expect(screen.queryByRole("button", { name: "重试保存提醒设置" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("heading", { name: "健康原事实" });
    expect(screen.getByLabelText("问题出现次数")).toHaveProperty("value", "4");
    expect(value.attentionService.setSettings).toHaveBeenCalledTimes(1);
    expect(value.attentionService.getSnapshot).toHaveBeenCalledTimes(3);
  });

  it("finishes the original committed write without rereading a replacement source", async () => {
    const original = services();
    const pending = deferred<void>();
    original.attentionService.setSettings.mockReturnValueOnce(pending.promise);
    const replacement = services();
    replacement.attentionService.getSnapshot.mockResolvedValue({ settings: { ...defaultAttentionSettings }, signals: [] });
    const view = render(frame(original));
    await screen.findByRole("heading", { name: "健康原事实" });
    fireEvent.change(screen.getByLabelText("问题出现次数"), { target: { value: "4" } });
    view.rerender(frame(replacement));
    await screen.findByText("目前没有符合条件的注意事项。");
    await act(async () => pending.resolve());
    expect(replacement.attentionService.getSnapshot).toHaveBeenCalledTimes(1);
    expect(replacement.attentionService.setSettings).not.toHaveBeenCalled();
    expect(original.attentionService.getSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a failed original-source draft without applying it to the new source", async () => {
    const original = services();
    const pending = deferred<void>();
    original.attentionService.setSettings.mockReturnValueOnce(pending.promise);
    const replacement = services();
    const view = render(frame(original));
    await screen.findByRole("heading", { name: "健康原事实" });
    fireEvent.change(screen.getByLabelText("问题出现次数"), { target: { value: "4" } });
    view.rerender(frame(replacement));
    await screen.findByRole("heading", { name: "健康原事实" });
    await act(async () => pending.reject(new Error("private old")));
    expect((await screen.findByRole("alert")).textContent).toBe("有另一数据来源的提醒设置尚未保存，请先重试或撤销原选择。");
    expect(screen.getByLabelText("问题出现次数")).toHaveProperty("value", String(defaultAttentionSettings.issueOccurrences));
    fireEvent.click(screen.getByRole("button", { name: "重试保存提醒设置" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(original.attentionService.setSettings).toHaveBeenCalledTimes(2);
    expect(replacement.attentionService.setSettings).not.toHaveBeenCalled();
    expect(replacement.attentionService.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it.each(["resolve", "reject"] as const)("does not reread or notify after an unmounted save %s", async outcome => {
    const value = services();
    const pending = deferred<void>();
    value.attentionService.setSettings.mockReturnValueOnce(pending.promise);
    const view = render(frame(value));
    await screen.findByRole("heading", { name: "健康原事实" });
    fireEvent.change(screen.getByLabelText("问题出现次数"), { target: { value: "4" } });
    view.unmount();
    await act(async () => {
      if (outcome === "resolve") pending.resolve(); else pending.reject(new Error("private"));
    });
    expect(value.attentionService.getSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
