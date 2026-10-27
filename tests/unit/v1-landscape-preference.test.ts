import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext } from "../../src/app/LifeOSContext";
import { LandscapeSettings } from "../../src/components/LandscapeSettings";
import { defaultLandscapePreference, orderLandscapeDomains } from "../../src/domain/life/LandscapePreference";
import { LandscapePage } from "../../src/pages/LandscapePage";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { SqliteSystemRepository } from "../../src/repositories/sqlite/SqliteSystemRepository";
import { LandscapePreferenceService } from "../../src/services/system/LandscapePreferenceService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(cleanup);
it("re-reads preferences from SQLite and keeps hidden domains accessible without changing them", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const clock = { now: () => new Date("2026-10-13T08:00:00Z") };
    const executor = nativeSqliteExecutor(db);
    await new MigrationRunner(executor, migrations, clock).run();
    const repository = new SqliteSystemRepository(executor, clock);
    const service = new LandscapePreferenceService(repository);
    expect(await service.get()).toEqual(defaultLandscapePreference());
    const app = createApplicationDependencies();
    await app.bootstrapApplicationService.bootstrap();
    const domains = await app.lifeDomainService.list();
    expect(domains.length).toBeGreaterThan(1);
    const preference = { domainOrder: domains.map(d => d.id).reverse(), hiddenDomainIds: [domains[0].id], showFocus: false, showReviews: true };
    await service.save(preference);
    expect(await new LandscapePreferenceService(repository).get()).toEqual(preference);
    await expect(service.save({ ...preference, domainOrder: [domains[0].id, domains[0].id] })).rejects.toThrow();
    expect(await service.get()).toEqual(preference);
    expect(orderLandscapeDomains(domains, preference)[0].id).toBe(domains.at(-1)?.id);
    render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider,
      { value: { ...app, landscapePreferenceService: service } }, createElement(LandscapePage))));
    const map = await screen.findByRole("region", { name: "生活领域" });
    await waitFor(() => expect(within(map).queryByRole("link", { name: `进入${domains[0].name}领域` })).toBeNull());
    expect(await screen.findByText(/未在景观显示的领域/)).toBeTruthy();
    expect(screen.getByRole("link", { name: `进入${domains[0].name}领域`, hidden: true })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "正在关注" })).toBeNull();
    expect(await app.lifeDomainService.list()).toEqual(domains);
  } finally { db.close(); }
});

it("disabled reviews remove the homepage entry without changing landscape preferences", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  const before = await app.landscapePreferenceService.get();
  render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider,
    { value: { ...app, modulePreference: { disabledModules: ["reviews"] } } }, createElement(LandscapePage))));
  await screen.findByRole("button", { name: "添加领域", exact: true });
  expect(screen.queryByRole("link", { name: /查看复盘/ })).toBeNull();
  expect(screen.getByRole("heading", { name: "正在关注" })).toBeTruthy();
  expect(await app.landscapePreferenceService.get()).toEqual(before);
});

it("saves Chinese controls and permits retry without losing the draft", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  const save = vi.spyOn(app.landscapePreferenceService, "save").mockRejectedValueOnce(new Error("storage failure"));
  render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider,
    { value: app }, createElement(LandscapeSettings))));
  const focus = await screen.findByRole("checkbox", { name: "当下关注" });
  fireEvent.click(focus);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "景观设置保存失败，请重试。");
  expect((focus as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("已保存");
  expect(save).toHaveBeenCalledTimes(2);
  expect((await app.landscapePreferenceService.get()).showFocus).toBe(false);
});
