import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeOSContext, type LifeOSContextValue } from "../../src/app/LifeOSContext";
import { backupTables, inspectBackup, legacyBackupTables, type LifeOSBackup } from "../../src/domain/backup/Backup";
import { createReviewStructure } from "../../src/domain/reviews/ReviewStructure";
import { encodeReviewStructure } from "../../src/repositories/reviews/ReviewStructureStorage";
import { BackupPage } from "../../src/pages/BackupPage";

vi.mock("../../src/app/reloadApplication", () => ({ reloadApplication: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

const backup: LifeOSBackup = {
  format: "lifeos-backup",
  schemaVersion: 25,
  appVersion: "0.1.0",
  exportedAt: "2026-09-28T08:00:00Z",
  data: Object.fromEntries(backupTables.slice(0, 33).map((table) => [table, []])) as LifeOSBackup["data"],
};

function show(environment: LifeOSContextValue["environment"], service = {
  create: vi.fn().mockResolvedValue(backup),
  inspect: inspectBackup,
  restore: vi.fn().mockResolvedValue("safety.json"),
}) {
  render(createElement(LifeOSContext.Provider, {
    value: { environment, backupService: service } as unknown as LifeOSContextValue,
  }, createElement(BackupPage)));
  return service;
}

describe("M6 desktop backup workflow", () => {
  it("does not offer backup or restore for an in-memory browser preview", () => {
    show("browser-preview");
    expect(screen.getByText(/浏览器预览数据仅保存在内存中/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "下载 JSON 备份" })).toBeNull();
    expect(screen.queryByLabelText("选择 LifeOS 备份文件")).toBeNull();
  });

  it("downloads the complete JSON backup with the export date", async () => {
    const createObjectURL = URL.createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL;
    try {
      URL.createObjectURL = vi.fn().mockReturnValue("blob:lifeos");
      URL.revokeObjectURL = vi.fn();
      const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
        function (this: HTMLAnchorElement) {
          expect(this.download).toBe("lifeos-backup-2026-09-28.json");
          expect(this.href).toBe("blob:lifeos");
        },
      );
      show("desktop");
      fireEvent.click(screen.getByRole("button", { name: "下载 JSON 备份" }));
      await waitFor(() => expect(download).toHaveBeenCalledOnce());
      expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(await screen.findByRole("status")).toHaveProperty(
        "textContent", " 完整备份已下载，请妥善保管，其中包含所有隐私等级的记录。",
      );
    } finally {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    }
  });

  it("shows a Chinese retry prompt without exposing underlying Tauri errors", async () => {
    const service = show("desktop", {
      create: vi.fn().mockRejectedValue("数据库版本与备份功能不匹配。"),
      inspect: inspectBackup,
      restore: vi.fn(),
    });
    fireEvent.click(screen.getByRole("button", { name: "下载 JSON 备份" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent", "无法创建备份，请检查本地数据状态后重试。",
    );
    expect(service.create).toHaveBeenCalledOnce();
  });

  it("requires preflight and confirmation, then surfaces a rejected restore", async () => {
    const service = show("desktop", {
      create: vi.fn(),
      inspect: inspectBackup,
      restore: vi.fn().mockRejectedValue("恢复 goals 失败：CHECK constraint failed"),
    });
    const file = new File([JSON.stringify(backup)], "copy.json", { type: "application/json" });
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve(JSON.stringify(backup)),
    });
    fireEvent.change(screen.getByLabelText("选择 LifeOS 备份文件"), {
      target: { files: [file] },
    });
    expect(await screen.findByRole("heading", { name: "文件结构检查完成：copy.json" }))
      .toBeTruthy();
    const restore = screen.getByRole("button", { name: "确认恢复" }) as HTMLButtonElement;
    expect(restore.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /我确认用此备份替换当前数据/ }));
    fireEvent.click(restore);
    await waitFor(() => expect(service.restore).toHaveBeenCalledOnce());
    expect(service.restore.mock.calls[0][0]).toMatchObject({ total: 0, backup });
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent", "恢复未完成，请检查备份文件与本地数据状态后重新确认。",
    );
  });

  it("accepts an M6 backup without habit tables for restore preflight", async () => {
    show("desktop");
    const legacy = { ...backup, schemaVersion: 16,
      data: Object.fromEntries(legacyBackupTables.map((table) => [table, []])) };
    const file = new File([JSON.stringify(legacy)], "old.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve(JSON.stringify(legacy)) });
    fireEvent.change(screen.getByLabelText("选择 LifeOS 备份文件"), {
      target: { files: [file] },
    });
    expect(await screen.findByRole("heading", { name: "文件结构检查完成：old.json" })).toBeTruthy();
  });

  it("shows version 43 answer counts and restores only after confirmation", async () => {
    const service = show("desktop");
    const stored = encodeReviewStructure("review-1", createReviewStructure("weekly", "2026-10-13"));
    const payload = { ...backup, schemaVersion: 43,
      data: { ...Object.fromEntries(backupTables.map(table => [table, []])),
        reviews: [{ id: "review-1", title: "复盘", reflection: "", insight: "", next_focus: "", domain_id: null,
          reviewed_on: "2026-10-13", created_at: "2026-10-13T08:00:00Z", updated_at: "2026-10-13T08:00:00Z",
          ...stored.columns }], review_answers: [...stored.answers] } };
    const file = new File([JSON.stringify(payload)], "review.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve(JSON.stringify(payload)) });
    fireEvent.change(screen.getByLabelText("选择 LifeOS 备份文件"), { target: { files: [file] } });
    await screen.findByRole("heading", { name: "文件结构检查完成：review.json" });
    expect(screen.getByText("复盘答案").parentElement?.querySelector("dd")?.textContent)
      .toBe(String(stored.answers.length));
    expect(screen.getByText(/共 .* 条记录/).textContent).toContain(String(stored.answers.length + 1));
    const restore = screen.getByRole("button", { name: "确认恢复" }) as HTMLButtonElement;
    expect(restore.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /我确认用此备份替换当前数据/ }));
    expect(restore.disabled).toBe(false);
    fireEvent.click(restore);
    await waitFor(() => expect(service.restore).toHaveBeenCalledOnce());
    expect(service.restore.mock.calls[0][0]).toMatchObject({ backup: payload });
  });

  it("still opens when session storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    show("desktop");
    expect(screen.getByRole("heading", { name: "备份与恢复" })).toBeTruthy();
  });
});
