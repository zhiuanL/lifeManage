import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext } from "../../src/app/LifeOSContext";
import { SettingsPage } from "../../src/pages/SettingsPage";
import { themeOptions, type ThemeKey } from "../../src/domain/life/ThemePreference";

afterEach(cleanup);
it("persists four specified themes while preserving legacy preferences", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  expect(themeOptions).toHaveLength(4);
  for (const option of themeOptions) {
    await app.themePreferenceService.setTheme(option.key);
    expect(await app.themePreferenceService.getTheme()).toBe(option.key);
  }
  await app.themePreferenceService.setTheme("canopy");
  expect(await app.themePreferenceService.getTheme()).toBe("canopy");
  expect(() => app.themePreferenceService.setTheme("invalid" as ThemeKey)).toThrow();
  expect(await app.themePreferenceService.getTheme()).toBe("canopy");
});
it("offers Chinese settings links and allows retry after a theme save failure", async () => {
  const app = createApplicationDependencies();
  const save = vi.fn().mockRejectedValueOnce(new Error("raw storage failure")).mockResolvedValueOnce(undefined);
  render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider,
    { value: { ...app, setTheme: save } }, createElement(SettingsPage))));
  expect(screen.getByRole("link", { name: "备份与恢复" }).getAttribute("href")).toBe("/backup");
  fireEvent.click(screen.getByRole("button", { name: "暖色深色" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "主题保存失败，请重试。");
  fireEvent.click(screen.getByRole("button", { name: "暖色深色" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
