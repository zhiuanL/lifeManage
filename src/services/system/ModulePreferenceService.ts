import { defaultModulePreference, validateModulePreference, type ModulePreference } from "../../domain/system/ModulePreference";
import type { SystemRepository } from "../../repositories/system/SystemRepository";
import { PreferenceReadError } from "../../domain/system/PreferenceReadError";
const preferenceKey = "v1_module_preference";
export class ModulePreferenceService {
  constructor(private readonly repository: SystemRepository) {}
  async get(): Promise<ModulePreference> {
    const value = await this.repository.getMetadata(preferenceKey);
    if (value === null) return defaultModulePreference();
    try { return validateModulePreference(JSON.parse(value)); }
    catch { throw new PreferenceReadError("module"); }
  }
  async save(preference: ModulePreference): Promise<void> {
    await this.repository.setMetadata(preferenceKey, JSON.stringify(validateModulePreference(preference)));
  }
}
