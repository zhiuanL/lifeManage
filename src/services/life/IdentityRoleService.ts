import { IdentityRoleValidationError, normalizeIdentityRoleDraft, type IdentityRole, type IdentityRoleDraft, type IdentityRoleVersion } from "../../domain/life/IdentityRole";
import type { IdentityRoleRepository } from "../../repositories/life/IdentityRoleRepository";
import type { LifeDomainRepository } from "../../repositories/life/LifeDomainRepository";
import type { GoalRepository } from "../../repositories/planning/GoalRepository";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";
import { privacyLevels, type PrivacyLevel } from "../../domain/export/ContextExport";

export class IdentityRoleService {
  constructor(private readonly repository: IdentityRoleRepository,
    private readonly domains: LifeDomainRepository, private readonly goals: GoalRepository,
    private readonly clock: Clock, private readonly ids: IdGenerator) {}

  list(): Promise<readonly IdentityRole[]> { return this.repository.list(); }
  findById(id: string): Promise<IdentityRole | null> { return this.repository.findById(id); }
  listHistory(id: string): Promise<readonly IdentityRoleVersion[]> {
    if (!id.trim()) throw new IdentityRoleValidationError("请选择有效的身份角色。");
    return this.repository.listVersions(id);
  }

  private async validateLinks(draft: IdentityRoleDraft, previous: IdentityRole | null): Promise<void> {
    for (const id of draft.domainIds) {
      const domain = await this.domains.findById(id);
      if (!domain || (domain.status === "archived" && !previous?.domainIds.includes(id))) {
        throw new IdentityRoleValidationError("关联领域不存在或已归档，请重新选择。");
      }
    }
    for (const id of draft.goalIds) {
      const goal = await this.goals.findById(id);
      if (!goal || ((goal.status === "archived" || goal.archivedAt) && !previous?.goalIds.includes(id))) {
        throw new IdentityRoleValidationError("关联目标不存在或已归档，请重新选择。");
      }
    }
  }

  async create(draft: IdentityRoleDraft): Promise<IdentityRole> {
    const normalized = normalizeIdentityRoleDraft(draft);
    await this.validateLinks(normalized, null);
    const now = this.clock.now().toISOString();
    const role: IdentityRole = { ...normalized, id: this.ids.next(), createdAt: now,
      updatedAt: now, archivedAt: null, deletedAt: null, version: 1 };
    await this.repository.save(role, null);
    return role;
  }

  async update(id: string, draft: IdentityRoleDraft): Promise<IdentityRole> {
    const normalized = normalizeIdentityRoleDraft(draft);
    const previous = await this.repository.findById(id);
    if (!previous || previous.archivedAt) throw new IdentityRoleValidationError("角色不存在或已归档，请重新打开。");
    await this.validateLinks(normalized, previous);
    if (previous.name === normalized.name && previous.description === normalized.description
      && previous.active === normalized.active && previous.privacyLevel === normalized.privacyLevel
      && JSON.stringify(previous.domainIds) === JSON.stringify(normalized.domainIds)
      && JSON.stringify(previous.goalIds) === JSON.stringify(normalized.goalIds)) return previous;
    const record = { ...previous, ...normalized, updatedAt: this.clock.now().toISOString(),
      version: previous.version + 1 };
    await this.repository.save(record, previous);
    return record;
  }

  async setArchived(id: string, archived: boolean): Promise<IdentityRole> {
    const previous = await this.repository.findById(id);
    if (!previous) throw new IdentityRoleValidationError("身份角色不存在。");
    if (Boolean(previous.archivedAt) === archived) return previous;
    const now = this.clock.now().toISOString();
    const record = { ...previous, archivedAt: archived ? now : null,
      updatedAt: now, version: previous.version + 1 };
    await this.repository.save(record, previous);
    return record;
  }

  async setPrivacy(id: string, privacyLevel: PrivacyLevel): Promise<IdentityRole> {
    if (!privacyLevels.includes(privacyLevel)) throw new IdentityRoleValidationError("请选择有效的隐私级别。");
    const previous = await this.repository.findById(id);
    if (!previous) throw new IdentityRoleValidationError("身份角色已不存在，请重新读取后再试。");
    if (previous.privacyLevel === privacyLevel) return previous;
    const record = { ...previous, privacyLevel, updatedAt: this.clock.now().toISOString(),
      version: previous.version + 1 };
    await this.repository.save(record, previous);
    return record;
  }
}
