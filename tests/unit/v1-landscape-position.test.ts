import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext } from "../../src/app/LifeOSContext";
import { LandscapeSettings } from "../../src/components/LandscapeSettings";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { changeLandscapePosition, defaultLandscapePreference, placeLandscapeDomains,
  validateLandscapePreference } from "../../src/domain/life/LandscapePreference";
import { LandscapePage } from "../../src/pages/LandscapePage";
import { SqliteSystemRepository } from "../../src/repositories/sqlite/SqliteSystemRepository";
import { LandscapePreferenceService } from "../../src/services/system/LandscapePreferenceService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(cleanup);

it("re-reads finite positions from SQLite, swaps occupied slots and preserves legacy settings", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  const domains = await app.lifeDomainService.list();
  const legacy = defaultLandscapePreference();
  expect(validateLandscapePreference(legacy)).toEqual(legacy);
  const preference = changeLandscapePosition(domains, legacy, domains[0].id, 1);
  expect(placeLandscapeDomains(domains, preference).nodes.find(n => n.domain.id === domains[0].id)?.slot).toBe(1);
  expect(placeLandscapeDomains(domains, preference).nodes.find(n => n.domain.id === domains[1].id)?.slot).toBe(0);
  const db = new DatabaseSync(":memory:");
  try {
    const sql = nativeSqliteExecutor(db);
    const clock = { now: () => new Date("2026-10-14T08:00:00Z") };
    await new MigrationRunner(sql, migrations, clock).run();
    const repository = new SqliteSystemRepository(sql, clock);
    const service = new LandscapePreferenceService(repository);
    await service.save(preference);
    expect(await new LandscapePreferenceService(repository).get()).toEqual(preference);
    await expect(service.save({ ...preference,
      domainPositions: [{ domainId: domains[0].id, x: 1, y: 1 }] })).rejects.toThrow();
    await expect(service.save({ ...preference, domainPositions: [
      { domainId: domains[0].id, x: 0, y: 0 }, { domainId: domains[1].id, x: 0, y: 0 },
    ] })).rejects.toThrow();
    expect(await service.get()).toEqual(preference);
    const hidden = { ...preference, hiddenDomainIds: [domains[0].id] };
    expect(placeLandscapeDomains(domains, hidden).nodes.some(n => n.domain.id === domains[0].id)).toBe(false);
    expect(hidden.domainPositions).toEqual(preference.domainPositions);
    const many = Array.from({ length: 10 }, (_, index) => ({ ...domains[0], id: `many-${index}`, sortOrder: index }));
    const pinned = changeLandscapePosition(many, legacy, many[9].id, 4);
    expect(placeLandscapeDomains(many, pinned).nodes).toHaveLength(8);
    expect(placeLandscapeDomains(many, pinned).overflow).toHaveLength(2);
    expect(placeLandscapeDomains(many, pinned).nodes.find(n => n.domain.id === many[9].id)?.slot).toBe(4);
    expect(new Set(placeLandscapeDomains(many, pinned).nodes.map(n => n.slot)).size).toBe(8);
    const paused = domains.map(d => d.id === domains[0].id ? { ...d, status: "paused" as const } : d);
    expect(placeLandscapeDomains(paused, preference).nodes.some(n => n.domain.id === domains[0].id)).toBe(false);
    expect(placeLandscapeDomains(domains, preference).nodes.find(n => n.domain.id === domains[0].id)?.slot).toBe(1);
  } finally { db.close(); }
});

it("saves Chinese position selection with retry, renders fixed slots and restores defaults explicitly", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  const domains = await app.lifeDomainService.list();
  await app.landscapePreferenceService.save(defaultLandscapePreference());
  const save = vi.spyOn(app.landscapePreferenceService, "save").mockRejectedValueOnce(new Error("disk"));
  const editor = render(createElement(LifeOSContext.Provider, { value: app }, createElement(LandscapeSettings)));
  const select = await screen.findByRole("combobox", { name: `${domains[0].name}景观位置` });
  fireEvent.change(select, { target: { value: "7" } });
  fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
  await screen.findByRole("alert");
  expect((select as HTMLSelectElement).value).toBe("7");
  fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
  await screen.findByText("已保存");
  expect(save).toHaveBeenCalledTimes(2);
  const before = await app.landscapePreferenceService.get();
  editor.unmount();
  const page = render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider,
    { value: app }, createElement(LandscapePage))));
  await screen.findByRole("link", { name: `进入${domains[0].name}领域` });
  const map = screen.getByRole("region", { name: "生活领域" });
  const link = within(map).getByRole("link", { name: `进入${domains[0].name}领域` });
  expect(link.closest("li")?.getAttribute("data-slot")).toBe("8");
  page.unmount();
  render(createElement(LifeOSContext.Provider, { value: app }, createElement(LandscapeSettings)));
  await screen.findByRole("combobox", { name: `${domains[0].name}景观位置` });
  fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
  expect(await app.landscapePreferenceService.get()).toEqual(before);
  fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
  await screen.findByText("已保存");
  expect(await app.landscapePreferenceService.get()).toEqual(defaultLandscapePreference());
});
