import type { ResourceNeed } from "../../domain/resources/Resources";

export interface ResourceNeedRepository {
  list(): Promise<readonly ResourceNeed[]>;
  save(item: ResourceNeed, create: boolean): Promise<boolean>;
}

