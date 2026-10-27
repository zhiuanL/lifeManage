import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { reloadApplication } from "../../src/app/reloadApplication";
import { backupTables, inspectBackup, type LifeOSBackup } from "../../src/domain/backup/Backup";
import { BackupPage } from "../../src/pages/BackupPage";

vi.mock("../../src/app/reloadApplication", () => ({ reloadApplication: vi.fn() }));
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.mocked(reloadApplication).mockReset();
  vi.unstubAllGlobals(); vi.useRealTimers(); sessionStorage.clear();
});

const backup: LifeOSBackup = {
  format: "lifeos-backup", schemaVersion: 25, appVersion: "0.1.0", exportedAt: "2026-10-22T00:00:00Z",
  data: Object.fromEntries(backupTables.slice(0, 33).map(table => [table, []])),
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function service() {
  return { create: vi.fn(async () => backup), inspect: vi.fn(inspectBackup),
    restore: vi.fn(async () => "C:\\safe\\before.json") };
}
function view(value: ReturnType<typeof service>, environment: LifeOSContextValue["environment"] = "desktop") {
  return <LifeOSContext.Provider value={{ backupService: value, environment } as unknown as LifeOSContextValue}>
    <BackupPage />
  </LifeOSContext.Provider>;
}
function choose(name = "copy.json", text = Promise.resolve(JSON.stringify(backup))) {
  const file = new File([], name);
  Object.defineProperty(file, "text", { value: () => text });
  fireEvent.change(screen.getByLabelText("选择 LifeOS 备份文件"), { target: { files: [file] } });
}
async function confirm() {
  await screen.findByRole("heading", { name: "文件结构检查完成：copy.json" });
  fireEvent.click(screen.getByRole("checkbox", { name: /我确认用此备份替换当前数据/ }));
}

it("invalidates a checked file and confirmation immediately after service replacement", async () => {
  const original = service(), replacement = service();
  const page = render(view(original));
  choose(); await confirm();
  page.rerender(view(replacement));
  expect(screen.queryByRole("button", { name: "确认恢复" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "文件结构检查完成：copy.json" })).toBeNull();
  expect(original.restore).not.toHaveBeenCalled();
  choose();
  await screen.findByRole("heading", { name: "文件结构检查完成：copy.json" });
  expect(screen.getByRole("checkbox", { name: /我确认用此备份替换当前数据/ })).toHaveProperty("checked", false);
  expect(replacement.inspect).toHaveBeenCalledOnce();
});

it("ignores a late file read after replacement and never inspects it with a new service", async () => {
  const original = service(), replacement = service();
  const pending = deferred<string>();
  const page = render(view(original));
  choose("old.json", pending.promise);
  page.rerender(view(replacement));
  await act(async () => pending.resolve(JSON.stringify(backup)));
  expect(original.inspect).not.toHaveBeenCalled();
  expect(replacement.inspect).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "确认恢复" })).toBeNull();
});

it.each(["service", "environment"])("does not revive confirmation after switching away and back (%s)", async kind => {
  const original = service();
  const page = render(view(original));
  choose(); await confirm();
  page.rerender(kind === "service" ? view(service()) : view(original, "browser"));
  page.rerender(view(original));
  expect(screen.queryByRole("button", { name: "确认恢复" })).toBeNull();
  const pending = deferred<string>();
  choose("late.json", pending.promise);
  page.rerender(kind === "service" ? view(service()) : view(original, "browser"));
  page.rerender(view(original));
  await act(async () => pending.resolve(JSON.stringify(backup)));
  expect(original.inspect).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "确认恢复" })).toBeNull();
});

it("keeps only the latest file and requires fresh confirmation even for the same file", async () => {
  const original = service();
  render(view(original));
  const pending = deferred<string>();
  choose("old.json", pending.promise);
  choose(); await confirm();
  await act(async () => pending.resolve(JSON.stringify(backup)));
  expect(original.inspect).toHaveBeenCalledOnce();
  expect(screen.queryByRole("heading", { name: "文件结构检查完成：old.json" })).toBeNull();
  choose();
  await screen.findByRole("heading", { name: "文件结构检查完成：copy.json" });
  expect(screen.getByRole("checkbox", { name: /我确认用此备份替换当前数据/ })).toHaveProperty("checked", false);
});

