import type { LifeNavigation, NavigationDraft } from "../../domain/life/LifeNavigation";
export interface LifeNavigationRepository {
  list(): Promise<readonly LifeNavigation[]>;
  findById(id: string): Promise<LifeNavigation | null>;
  insert(record: LifeNavigation): Promise<void>;
  update(id: string, draft: NavigationDraft, updatedAt: string): Promise<void>;
  setArchived(id: string, archivedAt: string | null, updatedAt: string): Promise<void>;
}
