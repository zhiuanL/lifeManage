import type { DomainChange } from "../../domain/life/DomainHistory";

export interface DomainHistoryRepository {
  listChanges(): Promise<readonly DomainChange[]>;
}