it("blocks duplicate restores and file/confirmation changes, sanitizes failure and requires reconfirmation", async () => {
  const original = service();
  const pending = deferred<string>();
  original.restore.mockReturnValueOnce(pending.promise);
  render(view(original)); choose(); await confirm();
  const button = screen.getByRole("button", { name: "确认恢复" });
  fireEvent.click(button); fireEvent.click(button);
  choose("blocked.json");
  const checkbox = screen.getByRole("checkbox", { name: /我确认用此备份替换当前数据/ });
  expect(checkbox).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("选择 LifeOS 备份文件")).toHaveProperty("disabled", true);
  expect(original.restore).toHaveBeenCalledOnce();
  expect(original.inspect).toHaveBeenCalledOnce();
  await act(async () => pending.reject("SQLITE C:\\private\\lifeos.db"));
  expect((await screen.findByRole("alert")).textContent).toBe("恢复未完成，请检查备份文件与本地数据状态后重新确认。");
  expect(checkbox).toHaveProperty("checked", false);
  expect(button).toHaveProperty("disabled", true);
  fireEvent.click(button);
  expect(original.restore).toHaveBeenCalledOnce();
});

it("never retries a committed restore when reloading or session storage fails", async () => {
  const original = service();
  vi.mocked(reloadApplication).mockImplementation(() => { throw new Error("reload unavailable"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage blocked"); });
  render(view(original)); choose(); await confirm();
  fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));
  await screen.findByRole("button", { name: "重新载入生活空间" });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("恢复完成。恢复前安全快照：C:\\safe\\before.json");
  expect(screen.getByRole("button", { name: "确认恢复" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));
  fireEvent.click(screen.getByRole("button", { name: "重新载入生活空间" }));
  expect(original.restore).toHaveBeenCalledOnce();
  expect(reloadApplication).toHaveBeenCalledTimes(2);
});

it.each(["success", "failure"])("does not reload or show an old restore result after source replacement (%s)", async outcome => {
  const original = service(), replacement = service();
  const pending = deferred<string>();
  original.restore.mockReturnValueOnce(pending.promise);
  const page = render(view(original)); choose(); await confirm();
  fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));
  page.rerender(view(replacement));
  await act(async () => {
    if (outcome === "success") pending.resolve("original-safety.json");
    else pending.reject("private path");
  });
  expect(reloadApplication).not.toHaveBeenCalled();
  expect(replacement.restore).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "重新载入生活空间" })).toBeNull();
});

it("retains the committed safety receipt but does not reload an unmounted page", async () => {
  const original = service();
  const pending = deferred<string>();
  original.restore.mockReturnValueOnce(pending.promise);
  const page = render(view(original)); choose(); await confirm();
  fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));
  page.unmount();
  await act(async () => pending.resolve("saved-before.json"));
  expect(reloadApplication).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("lifeos-last-safety-snapshot")).toBe("恢复完成。恢复前安全快照：saved-before.json");
  render(view(original));
  expect(screen.getByRole("status").textContent).toContain("saved-before.json");
  fireEvent.click(screen.getByRole("button", { name: "重新载入生活空间" }));
  expect(reloadApplication).toHaveBeenCalledOnce();
  expect(original.restore).toHaveBeenCalledOnce();
});

it("prevents duplicate downloads and ignores completion after unmount", async () => {
  const original = service();
  const pending = deferred<LifeOSBackup>();
  original.create.mockReturnValueOnce(pending.promise);
  const createURL = vi.fn();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = createURL; });
  const page = render(view(original));
  const button = screen.getByRole("button", { name: "下载 JSON 备份" });
  fireEvent.click(button); fireEvent.click(button);
  expect(original.create).toHaveBeenCalledOnce();
  page.unmount();
  await act(async () => pending.resolve(backup));
  expect(createURL).not.toHaveBeenCalled();
});

it("removes the anchor and releases the URL when download dispatch fails", async () => {
  const original = service();
  const revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:failed");
    static revokeObjectURL = revoke;
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { throw new Error("private download error"); });
  render(view(original));
  fireEvent.click(screen.getByRole("button", { name: "下载 JSON 备份" }));
  expect((await screen.findByRole("alert")).textContent).toBe("无法创建备份，请检查本地数据状态后重试。");
  expect(document.querySelector("a[download]")).toBeNull();
  await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:failed"), { timeout: 2000 });
});
