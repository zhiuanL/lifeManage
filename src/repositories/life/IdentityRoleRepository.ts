import type { IdentityRole, IdentityRoleVersion } from "../../domain/life/IdentityRole";

export interface IdentityRoleRepository {
  list(): Promise<readonly IdentityRole[]>;
  findById(id: string): Promise<IdentityRole | null>;
  listVersions(id: string): Promise<readonly IdentityRoleVersion[]>;
  save(record: IdentityRole, previous: IdentityRole | null): Promise<void>;
}
