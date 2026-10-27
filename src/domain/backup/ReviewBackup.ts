import { inspectBackup, supportedBackupTables } from "./Backup";

export const reviewBackupTables = supportedBackupTables;

export function inspectReviewBackup(value: unknown) {
  if (!value || typeof value !== "object" || !("schemaVersion" in value) || ![43, 44].includes(Number(value.schemaVersion))) {
    throw new Error("复盘备份仅支持版本 43 或 44。");
  }
  return inspectBackup(value);
}
