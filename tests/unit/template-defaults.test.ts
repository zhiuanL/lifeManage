import { SqliteTemplateRepository } from "../../src/repositories/sqlite/SqliteTemplateRepository";
import { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { SqliteSystemRepository } from "../../src/repositories/sqlite/SqliteSystemRepository";
import { TemplateService } from "../../src/services/templates/TemplateService";
import { reviewTemplateDefaults } from "../../src/domain/templates/Template";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext } from "../../src/app/LifeOSContext";
import { GoalEditorDialog } from "../../src/components/GoalEditorDialog";

afterEach(cleanup);

it("persists defaults in isolated SQLite and protects cycle compatibility", async () => {
  const db = new DatabaseSync(":memory:");
  const clock = { now: () => new Date("2026-10-13T08:00:00Z") };
  try {
    const sql = nativeSqliteExecutor(db);
    await new MigrationRunner(sql, migrations, clock).run();
    const system = new SqliteSystemRepository(sql, clock);
    const service = new TemplateService(new SqliteTemplateRepository(sql), clock, { next: () => "weekly-custom" }, system);
    await service.setDefaultTemplate("goal", "default-okr");
    const weekly = await service.save("review", "每周整理", reviewTemplateDefaults("weekly"));
    await service.setDefaultTemplate("review", weekly.id, "weekly");
    const reloaded = new TemplateService(new SqliteTemplateRepository(sql), clock, { next: () => "unused" }, system);
    expect((await reloaded.getDefaultTemplate("goal"))?.id).toBe("default-okr");
    expect((await reloaded.getDefaultTemplate("review", "weekly"))?.id).toBe(weekly.id);
    await expect(service.setDefaultTemplate("review", weekly.id, "daily")).rejects.toThrow();
    await expect(service.save("review", weekly.name, reviewTemplateDefaults("daily"), weekly.id)).rejects.toThrow();
    expect((await service.getDefaultTemplate("review", "weekly"))?.id).toBe(weekly.id);
    await service.setDefaultTemplate("review", null, "weekly");
    expect(await service.getDefaultTemplate("review", "weekly")).toBeNull();
  } finally { db.close(); }
});

it("uses the saved goal default while an explicit template takes precedence", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  await app.templateService.setDefaultTemplate("goal", "default-exploration");
  const mount = (path: string) => render(createElement(MemoryRouter, { initialEntries: [path] },
    createElement(LifeOSContext.Provider, { value: app }, createElement(GoalEditorDialog, {
      domains: [], goals: [], onClose() {}, onSaved() {},
    }))));
  mount("/goals");
  await waitFor(() => expect(screen.getByRole("textbox", { name: "目标说明" })).toHaveProperty("value", "想探索的假设：\n下一次小尝试："));
  cleanup();
  mount("/goals?template=default-smart");
  await waitFor(() => expect(screen.getByRole("textbox", { name: "目标说明" })).toHaveProperty("value", "具体想实现什么？如何知道已经做到？预期何时完成？"));
  await app.templateService.setDefaultTemplate("goal", null);
});
