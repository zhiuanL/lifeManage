import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import type { SetupProgress } from "../../src/domain/system/SetupProgress";
import { SetupPage } from "../../src/pages/SetupPage";

function Step({ onPendingChange }: { onPendingChange?(value: boolean): void }) {
  const [dirty, setDirty] = useState(false);
  useEffect(() => { onPendingChange?.(dirty); }, [dirty, onPendingChange]);
  return <label>测试配置<input aria-label="测试配置" onChange={() => setDirty(true)} /></label>;
}
vi.mock("../../src/components/SetupDomains", () => ({ SetupDomains: Step }));
vi.mock("../../src/components/LandscapeSettings", () => ({ LandscapeSettings: Step }));
vi.mock("../../src/components/AttentionSettingsEditor", () => ({ AttentionSettingsEditor: Step }));
vi.mock("../../src/components/ModuleSettings", () => ({ ModuleSettings: Step }));
vi.mock("../../src/pages/TemplatesPage", () => ({ TemplatesPage: Step }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function service(progress: SetupProgress = { step: 0, completed: false }) {
  return { get: vi.fn(async () => progress), save: vi.fn<(next: SetupProgress) => Promise<void>>(async () => {}) };
}
function view(source?: ReturnType<typeof service>) {
  return <LifeOSContext.Provider value={{ setupProgressService: source } as unknown as LifeOSContextValue}>
    <MemoryRouter initialEntries={["/setup"]}>
      <Link to="/away">测试离页</Link>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/" element={<h1>人生景观</h1>} />
        <Route path="/away" element={<h1>其他页面</h1>} />
      </Routes>
    </MemoryRouter>
  </LifeOSContext.Provider>;
}
async function nextButton(name = "下一步") {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  return button;
}

it("immediately hides old progress and ignores an old read after replacement", async () => {
  const original = service(), replacement = service({ step: 5, completed: false });
  const pending = deferred<SetupProgress>();
  replacement.get.mockReturnValueOnce(pending.promise);
  const page = render(view(original));
  await nextButton();
  page.rerender(view(replacement));
  expect(screen.queryByRole("button", { name: "下一步" })).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("正在读取初始化进度");
  await act(async () => pending.resolve({ step: 5, completed: false }));
  await nextButton("完成初始化");
  expect(original.save).not.toHaveBeenCalled();
});

it("does not revive a ready result or pending request when returning to the original service", async () => {
  const original = service(), replacement = service({ step: 4, completed: false });
  const page = render(view(original));
  await nextButton();
  const pending = deferred<SetupProgress>();
  original.get.mockReturnValueOnce(pending.promise);
  page.rerender(view(replacement)); await nextButton();
  page.rerender(view(original));
  expect(screen.queryByRole("button", { name: "下一步" })).toBeNull();
  await act(async () => pending.resolve({ step: 5, completed: false }));
  await nextButton("完成初始化");
  expect(original.get).toHaveBeenCalledTimes(2);
});

it("ignores late old read success without revealing old steps", async () => {
  const original = service(), replacement = service({ step: 5, completed: false });
  const pending = deferred<SetupProgress>();
  original.get.mockReturnValueOnce(pending.promise);
  const page = render(view(original));
  page.rerender(view(replacement));
  await nextButton("完成初始化");
  await act(async () => pending.resolve({ step: 0, completed: false }));
  expect(screen.queryByRole("button", { name: "下一步" })).toBeNull();
  expect(screen.getByRole("button", { name: "完成初始化" })).toBeTruthy();
});

it("sanitizes a read failure and retries only the current service", async () => {
  const original = service();
  original.get.mockRejectedValueOnce(new Error("SQLITE C:\\private\\db"));
  render(view(original));
  expect((await screen.findByRole("alert")).textContent).toBe("初始化进度读取失败，请重试。");
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  await nextButton();
  expect(original.get).toHaveBeenCalledTimes(2);
  expect(original.save).not.toHaveBeenCalled();
});

it("blocks duplicate progress writes and retains the current step after a failed save", async () => {
  const original = service();
  const pending = deferred<void>();
  original.save.mockReturnValueOnce(pending.promise);
  render(view(original));
  const button = await nextButton();
  fireEvent.click(button); fireEvent.click(button);
  expect(original.save).toHaveBeenCalledExactlyOnceWith({ step: 1, completed: false });
  expect(screen.getByLabelText("测试配置").matches(":disabled")).toBe(true);
  await act(async () => pending.reject(new Error("private path")));
  expect((await screen.findByRole("alert")).textContent).toBe("初始化进度保存失败，请重试。");
  expect(screen.getByLabelText("测试配置").matches(":disabled")).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByRole("button", { name: "上一步" })).toHaveProperty("disabled", false));
  expect(original.save).toHaveBeenCalledTimes(2);
  expect(original.get).toHaveBeenCalledOnce();
});

it("does not advance with unsaved child configuration", async () => {
  const original = service();
  render(view(original));
  const button = await nextButton();
  fireEvent.change(screen.getByLabelText("测试配置"), { target: { value: "未保存" } });
  expect(button).toHaveProperty("disabled", true);
  fireEvent.click(button);
  expect(original.save).not.toHaveBeenCalled();
});

it.each(["success", "failure"])("ignores old completion after source replacement (%s)", async outcome => {
  const original = service({ step: 5, completed: false }), replacement = service();
  const pending = deferred<void>();
  original.save.mockReturnValueOnce(pending.promise);
  const page = render(view(original));
  fireEvent.click(await nextButton("完成初始化"));
  page.rerender(view(replacement));
  await screen.findByRole("button", { name: "下一步" });
  await act(async () => {
    if (outcome === "success") pending.resolve();
    else pending.reject("private error");
  });
  await nextButton();
  expect(screen.queryByRole("heading", { name: "人生景观" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(replacement.save).not.toHaveBeenCalled();
});

it("ignores a completed old save after switching away and back to the same service", async () => {
  const original = service({ step: 5, completed: false });
  const pending = deferred<void>();
  original.save.mockReturnValueOnce(pending.promise);
  const page = render(view(original));
  fireEvent.click(await nextButton("完成初始化"));
  page.rerender(view(service())); await screen.findByRole("button", { name: "下一步" });
  page.rerender(view(original)); await screen.findByRole("button", { name: "完成初始化" });
  await act(async () => pending.resolve());
  await nextButton("完成初始化");
  expect(screen.queryByRole("heading", { name: "人生景观" })).toBeNull();
});

it("allows explicit completion but never navigates from an unmounted save", async () => {
  const original = service({ step: 5, completed: false });
  const pending = deferred<void>();
  original.save.mockReturnValueOnce(pending.promise);
  render(view(original));
  fireEvent.click(await nextButton("完成初始化"));
  fireEvent.click(screen.getByRole("link", { name: "测试离页" }));
  await screen.findByRole("heading", { name: "其他页面" });
  await act(async () => pending.resolve());
  expect(screen.getByRole("heading", { name: "其他页面" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "人生景观" })).toBeNull();
});

it("shows unavailable service explicitly instead of an old completed result", async () => {
  const page = render(view(service({ step: 5, completed: true })));
  await screen.findByRole("heading", { name: "生活空间已准备好" });
  page.rerender(view());
  expect(screen.getByRole("alert").textContent).toBe("初始化服务不可用。");
  expect(screen.queryByRole("button", { name: "调整初始化配置" })).toBeNull();
});
