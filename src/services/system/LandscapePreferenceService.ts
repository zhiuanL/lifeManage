import { defaultLandscapePreference, validateLandscapePreference,
  type LandscapePreference } from "../../domain/life/LandscapePreference";
import type { SystemRepository } from "../../repositories/system/SystemRepository";

const preferenceKey = "v1_landscape_preference";

export class LandscapePreferenceService {
  constructor(private readonly repository: SystemRepository) {}

  async get(): Promise<LandscapePreference> {
    const value = await this.repository.getMetadata(preferenceKey);
    if (value === null) return defaultLandscapePreference();
    try { return validateLandscapePreference(JSON.parse(value)); }
    catch { throw new Error("景观偏好读取失败，请检查本地设置或恢复备份。"); }
  }

  async save(preference: LandscapePreference): Promise<void> {
    const normalized = validateLandscapePreference(preference);
    await this.repository.setMetadata(preferenceKey, JSON.stringify(normalized));
  }
}
