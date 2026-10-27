import type { ObjectVersion, VersionType } from "../../domain/records/ObjectVersion";

export interface ObjectVersionRepository {
  list(type: Exclude<VersionType, "role">, objectId: string): Promise<readonly ObjectVersion[]>;
}
