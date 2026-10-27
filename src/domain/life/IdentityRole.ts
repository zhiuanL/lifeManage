import { privacyLevels, type PrivacyLevel } from "../export/ContextExport";

export class IdentityRoleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityRoleValidationError";
  }
}

export interface IdentityRoleDraft {
  name: string;
  description: string;
  active: boolean;
  privacyLevel: PrivacyLevel;
  domainIds: readonly string[];
  goalIds: readonly string[];
}

export interface IdentityRole extends IdentityRoleDraft {
  id: string;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface IdentityRoleVersion {
  roleId: string;
  version: number;
  changedAt: string;
  snapshot: Record<string, unknown>;
}

export function normalizeIdentityRoleDraft(draft: IdentityRoleDraft): IdentityRoleDraft {
  const name = draft.name.trim();
  const description = draft.description.trim();
  if (!name || name.length > 120) throw new IdentityRoleValidationError("身份角色名称需为 1 至 120 个字。");
  if (description.length > 6000) throw new IdentityRoleValidationError("身份角色说明不能超过 6000 个字。");
  if (typeof draft.active !== "boolean") throw new IdentityRoleValidationError("请选择有效的角色启用状态。");
  if (!privacyLevels.includes(draft.privacyLevel)) throw new IdentityRoleValidationError("请选择有效的隐私级别。");
  const links = (ids: readonly string[]) => {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !id.trim())) {
      throw new IdentityRoleValidationError("关联记录无效，请重新选择。");
    }
    const normalized = ids.map(id => id.trim());
    if (new Set(normalized).size !== normalized.length) throw new IdentityRoleValidationError("不能重复关联同一记录。");
    return normalized.sort();
  };
  return { name, description, active: draft.active, privacyLevel: draft.privacyLevel,
    domainIds: links(draft.domainIds), goalIds: links(draft.goalIds) };
}
