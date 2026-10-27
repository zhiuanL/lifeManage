import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext } from "../../src/app/LifeOSContext";
import { ModuleSettings } from "../../src/components/ModuleSettings";
import { MorePage } from "../../src/pages/MorePage";
import { defaultModulePreference, isModulePathEnabled, type ModulePreference } from "../../src/domain/system/ModulePreference";
import { ModulePreferenceService } from "../../src/services/system/ModulePreferenceService";
import { SqliteSystemRepository } from "../../src/repositories/sqlite/SqliteSystemRepository";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
afterEach(cleanup);
it("persists module preferences without accepting invalid replacements", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const clock = { now: () => new Date("2026-10-13T08:00:00Z") };
    const executor = nativeSqliteExecutor(db);
    await new MigrationRunner(executor, migrations, clock).run();
    const repository = new SqliteSystemRepository(executor, clock);
    const service = new ModulePreferenceService(repository);
    expect(await service.get()).toEqual(defaultModulePreference());
    await service.save({ disabledModules: ["habits"] });
    expect(await new ModulePreferenceService(repository).get()).toEqual({ disabledModules: ["habits"] });
    await expect(service.save({ disabledModules: ["habits", "habits"] })).rejects.toThrow();
    expect(isModulePathEnabled("/habits/example", await service.get())).toBe(false);
    expect(isModulePathEnabled("/backup", await service.get())).toBe(true);
  } finally { db.close(); }
});
it("keeps enabled state on save failure, then updates the capability directory", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  const save = vi.spyOn(app.modulePreferenceService, "save").mockRejectedValueOnce(new Error("storage failure"));
  function Harness() {
    const [modulePreference, setPreference] = useState<ModulePreference>(defaultModulePreference());
    return createElement(LifeOSContext.Provider, { value: { ...app, modulePreference,
      setModulePreference: async next => { await app.modulePreferenceService.save(next); setPreference(next); } } },
    createElement(ModuleSettings), createElement(MorePage));
  }
  render(createElement(MemoryRouter, {}, createElement(Harness)));
  const habit = screen.getByRole("checkbox", { name: "习惯", exact: true });
  fireEvent.click(habit);
  await screen.findByText("模块设置保存失败，请重试。");
  expect((habit as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole("link", { name: "习惯", exact: true })).toBeTruthy();
  fireEvent.click(habit);
  await waitFor(() => expect((habit as HTMLInputElement).checked).toBe(false));
  expect(screen.queryByRole("link", { name: "习惯", exact: true })).toBeNull();
  fireEvent.click(habit);
  await screen.findByRole("link", { name: "习惯", exact: true });
  expect(save).toHaveBeenCalledTimes(3);
});
