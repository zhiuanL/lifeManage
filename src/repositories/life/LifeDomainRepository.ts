import type { LifeDomain } from "../../domain/life/LifeDomain";

export interface LifeDomainRepository {
  list(): Promise<readonly LifeDomain[]>;
  findById(id: string): Promise<LifeDomain | null>;
  create(domain: LifeDomain): Promise<void>;
  addMissingRecommended(domains: readonly LifeDomain[]): Promise<void>;
  update(domain: LifeDomain): Promise<void>;
  reorder(ids: readonly string[]): Promise<void>;
}
