import { validateSetupProgress, type SetupProgress } from "../../domain/system/SetupProgress";
import type { SystemRepository } from "../../repositories/system/SystemRepository";
export const setupProgressKey = "v1_setup_progress";
export class SetupProgressService {
  constructor(private readonly repository: SystemRepository) {}
  async get(): Promise<SetupProgress> {
    const saved = await this.repository.getMetadata(setupProgressKey);
    if (saved === null) return { step: 0, completed: true };
    try { return validateSetupProgress(JSON.parse(saved)); }
    catch { throw new Error("初始化进度读取失败，请重试或恢复备份。"); }
  }
  async save(progress: SetupProgress): Promise<void> {
    await this.repository.setMetadata(setupProgressKey, JSON.stringify(validateSetupProgress(progress)));
  }
}
