import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplicationDependencies, type ApplicationDependencies } from "../../src/app/applicationDependencies";
import { useLifeOS } from "../../src/app/LifeOSContext";
import { LifeOSProvider } from "../../src/app/LifeOSProvider";
import { DatabaseCompatibilityError } from "../../src/db/DatabaseCompatibilityError";
import { PreferenceReadError } from "../../src/domain/system/PreferenceReadError";
import type { ApplicationBootstrapResult } from "../../src/services/system/BootstrapApplicationService";

vi.mock("../../src/app/applicationDependencies", () => ({ createApplicationDependencies: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<ApplicationBootstrapResult>((done, fail) => {
    resolve = () => done({ initializedAt: "2026-10-22T08:00:00Z", isFirstInitialization: false,
      migrationVersion: "0052-v1-landscape-context" });
    reject = fail;
  });
  return { promise, resolve, reject };
}
function dependencies() {
  return {
    bootstrapApplicationService: { bootstrap: vi.fn(async () => {}) },
    themePreferenceService: { getTheme: vi.fn(async () => "black") },
    modulePreferenceService: { get: vi.fn(async () => ({ disabledModules: [] })) },
    navigationPreferenceService: { get: vi.fn(async () => ({ pinnedCapabilities: [] })) },
  } as unknown as ApplicationDependencies;
}
function Ready() {
  const { theme } = useLifeOS();
  return <p>生活空间已打开：{theme}</p>;
}
const safeError = "本地数据初始化失败，请重试。若持续失败，请先备份本地数据，再检查文件访问权限。";

describe("application initialization lifecycle", () => {
  it("shares a single initialization across StrictMode effect replay", async () => {
    const app = dependencies();
    const pending = deferred();
    vi.mocked(app.bootstrapApplicationService.bootstrap).mockReturnValue(pending.promise);
    vi.mocked(createApplicationDependencies).mockReturnValue(app);
    render(<StrictMode><LifeOSProvider><Ready /></LifeOSProvider></StrictMode>);
    expect(app.bootstrapApplicationService.bootstrap).toHaveBeenCalledTimes(1);
    expect(app.themePreferenceService.getTheme).not.toHaveBeenCalled();
    await act(async () => pending.resolve());
    await screen.findByText("生活空间已打开：black");
    expect(app.bootstrapApplicationService.bootstrap).toHaveBeenCalledTimes(1);
    expect(app.themePreferenceService.getTheme).toHaveBeenCalledTimes(1);
  });

  it("synchronously rejects duplicate retries, then opens the committed preferences", async () => {
    const app = dependencies();
    const pending = deferred();
    vi.mocked(app.bootstrapApplicationService.bootstrap)
      .mockRejectedValueOnce(new Error("SQLITE_BUSY C:/private"))
      .mockReturnValueOnce(pending.promise);
    vi.mocked(createApplicationDependencies).mockReturnValue(app);
    render(<LifeOSProvider><Ready /></LifeOSProvider>);
    await screen.findByText(safeError);
    const retry = screen.getByRole("button", { name: "重试" });
    act(() => { retry.click(); retry.click(); });
    expect(app.bootstrapApplicationService.bootstrap).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
    await act(async () => pending.resolve());
    await screen.findByText("生活空间已打开：black");
    expect(app.modulePreferenceService.get).toHaveBeenCalledTimes(1);
    expect(app.navigationPreferenceService.get).toHaveBeenCalledTimes(1);
  });

  for (const outcome of ["success", "failure"] as const) {
    it(`does not publish an old retry after unmounting (${outcome})`, async () => {
      const original = dependencies();
      const pending = deferred();
      vi.mocked(original.bootstrapApplicationService.bootstrap)
        .mockRejectedValueOnce("private path").mockReturnValueOnce(pending.promise);
      vi.mocked(createApplicationDependencies).mockReturnValue(original);
      const old = render(<LifeOSProvider><Ready /></LifeOSProvider>);
      fireEvent.click(await screen.findByRole("button", { name: "重试" }));
      old.unmount();
      const replacement = dependencies();
      vi.mocked(replacement.themePreferenceService.getTheme).mockResolvedValue("mist");
      vi.mocked(createApplicationDependencies).mockReturnValue(replacement);
      render(<LifeOSProvider><Ready /></LifeOSProvider>);
      await screen.findByText("生活空间已打开：mist");
      await act(async () => {
        if (outcome === "success") pending.resolve();
        else pending.reject(new Error("private failure"));
      });
      expect(screen.getByText("生活空间已打开：mist")).toBeTruthy();
      expect(screen.queryByText(safeError)).toBeNull();
      expect(replacement.bootstrapApplicationService.bootstrap).toHaveBeenCalledTimes(1);
    });
  }

  for (const reason of ["legacy", "newer", "missing-inbox-privacy"] as const) {
    it(`preserves actionable ${reason} compatibility failures without reading preferences`, async () => {
      const app = dependencies();
      const error = new DatabaseCompatibilityError(reason);
      vi.mocked(app.bootstrapApplicationService.bootstrap).mockRejectedValue(error);
      vi.mocked(createApplicationDependencies).mockReturnValue(app);
      render(<LifeOSProvider><Ready /></LifeOSProvider>);
      await screen.findByText(error.message);
      expect(app.themePreferenceService.getTheme).not.toHaveBeenCalled();
      expect(screen.queryByText(safeError)).toBeNull();
    });
  }

  for (const preference of ["module", "navigation"] as const) {
    it(`preserves safe corrupted ${preference} preference messages instead of resetting data`, async () => {
      const app = dependencies();
      const error = new PreferenceReadError(preference);
      const read = preference === "module" ? app.modulePreferenceService.get : app.navigationPreferenceService.get;
      vi.mocked(read).mockRejectedValue(error);
      vi.mocked(createApplicationDependencies).mockReturnValue(app);
      render(<LifeOSProvider><Ready /></LifeOSProvider>);
      await screen.findByText(error.message);
      expect(app.bootstrapApplicationService.bootstrap).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("生活空间已打开：black")).toBeNull();
    });
  }

  it("can retry a failed preference read without overlapping migrations", async () => {
    const app = dependencies();
    vi.mocked(app.themePreferenceService.getTheme).mockRejectedValueOnce(new Error("private connection"));
    vi.mocked(createApplicationDependencies).mockReturnValue(app);
    render(<LifeOSProvider><Ready /></LifeOSProvider>);
    await screen.findByText(safeError);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("生活空间已打开：black");
    await waitFor(() => expect(app.bootstrapApplicationService.bootstrap).toHaveBeenCalledTimes(2));
    expect(app.themePreferenceService.getTheme).toHaveBeenCalledTimes(2);
    expect(app.modulePreferenceService.get).toHaveBeenCalledTimes(1);
  });
});
