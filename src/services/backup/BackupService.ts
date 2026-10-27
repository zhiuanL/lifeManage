import { invoke } from "@tauri-apps/api/core";
import { inspectBackup, type BackupReport, type LifeOSBackup } from "../../domain/backup/Backup";
import { BackupValidationError } from "../../domain/backup/BackupValidationError";

export class BackupService {
  async create(): Promise<LifeOSBackup> {
    const backup = await invoke<LifeOSBackup>("create_backup");
    return this.inspect(backup).backup;
  }

  inspect(value: unknown): BackupReport {
    try { return inspectBackup(value); }
    catch { throw new BackupValidationError(); }
  }

  async restore(report: BackupReport): Promise<string> {
    // A fresh validation catches accidental mutation of the preflight object.
    this.inspect(report.backup);
    return invoke<string>("restore_backup", { backup: report.backup });
  }
}
