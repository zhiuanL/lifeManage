import { buildPersonRelationshipTimeline, type PersonRelationshipEntry } from "../../domain/records/PersonRelationshipHistory";
import type { PersonRelationshipHistoryRepository } from "../../repositories/history/PersonRelationshipHistoryRepository";

export class PersonRelationshipTimelineService {
  constructor(private readonly repository: PersonRelationshipHistoryRepository) {}

  async list(): Promise<readonly PersonRelationshipEntry[]> {
    return buildPersonRelationshipTimeline(await this.repository.listChanges());
  }
}
