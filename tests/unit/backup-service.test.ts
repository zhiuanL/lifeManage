import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { backupTables } from "../../src/domain/backup/Backup";
import { createReviewStructure } from "../../src/domain/reviews/ReviewStructure";
import { encodeReviewStructure } from "../../src/repositories/reviews/ReviewStructureStorage";
import { BackupService } from "../../src/services/backup/BackupService";
import { BackupValidationError } from "../../src/domain/backup/BackupValidationError";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.mocked(invoke).mockReset());

function fixture() {
  const stored = encodeReviewStructure("review-1", createReviewStructure("weekly", "2026-10-13"));
  return {
    format: "lifeos-backup", schemaVersion: 43, appVersion: "0.1.0", exportedAt: "2026-10-13T08:00:00Z",
    data: { ...Object.fromEntries(backupTables.map(table => [table, []])),
      reviews: [{ id: "review-1", title: "复盘", reflection: "", insight: "", next_focus: "", domain_id: null,
        reviewed_on: "2026-10-13", created_at: "2026-10-13T08:00:00Z", updated_at: "2026-10-13T08:00:00Z",
        ...stored.columns }], review_answers: [...stored.answers] },
  };
}

describe("production backup service preflight", () => {
  it("wraps untrusted field errors in a dedicated safe validation error", () => {
    expect(() => new BackupService().inspect({ data: { "C:\\private\\user.db": [] } }))
      .toThrow(BackupValidationError);
    expect(() => new BackupService().inspect(null))
      .toThrow("备份文件格式、版本或关联校验失败，未更改当前数据。");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("counts candidate answers without invoking the platform or mutating the backup", () => {
    const backup = fixture();
    const before = JSON.stringify(backup);
    const report = new BackupService().inspect(backup);
    expect(report.counts.review_answers).toBe(backup.data.review_answers.length);
    expect(report.total).toBe(1 + backup.data.review_answers.length);
    expect(report.backup).toBe(backup);
    expect(JSON.stringify(backup)).toBe(before);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("restores version 43 through the native contract with a safety snapshot", async () => {
    const service = new BackupService();
    const report = service.inspect(fixture());
    vi.mocked(invoke).mockResolvedValue("review-safety.json");
    await expect(service.restore(report)).resolves.toBe("review-safety.json");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("restore_backup", { backup: report.backup });
  });

  it("rechecks mutated answers before restore", async () => {
    const service = new BackupService();
    const backup = fixture();
    const report = service.inspect(backup);
    backup.data.review_answers[0].review_id = "missing";
    await expect(service.restore(report)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps version 42 native restore and its safety snapshot result", async () => {
    const backup = { ...fixture(), schemaVersion: 42,
      data: Object.fromEntries(backupTables.map(table => [table, []])) };
    const service = new BackupService();
    vi.mocked(invoke).mockResolvedValue("safety.json");
    await expect(service.restore(service.inspect(backup))).resolves.toBe("safety.json");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("restore_backup", { backup });
  });

  it("rejects malformed platform exports", async () => {
    const backup = fixture();
    backup.data.review_answers.pop();
    vi.mocked(invoke).mockResolvedValue(backup);
    await expect(new BackupService().create()).rejects.toThrow();
    expect(invoke).toHaveBeenCalledExactlyOnceWith("create_backup");
  });
});
