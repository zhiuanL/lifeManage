import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import type { AssessmentDraft, SystemAssessment } from "../../src/domain/assessments/SystemAssessment";
import type { ObjectVersion, VersionType } from "../../src/domain/records/ObjectVersion";
import { builtInTemplates, reviewTemplateDefaults, TemplateValidationError, type Template } from "../../src/domain/templates/Template";
import type { SystemAssessmentRepository } from "../../src/repositories/assessments/SystemAssessmentRepository";
import type { ObjectVersionRepository } from "../../src/repositories/history/ObjectVersionRepository";
import { SqliteObjectVersionRepository } from "../../src/repositories/sqlite/SqliteObjectVersionRepository";
import { SqliteSystemAssessmentRepository } from "../../src/repositories/sqlite/SqliteSystemAssessmentRepository";
import { SqliteTemplateRepository } from "../../src/repositories/sqlite/SqliteTemplateRepository";
import type { SystemRepository } from "../../src/repositories/system/SystemRepository";
import type { TemplateRepository } from "../../src/repositories/templates/TemplateRepository";
import { SystemAssessmentService } from "../../src/services/assessments/SystemAssessmentService";
import { VersionHistoryService } from "../../src/services/history/VersionHistoryService";
import type { IdentityRoleService } from "../../src/services/life/IdentityRoleService";
import { TemplateSavedReadError, TemplateService } from "../../src/services/templates/TemplateService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const stamp = "2026-10-22T08:00:00.000Z";
const clock = { now: () => new Date(stamp) };

function templateRepository(seed: readonly Template[] = []) {
  const rows = new Map(seed.map(row => [row.id, structuredClone(row)]));
  const repo = {
    list: vi.fn(async () => [...rows.values()].map(row => structuredClone(row))),
    findById: vi.fn(async (id: string) => {
      const row = rows.get(id);
      return row ? structuredClone(row) : null;
    }),
    create: vi.fn(async (row: Template) => {
      if (rows.has(row.id)) return false;
      rows.set(row.id, structuredClone(row));
      return true;
    }),
    update: vi.fn(async (row: Template) => {
      const previous = rows.get(row.id);
      if (!previous) return false;
      rows.set(row.id, { ...structuredClone(row), version: previous.version + 1 });
      return true;
    }),
  } satisfies TemplateRepository;
  return { repo, rows };
}

function metadataRepository() {
  const values = new Map<string, string>();
  const repo = {
    getMetadata: vi.fn(async (key: string) => values.get(key) ?? null),
    setMetadata: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    completeFirstInitialization: vi.fn(async () => {}),
  } satisfies SystemRepository;
  return { repo, values };
}

function assessmentDraft(overrides: Partial<AssessmentDraft> = {}): AssessmentDraft {
  return { periodKind: "month", periodStart: "2026-10-01", clarity: " 更清楚 ",
    alignment: "", reviews: "", decisions: "", earlyIssues: "", adjustment: "", ...overrides };
}

