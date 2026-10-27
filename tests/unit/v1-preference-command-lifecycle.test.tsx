import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { ModuleSettings } from "../../src/components/ModuleSettings";
import { NavigationSettings } from "../../src/components/NavigationSettings";
import { ThemePicker } from "../../src/components/ThemePicker";
import { defaultModulePreference } from "../../src/domain/system/ModulePreference";
import { ThemePreferenceService } from "../../src/services/system/ThemePreferenceService";

afterEach(cleanup);

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

type Kind = "theme" | "module" | "navigation";
function context(kind: Kind, save: ReturnType<typeof vi.fn>): LifeOSContextValue {
  return {
    ...createApplicationDependencies(),
    theme: "mist",
    setTheme: kind === "theme" ? save : vi.fn(async () => {}),
    modulePreference: defaultModulePreference(),
    setModulePreference: kind === "module" ? save : vi.fn(async () => {}),
    navigationPreference: { pinnedCapabilities: ["habits", "people"] },
    updateNavigationPreference: kind === "navigation" ? save : vi.fn(async () => {}),
  };
}

function page(kind: Kind, value: LifeOSContextValue) {
  return <MemoryRouter><LifeOSContext.Provider value={value}>
    {kind === "theme" ? <ThemePicker /> : kind === "module" ? <ModuleSettings /> : <NavigationSettings />}
  </LifeOSContext.Provider></MemoryRouter>;
}

function choose(kind: Kind) {
  if (kind === "theme") {
    fireEvent.click(screen.getByRole("button", { name: "切换主题" }));
    return screen.getByRole("button", { name: "深黑" });
  }
  if (kind === "module") return screen.getByRole("checkbox", { name: "人物" });
  return screen.getByRole("button", { name: "上移人物" });
}

const labels = {
  theme: { retry: "重试主题", cancel: "撤销主题选择", error: "主题保存失败，请重试。" },
  module: { retry: "重试模块设置", cancel: "撤销模块选择", error: "模块设置保存失败，请重试。" },
  navigation: { retry: "重试导航设置", cancel: "撤销导航选择", error: "导航设置保存失败，请重试。" },
};

describe("preference commands preserve their original writer", () => {
  for (const kind of ["theme", "module", "navigation"] as const) {
    it(`${kind} retains failed commands across source replacement and ABA, retries only the original`, async () => {
      const request = deferred();
      const save = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValue(undefined);
      const otherSave = vi.fn(async () => {});
      const original = context(kind, save);
      const replacement = context(kind, otherSave);
      const view = render(page(kind, original));
      const choice = choose(kind);
      fireEvent.click(choice);
      fireEvent.click(choice);
      expect(save).toHaveBeenCalledTimes(1);
      expect(choice.matches(":disabled")).toBe(true);
      const originalArgument = save.mock.calls[0][0];
      view.rerender(page(kind, replacement));
      view.rerender(page(kind, original));
      await act(async () => request.reject(new Error("SQLITE_BUSY C:/private")));
      expect((await screen.findByRole("alert")).textContent).toBe(labels[kind].error);
      expect(choice.matches(":disabled")).toBe(true);
      const retry = screen.getByRole("button", { name: labels[kind].retry });
      fireEvent.click(retry);
      fireEvent.click(retry);
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
      expect(save).toHaveBeenCalledTimes(2);
      expect(save.mock.calls[1][0]).toBe(originalArgument);
      expect(otherSave).not.toHaveBeenCalled();
      expect(screen.queryByText("已保存")).toBeNull();
      if (kind === "theme") expect(screen.getByRole("button", { name: "深黑" })).toBeTruthy();
    });

    it(`${kind} can explicitly discard a failed old-source command without writing`, async () => {
      const save = vi.fn().mockRejectedValue(new Error("private"));
      const otherSave = vi.fn(async () => {});
      const view = render(page(kind, context(kind, save)));
      fireEvent.click(choose(kind));
      await screen.findByRole("alert");
      view.rerender(page(kind, context(kind, otherSave)));
      fireEvent.click(screen.getByRole("button", { name: labels[kind].cancel }));
      expect(screen.queryByRole("alert")).toBeNull();
      const choice = kind === "theme" ? screen.getByRole("button", { name: "深黑" })
        : kind === "module" ? screen.getByRole("checkbox", { name: "人物" })
          : screen.getByRole("button", { name: "上移人物" });
      fireEvent.click(choice);
      await waitFor(() => expect(otherSave).toHaveBeenCalledTimes(1));
      expect(save).toHaveBeenCalledTimes(1);
    });

    it(`${kind} ignores successful feedback from a replaced source`, async () => {
      const request = deferred();
      const view = render(page(kind, context(kind, vi.fn(() => request.promise))));
      fireEvent.click(choose(kind));
      view.rerender(page(kind, context(kind, vi.fn(async () => {}))));
      await act(async () => request.resolve());
      expect(screen.queryByText("已保存")).toBeNull();
      if (kind === "theme") expect(screen.getByRole("button", { name: "深黑" })).toBeTruthy();
    });

    it(`${kind} does not publish a failure after unmounting`, async () => {
      const request = deferred();
      const save = vi.fn(() => request.promise);
      const view = render(page(kind, context(kind, save)));
      fireEvent.click(choose(kind));
      view.unmount();
      await act(async () => request.reject(new Error("private")));
      expect(save).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("alert")).toBeNull();
    });
  }

  it("serializes theme writes from separate controls and continues after failure", async () => {
    let value: string | null = null;
    const first = deferred();
    const write = vi.fn(async (_key: string, next: string) => { value = next; });
    write.mockImplementationOnce(() => first.promise);
    const service = new ThemePreferenceService({
      getMetadata: async () => value, setMetadata: write, completeFirstInitialization: vi.fn(),
    });
    const failed = service.setTheme("black");
    const second = service.setTheme("warm-dark");
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const rejected = expect(failed).rejects.toThrow("private");
    first.reject(new Error("private"));
    await rejected;
    await second;
    expect(write.mock.calls.map(call => call[1])).toEqual(["black", "warm-dark"]);
    expect(await service.getTheme()).toBe("warm-dark");
  });
});
