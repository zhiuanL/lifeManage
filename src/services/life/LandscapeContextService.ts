import { normalizeLandscapeContext, type LandscapeContext, type LandscapeContextInput } from "../../domain/life/LandscapeContext";
import type { LandscapeContextRepository } from "../../repositories/life/LandscapeContextRepository";
import type { Clock } from "../../shared/clock";
export class LandscapeContextService {
  constructor(private readonly repository: LandscapeContextRepository, private readonly clock: Clock) {}
  get(): Promise<LandscapeContext | null> { return this.repository.get(); }
  async save(input: LandscapeContextInput): Promise<LandscapeContext> {
    const context = { ...normalizeLandscapeContext(input), updatedAt: this.clock.now().toISOString() };
    await this.repository.save(context);
    return context;
  }
}