describe("V1 services use typed repositories without an SQL executor", () => {
  it("creates and revises templates while presets and existing instances remain independent", async () => {
    const { repo } = templateRepository();
    const service = new TemplateService(repo, clock, { next: () => "custom" });
    const preset = await service.find("default-smart");
    expect(repo.findById).not.toHaveBeenCalled();
    expect((await service.list()).filter(row => row.builtIn)).toEqual(builtInTemplates);
    const copy = await service.save("goal", " 我的目标 ", { description: " 原文 " });
    expect(copy).toMatchObject({ id: "custom", name: "我的目标", version: 1,
      defaults: { description: " 原文 " }, createdAt: stamp, updatedAt: stamp, builtIn: false });
    const updated = await service.save("goal", "新模板", { description: "新版" }, copy.id);
    expect(updated.version).toBe(2);
    expect(copy.defaults.description).toBe(" 原文 ");
    expect(await service.find("default-smart")).toEqual(preset);
    await expect(service.save("goal", "覆盖", {}, "default-smart")).rejects.toThrow("系统模板");
    await expect(service.save("goal", "空白", { unknown: "字段" })).rejects.toThrow("字段");
    await expect(service.save("habit", "错误类型", {}, copy.id)).rejects.toThrow();
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledTimes(1);
  });

  it("rejects unsuccessful writes and missing post-save rereads instead of reporting success", async () => {
    const { repo } = templateRepository();
    let sequence = 0;
    const service = new TemplateService(repo, clock, { next: () => `custom-${++sequence}` });
    repo.create.mockResolvedValueOnce(false);
    await expect(service.save("goal", "目标", {})).rejects.toThrow("模板保存失败");
    expect(repo.findById).not.toHaveBeenCalled();
    const row = await service.save("goal", "目标", {});
    repo.update.mockResolvedValueOnce(false);
    await expect(service.save("goal", "调整", {}, row.id)).rejects.toThrow("已不存在");
    expect((await service.find(row.id))?.version).toBe(1);
    repo.findById.mockResolvedValueOnce(null);
    await expect(service.save("goal", "再次保存", {})).rejects.toMatchObject({
      name: "TemplateSavedReadError", templateId: "custom-3",
    });
    expect(repo.create).toHaveBeenCalledTimes(3);
    expect(await service.find("custom-3")).toMatchObject({ name: "再次保存", version: 1 });
    expect(repo.create).toHaveBeenCalledTimes(3);
  });

  it.each(["create", "update"] as const)("reports confirmed %s separately from a failed reread", async operation => {
    const { repo } = templateRepository();
    const service = new TemplateService(repo, clock, { next: () => "confirmed" });
    if (operation === "update") {
      await service.save("goal", "旧版", {});
      repo.findById.mockImplementationOnce(async () => structuredClone({
        id: "confirmed", category: "goal", name: "旧版", defaults: {}, version: 1,
        builtIn: false, createdAt: stamp, updatedAt: stamp,
      } as Template));
    }
    repo.findById.mockRejectedValueOnce(new Error("private SQL"));
    const failure = await service.save("goal", "已保存", {}, operation === "update" ? "confirmed" : undefined)
      .catch(reason => reason);
    expect(failure).toBeInstanceOf(TemplateSavedReadError);
    expect(failure.templateId).toBe("confirmed");
    expect(failure.message).not.toContain("SQL");
    const reads = await service.find(failure.templateId);
    expect(reads).toMatchObject({ name: "已保存", version: operation === "update" ? 2 : 1 });
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledTimes(operation === "update" ? 1 : 0);
  });

  it("types only business validation and preserves repository failures", async () => {
    const { repo } = templateRepository();
    const service = new TemplateService(repo, clock, { next: () => "custom" });
    await expect(service.save("goal", "", {})).rejects.toBeInstanceOf(TemplateValidationError);
    expect(repo.create).not.toHaveBeenCalled();
    const reason = new Error("private SQL");
    repo.create.mockRejectedValueOnce(reason);
    await expect(service.save("goal", "合法", {})).rejects.toBe(reason);
    repo.findById.mockRejectedValueOnce(reason);
    await expect(service.save("goal", "合法", {}, "existing")).rejects.toBe(reason);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("protects five-cycle defaults and requires an explicit clear before changing the chosen cycle", async () => {
    const { repo } = templateRepository();
    const system = metadataRepository();
    const service = new TemplateService(repo, clock, { next: () => "weekly" }, system.repo);
    expect(await service.getDefaultTemplate("goal")).toBeNull();
    const weekly = await service.save("review", "每周", reviewTemplateDefaults("weekly"));
    await service.setDefaultTemplate("review", weekly.id, "weekly");
    expect(await service.getDefaultTemplate("review", "weekly")).toEqual(weekly);
    expect(await service.getDefaultTemplate("review", "monthly")).toBeNull();
    await expect(service.setDefaultTemplate("review", weekly.id, "monthly")).rejects.toThrow("对应类型");
    await expect(service.save("review", "改为月度", reviewTemplateDefaults("monthly"), weekly.id))
      .rejects.toThrow("先取消");
    expect(repo.update).not.toHaveBeenCalled();
    await service.setDefaultTemplate("review", null, "weekly");
    await service.save("review", "改为月度", reviewTemplateDefaults("monthly"), weekly.id);
    expect(await service.getDefaultTemplate("review", "weekly")).toBeNull();
    system.values.set("v1_default_template_goal", "missing");
    await expect(service.getDefaultTemplate("goal")).rejects.toThrow("默认模板不可用");
    await expect(new TemplateService(repo, clock, { next: () => "unused" })
      .setDefaultTemplate("goal", null)).rejects.toThrow("设置不可用");
  });

  it("validates history requests before querying and delegates role history separately", async () => {
    const version: ObjectVersion = { id: 12, type: "goal", objectId: "g",
      changedAt: stamp, snapshot: { title: " 原始目标 ", domain_ids: [] } };
    const list = vi.fn<ObjectVersionRepository["list"]>().mockResolvedValue([version]);
    const repo = { list } satisfies ObjectVersionRepository;
    const service = new VersionHistoryService(repo);
    await expect(service.list("invalid" as VersionType, "g")).rejects.toThrow("有效");
    await expect(service.list("goal", "")).rejects.toThrow("有效");
    await expect(service.list("role", "r")).rejects.toThrow("暂不可用");
    expect(repo.list).not.toHaveBeenCalled();
    expect(await service.list("goal", "g")).toEqual([version]);
    expect(repo.list).toHaveBeenCalledExactlyOnceWith("goal", "g");
    const listHistory = vi.fn(async () => [{ version: 3, roleId: "r",
      changedAt: stamp, snapshot: { name: " 原角色 " } }]);
    const roles = { listHistory } as unknown as IdentityRoleService;
    expect(await new VersionHistoryService(repo, roles).list("role", "r")).toEqual([
      { id: 3, type: "role", objectId: "r", changedAt: stamp, snapshot: { name: " 原角色 " } },
    ]);
    expect(listHistory).toHaveBeenCalledExactlyOnceWith("r");
    expect(repo.list).toHaveBeenCalledTimes(1);
  });

  it("upserts assessments by kind and start while preserving identity and original creation time", async () => {
    const rows: SystemAssessment[] = [];
    const repo = {
      list: vi.fn(async () => rows.map(row => ({ ...row }))),
      save: vi.fn(async (row: SystemAssessment, create: boolean) => {
        if (create) rows.push({ ...row });
        else rows[rows.findIndex(item => item.id === row.id)] = { ...row };
        return true;
      }),
    } satisfies SystemAssessmentRepository;
    let sequence = 0;
    const ids = { next: vi.fn(() => `assessment-${++sequence}`) };
    const service = new SystemAssessmentService(repo, clock, ids);
    const first = await service.save(assessmentDraft());
    expect(first.clarity).toBe("更清楚");
    const later = new SystemAssessmentService(repo, { now: () => new Date("2026-10-23T08:00:00Z") }, ids);
    const updated = await later.save(assessmentDraft({ clarity: "", adjustment: " 调整 " }));
    expect(updated).toMatchObject({ id: first.id, createdAt: stamp,
      updatedAt: "2026-10-23T08:00:00.000Z", clarity: "", adjustment: "调整" });
    expect(repo.save.mock.calls.map(call => call[1])).toEqual([true, false]);
    await service.save(assessmentDraft({ periodKind: "quarter" }));
    expect(ids.next).toHaveBeenCalledTimes(2);
    expect(await service.list()).toHaveLength(2);
    const reads = repo.list.mock.calls.length;
    await expect(service.save(assessmentDraft({ periodStart: "2026-10-02" }))).rejects.toThrow("起始日期");
    await expect(service.save(assessmentDraft({ clarity: "x".repeat(601) }))).rejects.toThrow("600");
    expect(repo.list).toHaveBeenCalledTimes(reads);
    repo.save.mockResolvedValueOnce(false);
    await expect(service.save(assessmentDraft())).rejects.toThrow("评估保存失败");
    expect((await service.list())[0].adjustment).toBe("调整");
  });
});

describe("V1 extracted SQLite adapters preserve existing persistence contracts", () => {
  it("retains raw template values, database-owned revisions and zero-row failure checks", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations, clock).run();
      const repo = new SqliteTemplateRepository(sql);
      const original: Template = { id: "raw", category: "goal", name: " 原模板 ", version: 99,
        builtIn: false, defaults: { description: " 原文\n", progressMode: "exploration" },
        createdAt: "2026-10-01T08:00:00.000Z", updatedAt: stamp };
      expect(await repo.create(original)).toBe(true);
      const read = await repo.findById(original.id);
      expect(read).toEqual({ ...original, version: 1 });
      expect(await repo.update({ ...original, name: "调整", version: 200,
        createdAt: stamp, defaults: { description: "" } })).toBe(true);
      expect(await repo.findById(original.id)).toMatchObject({ name: "调整", version: 2,
        createdAt: original.createdAt, defaults: { description: "" } });
      expect(await repo.update({ ...original, id: "missing" })).toBe(false);
      expect(await repo.findById("missing")).toBeNull();
      expect(await repo.list()).toHaveLength(1);
      // Only the isolated fixture bypasses CHECK to exercise a damaged storage read.
      db.exec("PRAGMA ignore_check_constraints=ON");
      db.prepare("UPDATE templates SET defaults_json = ? WHERE id = ?").run("{", original.id);
      await expect(repo.findById(original.id)).rejects.toThrow();
    } finally { db.close(); }
  });

  it("orders versions by identifier, filters both keys and reads original snapshots without normalization", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations, clock).run();
      const insert = db.prepare(`INSERT INTO object_versions
        (id, object_type, object_id, changed_at, snapshot_json) VALUES (?, ?, ?, ?, ?)`);
      insert.run(1, "goal", "g", "2026-10-22T09:00:00Z", '{"title":" 原文 ","missing":null}');
      insert.run(2, "goal", "g", "2026-10-22T08:00:00Z", '{"title":""}');
      insert.run(3, "goal", "other", stamp, "{}");
      insert.run(4, "review", "g", stamp, "{}");
      const repo = new SqliteObjectVersionRepository(sql);
      const records = await repo.list("goal", "g");
      expect(records.map(row => row.id)).toEqual([2, 1]);
      expect(records[1].snapshot).toEqual({ title: " 原文 ", missing: null });
      expect(records[0].snapshot).toEqual({ title: "" });
      expect(await repo.list("goal", "missing")).toEqual([]);
      db.exec("PRAGMA ignore_check_constraints=ON");
      db.prepare("UPDATE object_versions SET snapshot_json = ? WHERE id = 2").run("{");
      await expect(repo.list("goal", "g")).rejects.toThrow();
    } finally { db.close(); }
  });

  it("keeps assessment creation facts and separates monthly from quarterly records", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const sql = nativeSqliteExecutor(db);
      await new MigrationRunner(sql, migrations, clock).run();
      const repo = new SqliteSystemAssessmentRepository(sql);
      const row: SystemAssessment = { ...assessmentDraft(), id: "month",
        createdAt: "2026-10-01T08:00:00.000Z", updatedAt: stamp };
      expect(await repo.save(row, true)).toBe(true);
      expect(await repo.save({ ...row, id: "quarter", periodKind: "quarter" }, true)).toBe(true);
      expect(await repo.save({ ...row, clarity: "", adjustment: " 原文\n", createdAt: stamp }, false)).toBe(true);
      expect(await repo.save({ ...row, id: "missing" }, false)).toBe(false);
      expect(await repo.list()).toMatchObject([
        { id: "month", periodKind: "month", clarity: "", adjustment: " 原文\n", createdAt: row.createdAt },
        { id: "quarter", periodKind: "quarter", clarity: " 更清楚 " },
      ]);
    } finally { db.close(); }
  });
});
