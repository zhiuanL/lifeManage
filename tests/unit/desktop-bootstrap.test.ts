import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSProvider } from "../../src/app/LifeOSProvider";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { DatabaseCompatibilityError } from "../../src/db/DatabaseCompatibilityError";
import { migrations } from "../../src/db/migrations";
import { createReviewStructure, reviewTypes } from "../../src/domain/reviews/ReviewStructure";
import { GoalsPage } from "../../src/pages/GoalsPage";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

vi.mock("../../src/app/applicationDependencies", () => ({
  createApplicationDependencies: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const clock = { now: () => new Date("2026-09-29T08:00:00Z") };

describe("desktop initialization", () => {
  it("permits writes used by the migrations and repositories", () => {
    const capability = JSON.parse(readFileSync(
      "src-tauri/capabilities/default.json", "utf8",
    )) as { permissions: string[] };
    expect(capability.permissions).toContain("sql:default");
    expect(capability.permissions).toContain("sql:allow-execute");
  });

  it("initializes an empty SQLite database and skips migrations on retry", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const runner = new MigrationRunner(nativeSqliteExecutor(db), migrations, clock);
      expect((await runner.run()).appliedMigrationIds).toHaveLength(migrations.length);
      expect((await runner.run()).appliedMigrationIds).toEqual([]);
      expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all())
        .toEqual(migrations.map((migration) => ({ version: migration.id })));
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'app_metadata'").get())
        .toEqual({ name: "app_metadata" });
    } finally {
      db.close();
    }
  });

  it("enables five-cycle review persistence through production application bootstrap", async () => {
    const actual = await vi.importActual<typeof import("../../src/app/applicationDependencies")>(
      "../../src/app/applicationDependencies",
    );
    const dependencies = actual.createApplicationDependencies();
    expect(dependencies.environment).toBe("browser-preview");
    const result = await dependencies.bootstrapApplicationService.bootstrap();
    expect(result.migrationVersion).toBe("0052-v1-landscape-context");
    for (const type of reviewTypes) {
      const structure = createReviewStructure(type, "2026-10-13");
      const review = await dependencies.reviewService.create({
        title: "Bootstrap " + type, reflection: "", insight: "", nextFocus: "",
        domainId: null, reviewedOn: "2026-10-13", structure,
      });
      expect((await dependencies.reviewService.list()).find(item => item.id === review.id)?.structure)
        .toEqual(structure);
      await dependencies.reviewService.update(review.id, {
        ...review, structure: { ...structure, status: "completed" },
      });
      const versions = await dependencies.versionHistoryService.list("review", review.id);
      expect(versions[0].snapshot.review_status).toBe("draft");
      expect(versions[0].snapshot.answers).toHaveLength(structure.template.fields.length);
    }
    expect((await dependencies.bootstrapApplicationService.bootstrap()).migrationVersion)
      .toBe("0052-v1-landscape-context");
  });

  it("rolls back schema and version together if one migration statement fails", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const runner = new MigrationRunner(nativeSqliteExecutor(db), [{
        id: "0001-failing",
        statements: ["CREATE TABLE unfinished (id TEXT)", "INSERT INTO table_that_does_not_exist VALUES (1)"],
      }], clock);
      await expect(runner.run()).rejects.toThrow();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'unfinished'").all()).toEqual([]);
      expect(db.prepare("SELECT version FROM schema_migrations").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("redacts a string rejection from the Tauri SQL plugin", async () => {
    vi.mocked(createApplicationDependencies).mockReturnValue({
      bootstrapApplicationService: { bootstrap: vi.fn().mockRejectedValue("SQL 写入权限被拒绝") },
    } as unknown as ReturnType<typeof createApplicationDependencies>);

    render(createElement(LifeOSProvider, { children: createElement("div", null, "内容") }));

    expect(await screen.findByText("本地数据初始化失败，请重试。若持续失败，请先备份本地数据，再检查文件访问权限。")).toBeTruthy();
    expect(screen.queryByText("SQL 写入权限被拒绝")).toBeNull();
  });

  it("provides progress services through the application and saves, retries, and removes items", async () => {
    const actual = await vi.importActual<typeof import("../../src/app/applicationDependencies")>(
      "../../src/app/applicationDependencies",
    );
    const dependencies = actual.createApplicationDependencies();
    expect(dependencies.environment).toBe("browser-preview");
    await dependencies.bootstrapApplicationService.bootstrap();
    const goal = await dependencies.goalService.create({
      title: "入口进度测试", description: "", domainId: null, status: "active", targetDate: null,
    });
    await dependencies.actionService.create({
      title: "关联行动", notes: "", domainId: null, goalId: goal.id, scheduledFor: null,
    });
    vi.mocked(createApplicationDependencies).mockReturnValue(dependencies);
    render(createElement(LifeOSProvider, {
      children: createElement(MemoryRouter, null, createElement(GoalsPage)),
    }));
    const label = `${goal.title}关联事项进展`;
    expect(await screen.findByRole("progressbar", { name: label })).toHaveProperty("value", 0);
    fireEvent.click(screen.getByRole("button", { name: `编辑进度项：${goal.title}` }));
    let dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "名称" }),
      { target: { value: "关键成果" } });
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "当前值" }),
      { target: { value: "4" } });
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "目标值" }),
      { target: { value: "10" } });
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "权重" }),
      { target: { value: "3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加进度项" }));
    const second = within(dialog).getByRole("group", { name: "进度项 2" });
    fireEvent.change(within(second).getByRole("combobox", { name: "类型" }),
      { target: { value: "milestone" } });
    fireEvent.change(within(second).getByRole("textbox", { name: "名称" }),
      { target: { value: "阶段成果" } });
    fireEvent.change(within(second).getByRole("spinbutton", { name: "当前值" }),
      { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存进度" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("progressbar", { name: label })).toHaveProperty("value", 55);
    const before = (await dependencies.goalProgressItemService.list())
      .filter((item) => item.goalId === goal.id);
    expect(before).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: `编辑进度项：${goal.title}` }));
    dialog = screen.getByRole("dialog");
    const first = within(dialog).getByRole("group", { name: "进度项 1" });
    expect(within(first).getByRole("textbox", { name: "名称" }))
      .toHaveProperty("value", "关键成果");
    fireEvent.change(within(first).getByRole("spinbutton", { name: "当前值" }),
      { target: { value: "10" } });
    vi.spyOn(dependencies.goalProgressItemService, "replace")
      .mockRejectedValueOnce(new Error("测试保存失败，请重试。"));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存进度" }));
    expect(await within(dialog).findByRole("alert"))
      .toHaveProperty("textContent", "保存失败，请重试。");
    expect((await dependencies.goalProgressItemService.list())
      .filter((item) => item.goalId === goal.id)).toEqual(before);
    fireEvent.click(within(dialog).getByRole("button", { name: "保存进度" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("progressbar", { name: label })).toHaveProperty("value", 100);
    expect(await dependencies.versionHistoryService.list("goal", goal.id)).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: `编辑进度项：${goal.title}` }));
    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "移除进度项 2" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "移除进度项 1" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存进度" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("progressbar", { name: label })).toHaveProperty("value", 0);
    expect((await dependencies.goalProgressItemService.list())
      .filter((item) => item.goalId === goal.id)).toEqual([]);
  });

  it("does not modify a legacy database when the migration table is incompatible", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);
        CREATE TABLE life_domains (id TEXT PRIMARY KEY, name TEXT);
        INSERT INTO life_domains VALUES ('old-domain', '原有领域')`);
      const original = db.prepare("SELECT * FROM life_domains").all();
      const originalSchema = db.prepare("PRAGMA table_info(schema_migrations)").all();

      await expect(new MigrationRunner(nativeSqliteExecutor(db), migrations, clock).run())
        .rejects.toThrow(/旧版|不兼容/);
      await expect(new MigrationRunner(nativeSqliteExecutor(db), migrations, clock).run())
        .rejects.toBeInstanceOf(DatabaseCompatibilityError);

      expect(db.prepare("SELECT * FROM life_domains").all()).toEqual(original);
      expect(db.prepare("PRAGMA table_info(schema_migrations)").all()).toEqual(originalSchema);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'app_metadata'").all())
        .toEqual([]);
    } finally {
      db.close();
    }
  });

  it("refuses to initialize over unversioned user tables", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE TABLE life_domains (id TEXT PRIMARY KEY)");
      await expect(new MigrationRunner(nativeSqliteExecutor(db), migrations, clock).run())
        .rejects.toThrow(/旧版|不兼容/);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'").all())
        .toEqual([]);
    } finally {
      db.close();
    }
  });

  it("refuses a database created by a newer version", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
        INSERT INTO schema_migrations VALUES ('9999-future', '2026-09-29T08:00:00Z')`);
      await expect(new MigrationRunner(nativeSqliteExecutor(db), migrations, clock).run())
        .rejects.toThrow(/较新版本/);
      await expect(new MigrationRunner(nativeSqliteExecutor(db), migrations, clock).run())
        .rejects.toBeInstanceOf(DatabaseCompatibilityError);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'app_metadata'").all())
        .toEqual([]);
    } finally {
      db.close();
    }
  });
});
