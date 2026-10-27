import type { PrivacyLevel, PrivacyRecordType } from "../../domain/export/ContextExport";

export interface PrivacyRepository {
  list(): Promise<ReadonlyMap<string, PrivacyLevel>>;
  set(type: PrivacyRecordType, id: string, level: PrivacyLevel): Promise<boolean>;
}
