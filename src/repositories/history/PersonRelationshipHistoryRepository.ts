import type { PersonRelationshipChange } from "../../domain/records/PersonRelationshipHistory";

export interface PersonRelationshipHistoryRepository {
  listChanges(): Promise<readonly PersonRelationshipChange[]>;
}
