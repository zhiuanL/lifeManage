import type { MigrationRunner } from "../../db/MigrationRunner";
import type { Clock } from "../../shared/clock";
import type { SystemRepository } from "../../repositories/system/SystemRepository";
import { buildRecommendedLifeDomains, recommendedLifeDomains } from "../../domain/life/recommendedLifeDomains";
import type { IdGenerator } from "../../shared/id";

const initializedAtKey = "m0_initialized_at";
const pendingKey = "m0_recommended_domains_pending";

export interface ApplicationBootstrapResult {
  initializedAt: string;
  isFirstInitialization: boolean;
  migrationVersion: string;
}

export class BootstrapApplicationService {
  constructor(
    private readonly migrationRunner: MigrationRunner,
    private readonly systemRepository: SystemRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async bootstrap(): Promise<ApplicationBootstrapResult> {
    const migrationResult = await this.migrationRunner.run();
    const existingInitializedAt = await this.systemRepository.getMetadata(initializedAtKey);

    if (existingInitializedAt) {
      return {
        initializedAt: existingInitializedAt,
        isFirstInitialization: false,
        migrationVersion: migrationResult.currentVersion,
      };
    }

    const initializedAt = this.clock.now().toISOString();
    const pending = await this.systemRepository.getMetadata(pendingKey);
    const shouldSeed = migrationResult.isNewDatabase || Boolean(pending);
    if (shouldSeed) {
      if (!pending) {
        await this.systemRepository.setMetadata(pendingKey, initializedAt);
      }
      const domains = buildRecommendedLifeDomains(
        [], recommendedLifeDomains.map((draft) => draft.name), initializedAt, this.ids,
      );
      await this.systemRepository.completeFirstInitialization(initializedAt, domains);
    } else {
      await this.systemRepository.setMetadata(initializedAtKey, initializedAt);
    }

    return {
      initializedAt,
      isFirstInitialization: shouldSeed,
      migrationVersion: migrationResult.currentVersion,
    };
  }
}
