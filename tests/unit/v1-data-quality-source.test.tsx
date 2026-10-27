import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import type { DataQualityReport } from "../../src/domain/system/DataQuality";
import { DataQualityPage } from "../../src/pages/DataQualityPage";

afterEach(cleanup);
const report: DataQualityReport = {
  checkedAt: "2026-10-22T01:00:00.000Z", counts: [{ label: "目标", count: 2 }],
  findings: [
    { key: "goal", category: "hierarchy", sourceType: "目标", sourceTitle: "原目标",
      sourcePath: "/goals/original", message: "原层级事实" },
    { key: "action", category: "reference", sourceType: "行动", sourceTitle: "原行动",
      sourcePath: "/goals#action-original", message: "原引用事实" },
  ],
};
const healthy: DataQualityReport = { checkedAt: "2026-10-22T02:00:00.000Z", counts: [], findings: [] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function frame(inspect: () => Promise<DataQualityReport>) {
  return <MemoryRouter><LifeOSContext.Provider value={{ dataQualityService: { inspect } } as unknown as LifeOSContextValue}>
    <DataQualityPage />
  </LifeOSContext.Provider></MemoryRouter>;
}

describe("data quality report source lifecycle", () => {
  it("hides the old report immediately on a service-only replacement and keeps the selected category", async () => {
    const original = vi.fn(async () => report);
    const pending = deferred<DataQualityReport>();
    const replacement = vi.fn(async () => pending.promise);
    const view = render(frame(original));
    await screen.findByRole("heading", { name: "原目标" });
    fireEvent.change(screen.getByLabelText("检查类别"), { target: { value: "hierarchy" } });
    view.rerender(frame(replacement));
    expect(screen.queryByRole("heading", { name: "原目标" })).toBeNull();
    expect(screen.queryByText("本次发现 2 条待检查记录。")).toBeNull();
    expect(screen.getByRole("button", { name: "重新检查" })).toHaveProperty("disabled", true);
    await act(async () => pending.resolve(report));
    await screen.findByRole("heading", { name: "原目标" });
    expect(screen.queryByRole("heading", { name: "原行动" })).toBeNull();
    expect(screen.getByLabelText("检查类别")).toHaveProperty("value", "hierarchy");
  });

  it.each(["resolve", "reject"] as const)("ignores an old pending report %s after source replacement", async outcome => {
    const pending = deferred<DataQualityReport>();
    const original = vi.fn(async () => pending.promise);
    const replacement = vi.fn(async () => healthy);
    const view = render(frame(original));
    view.rerender(frame(replacement));
    await screen.findByText("本次检查范围内未发现异常。");
    await act(async () => {
      if (outcome === "resolve") pending.resolve(report); else pending.reject(new Error("old private"));
    });
    expect(screen.queryByRole("heading", { name: "原目标" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(replacement).toHaveBeenCalledTimes(1);
  });

  it("hides stale findings while refreshing, sanitizes failure and preserves the category on retry", async () => {
    const pending = deferred<DataQualityReport>();
    const inspect = vi.fn(async () => report).mockResolvedValueOnce(report).mockReturnValueOnce(pending.promise);
    render(frame(inspect));
    await screen.findByRole("heading", { name: "原目标" });
    fireEvent.change(screen.getByLabelText("检查类别"), { target: { value: "reference" } });
    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    expect(screen.queryByRole("heading", { name: "原行动" })).toBeNull();
    expect(screen.queryByText("本次发现 2 条待检查记录。")).toBeNull();
    await act(async () => pending.reject(new Error("SQL C:\\private\\db")));
    expect((await screen.findByRole("alert")).textContent).toBe("数据质量检查未完成，请重新检查。");
    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    await screen.findByRole("heading", { name: "原行动" });
    expect(screen.queryByRole("heading", { name: "原目标" })).toBeNull();
    expect(screen.getByLabelText("检查类别")).toHaveProperty("value", "reference");
    expect(inspect).toHaveBeenCalledTimes(3);
  });

  it.each(["resolve", "reject"] as const)("does not render a pending report %s after unmount", async outcome => {
    const pending = deferred<DataQualityReport>();
    const view = render(frame(() => pending.promise));
    view.unmount();
    await act(async () => {
      if (outcome === "resolve") pending.resolve(report); else pending.reject(new Error("private"));
    });
    expect(screen.queryByRole("heading", { name: "原目标" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
