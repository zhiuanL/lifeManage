import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext } from "../../src/app/LifeOSContext";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { defaultAttentionSettings } from "../../src/domain/attention/Attention";
import { SettingsPage } from "../../src/pages/SettingsPage";
import { SetupPage } from "../../src/pages/SetupPage";
import { SqliteSystemRepository } from "../../src/repositories/sqlite/SqliteSystemRepository";
import { AttentionService } from "../../src/services/attention/AttentionService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("reuses persisted reminder rules across services and rejects invalid settings without overwriting", async () => {
  const db = new DatabaseSync(":memory:");
  const clock = { now: () => new Date("2026-10-14T08:00:00Z") };
  const app = createApplicationDependencies();
  try {
    const sql = nativeSqliteExecutor(db);
    await new MigrationRunner(sql, migrations, clock).run();
    const service = () => new AttentionService(app.goalService, app.actionService, app.issueService,
      new SqliteSystemRepository(sql, clock), clock, app.domainMetricService, app.habitService,
      app.resourceService, app.decisionService, app.reviewService, app.lifeRecordsService);
    expect(await service().getSettings()).toEqual(defaultAttentionSettings);
    const saved = { idleWeeks: 6, issueOccurrences: 4, planAdjustments: 5, metricDrops: 3 };
    await service().setSettings(saved);
    expect(await service().getSettings()).toEqual(saved);
    await expect(service().setSettings({ ...saved, planAdjustments: 1 })).rejects.toThrow();
    expect(await service().getSettings()).toEqual(saved);
    await new MigrationRunner(sql, migrations, clock).run();
    expect(await service().getSettings()).toEqual(saved);
  } finally { db.close(); }
});

it("edits Chinese reminder rules centrally with retry and protects unsaved initialization changes", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  await app.attentionService.setSettings({ ...defaultAttentionSettings });
  const save = vi.spyOn(app.attentionService, "setSettings")
    .mockRejectedValueOnce(new Error("SQLITE_BUSY: private storage path"));
  const settings = render(createElement(MemoryRouter, {}, createElement(LifeOSContext.Provider,
    { value: app }, createElement(SettingsPage))));
  const rules = within(await screen.findByRole("region", { name: "提醒规则" }));
  const input = await rules.findByLabelText("28 天内改期次数");
  fireEvent.change(input, { target: { value: "5" } });
  fireEvent.click(rules.getByRole("button", { name: "保存规则" }));
  expect((await rules.findByRole("alert")).textContent).toBe("提醒规则保存失败，请重试。");
  expect((input as HTMLInputElement).value).toBe("5");
  expect(await app.attentionService.getSettings()).toEqual(defaultAttentionSettings);
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.click(rules.getByRole("button", { name: "保存规则" }));
  expect(save).toHaveBeenCalledTimes(1);
  expect(rules.getByRole("alert").textContent).toContain("2–10");
  fireEvent.change(input, { target: { value: "5" } });
  fireEvent.click(rules.getByRole("button", { name: "保存规则" }));
  await rules.findByText("已保存");
  expect((await app.attentionService.getSnapshot()).settings.planAdjustments).toBe(5);
  settings.unmount();

  await app.setupProgressService.save({ step: 4, completed: false });
  vi.spyOn(app.attentionService, "getSettings").mockRejectedValueOnce(new Error("storage unavailable"));
  render(createElement(MemoryRouter, { initialEntries: ["/setup"] },
    createElement(LifeOSContext.Provider, { value: app }, createElement(SetupPage))));
  expect((await screen.findByRole("alert")).textContent).toBe("提醒规则读取失败，请重试。");
  const next = screen.getByRole("button", { name: "下一步" }) as HTMLButtonElement;
  expect(next.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  await waitFor(() => expect((screen.getByLabelText("28 天内改期次数") as HTMLInputElement).value).toBe("5"));
  await waitFor(() => expect(next.disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
  expect(next.disabled).toBe(true);
  expect((await app.attentionService.getSettings()).planAdjustments).toBe(5);
  fireEvent.click(screen.getByRole("button", { name: "保存规则" }));
  await screen.findByText("已保存");
  expect(await app.attentionService.getSettings()).toEqual(defaultAttentionSettings);
  await waitFor(() => expect(next.disabled).toBe(false));
});
