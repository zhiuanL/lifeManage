import { defaultNavigationPreference, validateNavigationPreference,
  type NavigationPreference, type NavigationPreferenceUpdate } from "../../domain/system/NavigationPreference";
import type { SystemRepository } from "../../repositories/system/SystemRepository";
import { PreferenceReadError } from "../../domain/system/PreferenceReadError";

const preferenceKey = "v1_navigation_preference";

export class NavigationPreferenceService {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly repository: SystemRepository) {}

  async get(): Promise<NavigationPreference> {
    const value = await this.repository.getMetadata(preferenceKey);
    if (value === null) return defaultNavigationPreference();
    try { return validateNavigationPreference(JSON.parse(value)); }
    catch { throw new PreferenceReadError("navigation"); }
  }

  update(change: NavigationPreferenceUpdate): Promise<NavigationPreference> {
    // Commands read the last committed value, including after a failed command.
    const operation = this.pending.then(async () => {
      const next = validateNavigationPreference(change(await this.get()));
      await this.repository.setMetadata(preferenceKey, JSON.stringify(next));
      return next;
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
}
