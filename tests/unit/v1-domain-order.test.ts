import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext } from "../../src/app/LifeOSContext";
import { SetupDomains } from "../../src/components/SetupDomains";
import { LandscapeSettings } from "../../src/components/LandscapeSettings";
import type { LifeDomain } from "../../src/domain/life/LifeDomain";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { defaultLandscapePreference, orderLandscapeDomains } from "../../src/domain/life/LandscapePreference";
import { MemorySqliteExecutor } from "../../src/repositories/memory/MemorySqliteExecutor";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

afterEach(cleanup);

it("persists global order independently of landscape order and rejects stale lists atomically", async () => {
  const db = new DatabaseSync(":memory:");
  const clock = { now: () => new Date("2026-10-14T08:00:00Z") };
  try {
    for (const sql of [nativeSqliteExecutor(db), new MemorySqliteExecutor()]) {
      await new MigrationRunner(sql, migrations, clock).run();
      const repository = new SqliteLifeDomainRepository(sql);
      let id = 0;
      const service = new LifeDomainService(repository, clock, { next: () => `order-${++id}` });
      const draft = { name: "健康", description: "", focus: "照顾睡眠",
        currentState: "恢复中", longTermExpectation: "稳定精力",
        color: "fern" as const, icon: "heart" as const };
      const first = await service.create(draft);
      const paused = await service.create({ ...draft, name: "成长", status: "paused" });
      const archived = await service.create({ ...draft, name: "旧领域", status: "archived" });
      await service.reorder([archived.id, first.id, paused.id]);
      const reread = await new SqliteLifeDomainRepository(sql).list();
      expect(reread).toEqual([
        { ...archived, sortOrder: 0 }, { ...first, sortOrder: 1 }, { ...paused, sortOrder: 2 },
      ]);
      expect(orderLandscapeDomains(reread, defaultLandscapePreference()).map(item => item.id))
        .toEqual([archived.id, first.id, paused.id]);
      expect(orderLandscapeDomains(reread, { ...defaultLandscapePreference(),
        domainOrder: [paused.id, first.id, archived.id] }).map(item => item.id))
        .toEqual([paused.id, first.id, archived.id]);
      await expect(service.reorder([first.id, first.id, paused.id])).rejects.toThrow();
      await expect(service.reorder([first.id, paused.id])).rejects.toThrow();
      await expect(repository.reorder([first.id, "missing", paused.id])).rejects.toThrow();
      expect(await service.list()).toEqual(reread);
      const appended = await service.create({ ...draft, name: "新领域" });
      expect(appended.sortOrder).toBe(3);
      await expect(repository.reorder([first.id, paused.id, archived.id])).rejects.toThrow();
      expect(await service.list()).toEqual([...reread, appended]);
    }
  } finally { db.close(); }
});

it("saves Chinese ordering controls with retry and does not rewrite landscape preferences", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  const initial = await app.lifeDomainService.list();
  const preference = await app.landscapePreferenceService.get();
  const save = vi.spyOn(app.lifeDomainService, "reorder").mockRejectedValueOnce(new Error("disk failure"));
  const pending = vi.fn();
  function Settings() {
    const [domains, setDomains] = useState<readonly LifeDomain[]>();
    return createElement(LifeOSContext.Provider, { value: app },
      createElement(SetupDomains, { onPendingChange: pending, onDomainsChanged: setDomains }),
      createElement(LandscapeSettings, { domainsOverride: domains }));
  }
  render(createElement(MemoryRouter, null, createElement(Settings)));
  const list = await screen.findByRole("list", { name: "领域全局顺序" });
  const focus = await screen.findByRole("checkbox", { name: "当下关注" });
  fireEvent.click(focus);
  const originalLandscapeOrder = within(screen.getByRole("list", { name: "景观节点顺序" }))
    .getAllByRole("listitem").map(item => item.textContent);
  fireEvent.click(within(list).getByRole("button", { name: `下移${initial[0].name}` }));
  expect(within(list).getAllByRole("listitem")[0].textContent).toContain(initial[1].name);
  expect(pending).toHaveBeenLastCalledWith(true);
  expect((screen.getByRole("button", { name: "添加领域" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "保存顺序" }));
  expect((await screen.findByRole("alert")).textContent).toContain("领域顺序保存失败");
  expect(within(list).getAllByRole("listitem")[0].textContent).toContain(initial[1].name);
  fireEvent.click(screen.getByRole("button", { name: "保存顺序" }));
  await screen.findByText("领域顺序已保存");
  expect(save).toHaveBeenCalledTimes(2);
  expect((await app.lifeDomainService.list())[0].id).toBe(initial[1].id);
  expect(await app.landscapePreferenceService.get()).toEqual(preference);
  expect((focus as HTMLInputElement).checked).toBe(!preference.showFocus);
  expect(within(screen.getByRole("list", { name: "景观节点顺序" }))
    .getAllByRole("listitem").map(item => item.textContent)).toEqual(originalLandscapeOrder);
  fireEvent.click(screen.getByRole("button", { name: "撤销未保存修改" }));
  expect(within(screen.getByRole("list", { name: "景观节点顺序" })).getAllByRole("listitem")[0].textContent)
    .toContain(initial[1].name);
  expect(focus).toHaveProperty("checked", preference.showFocus);
  expect(pending).toHaveBeenLastCalledWith(false);
});
