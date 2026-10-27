import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { AttentionSettingsEditor } from "../../src/components/AttentionSettingsEditor";
import { LandscapeSettings } from "../../src/components/LandscapeSettings";
import { ModuleSettings } from "../../src/components/ModuleSettings";
import { SetupDomains } from "../../src/components/SetupDomains";
import { defaultAttentionSettings } from "../../src/domain/attention/Attention";
import { defaultLandscapePreference } from "../../src/domain/life/LandscapePreference";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";
import { defaultModulePreference } from "../../src/domain/system/ModulePreference";
import { SettingsPage } from "../../src/pages/SettingsPage";
import { SetupPage } from "../../src/pages/SetupPage";

afterEach(cleanup);

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

type SettingsContext = LifeOSContextValue & {
  setupProgressService: NonNullable<LifeOSContextValue["setupProgressService"]>;
  setModulePreference: NonNullable<LifeOSContextValue["setModulePreference"]>;
};

function context(): SettingsContext {
  const stamp = "2026-10-22T08:00:00Z";
  const domains = ["健康", "成长"].map((name, index) => ({
    id: `domain-${index}`, name, status: "active", sortOrder: index, color: "fern", icon: "heart",
    description: "", focus: "", currentState: "", longTermExpectation: "",
    createdAt: stamp, updatedAt: stamp,
  })) as LifeDomain[];
  return {
    theme: "mist", setTheme: vi.fn(async () => {}),
    modulePreference: defaultModulePreference(), setModulePreference: vi.fn(async () => {}),
    lifeDomainService: { list: async () => domains, reorder: vi.fn(async () => {}) },
    landscapePreferenceService: { get: async () => defaultLandscapePreference(), save: vi.fn(async () => {}) },
    attentionService: { getSettings: async () => ({ ...defaultAttentionSettings }),
      setSettings: vi.fn(async () => {}) },
    templateService: { find: async () => null },
    setupProgressService: { get: async () => ({ step: 5, completed: false }),
      save: vi.fn(async () => {}) },
  } as unknown as SettingsContext;
}

