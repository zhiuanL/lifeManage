import { buildDomainTimeline, type DomainTimelineEntry } from "../../domain/life/DomainHistory";
import type { DomainHistoryRepository } from "../../repositories/history/DomainHistoryRepository";

export class DomainTimelineService {
  constructor(private readonly repository: DomainHistoryRepository) {}

  async list(): Promise<readonly DomainTimelineEntry[]> {
    return buildDomainTimeline(await this.repository.listChanges());
  }
}
