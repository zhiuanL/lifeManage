import {
  LifeDomainValidationError, normalizeLifeDomainDraft,
  type LifeDomain,
  type LifeDomainDraft,
} from "../../domain/life/LifeDomain";
import type { LifeDomainRepository } from "../../repositories/life/LifeDomainRepository";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";
import { buildRecommendedLifeDomains } from "../../domain/life/recommendedLifeDomains";

export class LifeDomainService {
  constructor(
    private readonly repository: LifeDomainRepository,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  list(): Promise<readonly LifeDomain[]> {
    return this.repository.list();
  }

  findById(id: string): Promise<LifeDomain | null> {
    return this.repository.findById(id);
  }

  async create(draft: LifeDomainDraft): Promise<LifeDomain> {
    const normalizedDraft = normalizeLifeDomainDraft(draft);
    const existingDomains = await this.repository.list();
    const timestamp = this.clock.now().toISOString();
    const domain: LifeDomain = {
      id: this.idGenerator.next(),
      ...normalizedDraft,
      sortOrder: existingDomains.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.create(domain);
    return domain;
  }

  async addRecommended(names: readonly string[]): Promise<void> {
    const existing = await this.repository.list();
    const domains = buildRecommendedLifeDomains(
      existing, names, this.clock.now().toISOString(), this.idGenerator,
    );
    await this.repository.addMissingRecommended(domains);
  }

  async reorder(ids: readonly string[]): Promise<void> {
    const domains = await this.repository.list();
    const existingIds = new Set(domains.map(domain => domain.id));
    if (ids.length !== domains.length || new Set(ids).size !== ids.length ||
      ids.some(id => !existingIds.has(id))) {
      throw new Error("领域列表已变化，请重新读取后调整顺序。");
    }
    await this.repository.reorder(ids);
  }

  async update(id: string, draft: LifeDomainDraft): Promise<LifeDomain> {
    const existingDomain = await this.repository.findById(id);

    if (!existingDomain) {
      throw new LifeDomainValidationError("这个生活领域已经不存在了。");
    }

    const domain: LifeDomain = {
      ...existingDomain,
      ...normalizeLifeDomainDraft({ ...existingDomain, ...draft }),
      updatedAt: this.clock.now().toISOString(),
    };

    await this.repository.update(domain);
    return domain;
  }
}