describe("V1 settings save lifecycle", () => {
  for (const kind of ["attention", "landscape"] as const) {
    it(`${kind} protects the entire draft during saving and keeps it available after failure`, async () => {
      const app = context();
      const request = deferred();
      const save = kind === "attention"
        ? vi.spyOn(app.attentionService, "setSettings")
        : vi.spyOn(app.landscapePreferenceService, "save");
      save.mockImplementationOnce(() => request.promise);
      const pending = vi.fn();
      const editor = kind === "attention" ? AttentionSettingsEditor : LandscapeSettings;
      render(<LifeOSContext.Provider value={app}>
        {createElement(editor, { onPendingChange: pending })}
      </LifeOSContext.Provider>);
      const field = await screen.findByLabelText(kind === "attention" ? "28 天内改期次数" : "当下关注");
      if (kind === "attention") fireEvent.change(field, { target: { value: "5" } });
      else fireEvent.click(field);
      const button = screen.getByRole("button", { name: kind === "attention" ? "保存规则" : "保存" });
      fireEvent.click(button);
      fireEvent.click(button);
      expect(save).toHaveBeenCalledTimes(1);
      expect(field.matches(":disabled")).toBe(true);
      expect(screen.getByRole("button", { name: "恢复默认" }).matches(":disabled")).toBe(true);
      await act(async () => request.reject(new Error("SQLITE_BUSY: private path")));
      expect((await screen.findByRole("alert")).textContent)
        .toBe(kind === "attention" ? "提醒规则保存失败，请重试。" : "景观设置保存失败，请重试。");
      expect(field.matches(":disabled")).toBe(false);
      if (kind === "attention") expect(field).toHaveProperty("value", "5");
      else expect(field).toHaveProperty("checked", !defaultLandscapePreference().showFocus);
      expect(pending).toHaveBeenLastCalledWith(true);
      fireEvent.click(button);
      await screen.findByText("已保存");
      expect(save).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false));
    });

    for (const outcome of ["success", "failure"] as const) {
      it(`${kind} does not notify the old initialization step after leaving (${outcome})`, async () => {
        const app = context();
        const request = deferred();
        if (kind === "attention") vi.spyOn(app.attentionService, "setSettings").mockReturnValue(request.promise);
        else vi.spyOn(app.landscapePreferenceService, "save").mockReturnValue(request.promise);
        const pending = vi.fn();
        const editor = kind === "attention" ? AttentionSettingsEditor : LandscapeSettings;
        const page = render(<LifeOSContext.Provider value={app}>
          {createElement(editor, { onPendingChange: pending })}
        </LifeOSContext.Provider>);
        const button = await screen.findByRole("button", { name: kind === "attention" ? "保存规则" : "保存" });
        fireEvent.click(button);
        page.unmount();
        const count = pending.mock.calls.length;
        await act(async () => {
          if (outcome === "success") request.resolve();
          else request.reject(new Error("private path"));
        });
        expect(pending).toHaveBeenCalledTimes(count);
      });
    }
  }

  it("locks all theme choices during a pending save and never duplicates the write", async () => {
    const app = context();
    const request = deferred();
    const save = vi.spyOn(app, "setTheme").mockReturnValue(request.promise);
    const page = render(<MemoryRouter><LifeOSContext.Provider value={app}>
      <SettingsPage />
    </LifeOSContext.Provider></MemoryRouter>);
    const choices = within(screen.getByRole("group", { name: "界面主题" }));
    fireEvent.click(choices.getByRole("button", { name: "深黑" }));
    fireEvent.click(choices.getByRole("button", { name: "暖色深色" }));
    expect(save).toHaveBeenCalledExactlyOnceWith("black");
    expect(choices.getAllByRole("button").every(button => button.matches(":disabled"))).toBe(true);
    page.unmount();
    await act(async () => request.reject(new Error("private path")));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps module choices unchanged after failure and protects all toggles during retry", async () => {
    const app = context();
    const request = deferred();
    const save = vi.spyOn(app, "setModulePreference").mockReturnValueOnce(request.promise);
    const pending = vi.fn();
    const page = render(<LifeOSContext.Provider value={app}>
      <ModuleSettings onPendingChange={pending} />
    </LifeOSContext.Provider>);
    fireEvent.click(screen.getByRole("checkbox", { name: "人物" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "习惯" }));
    expect(save).toHaveBeenCalledExactlyOnceWith({ disabledModules: ["people"] });
    expect(screen.getAllByRole("checkbox").every(field => field.matches(":disabled"))).toBe(true);
    await act(async () => request.reject(new Error("private path")));
    expect((await screen.findByRole("alert")).textContent).toBe("模块设置保存失败，请重试。");
    expect(screen.getByRole("checkbox", { name: "人物" })).toHaveProperty("checked", true);
    const retry = deferred();
    save.mockReturnValueOnce(retry.promise);
    fireEvent.click(screen.getByRole("checkbox", { name: "人物" }));
    page.unmount();
    const count = pending.mock.calls.length;
    await act(async () => retry.resolve());
    expect(save).toHaveBeenCalledTimes(2);
    expect(pending).toHaveBeenCalledTimes(count);
  });

  for (const outcome of ["success", "failure"] as const) {
    it(`does not publish domain ordering to the old page after leaving (${outcome})`, async () => {
      const app = context();
      const request = deferred();
      const save = vi.spyOn(app.lifeDomainService, "reorder").mockReturnValue(request.promise);
      const changed = vi.fn();
      const page = render(<MemoryRouter><LifeOSContext.Provider value={app}>
        <SetupDomains onDomainsChanged={changed} />
      </LifeOSContext.Provider></MemoryRouter>);
      fireEvent.click(await screen.findByRole("button", { name: "下移健康" }));
      fireEvent.click(screen.getByRole("button", { name: "保存顺序" }));
      fireEvent.click(screen.getByRole("button", { name: "正在保存" }));
      expect(save).toHaveBeenCalledExactlyOnceWith(["domain-1", "domain-0"]);
      page.unmount();
      const count = changed.mock.calls.length;
      await act(async () => {
        if (outcome === "success") request.resolve();
        else request.reject(new Error("private path"));
      });
      expect(changed).toHaveBeenCalledTimes(count);
    });
  }

  it("does not navigate back to the landscape when initialization finishes after leaving", async () => {
    const app = context();
    const request = deferred();
    const save = vi.spyOn(app.setupProgressService, "save").mockReturnValue(request.promise);
    render(<LifeOSContext.Provider value={app}><MemoryRouter initialEntries={["/setup"]}>
      <Link to="/away">测试离页</Link>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/away" element={<h1>其他页面</h1>} />
        <Route path="/" element={<h1>人生景观</h1>} />
      </Routes>
    </MemoryRouter></LifeOSContext.Provider>);
    const complete = await screen.findByRole("button", { name: "完成初始化" });
    await waitFor(() => expect(complete.matches(":disabled")).toBe(false));
    fireEvent.click(complete);
    fireEvent.click(complete);
    expect(save).toHaveBeenCalledExactlyOnceWith({ step: 5, completed: true });
    fireEvent.click(screen.getByRole("link", { name: "测试离页" }));
    await screen.findByRole("heading", { name: "其他页面" });
    await act(async () => request.resolve());
    expect(screen.getByRole("heading", { name: "其他页面" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "人生景观" })).toBeNull();
  });
});
