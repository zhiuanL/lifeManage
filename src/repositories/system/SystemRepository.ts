import type { LifeDomain } from "../../domain/life/LifeDomain";

export interface SystemRepository {
  getMetadata(key: string): Promise<string | null>;
  setMetadata(key: string, value: string): Promise<void>;
  completeFirstInitialization(initializedAt: string, domains: readonly LifeDomain[]): Promise<void>;
}
