import { NavigationValidationError, navigationKinds, normalizeNavigationDraft, type LifeNavigation, type NavigationDraft, type NavigationKind } from "../../domain/life/LifeNavigation";
import type { LifeNavigationRepository } from "../../repositories/life/LifeNavigationRepository";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";
export class LifeNavigationService {
  constructor(private readonly repository: LifeNavigationRepository, private readonly clock: Clock,
    private readonly ids: IdGenerator) {}
  list(): Promise<readonly LifeNavigation[]> { return this.repository.list(); }
  findById(id: string): Promise<LifeNavigation | null> { return this.repository.findById(id); }
  async create(kind: NavigationKind, draft: NavigationDraft): Promise<LifeNavigation> {
    if (!navigationKinds.includes(kind)) throw new NavigationValidationError("请选择有效的导航类型。");
    const normalized = normalizeNavigationDraft(draft), now = this.clock.now().toISOString();
    const record: LifeNavigation = { ...normalized, id: this.ids.next(), kind, archivedAt: null, createdAt: now, updatedAt: now };
    await this.repository.insert(record);
    return record;
  }
  async update(id: string, draft: NavigationDraft): Promise<LifeNavigation> {
    const normalized = normalizeNavigationDraft(draft);
    const existing = await this.repository.findById(id);
    if (!existing || existing.archivedAt) throw new NavigationValidationError("记录已归档或不存在，请重新打开。");
    if (existing.title === normalized.title && existing.description === normalized.description) return existing;
    const updatedAt = this.clock.now().toISOString();
    await this.repository.update(id, normalized, updatedAt);
    return { ...existing, ...normalized, updatedAt };
  }
  async setArchived(id: string, archived: boolean): Promise<LifeNavigation> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NavigationValidationError("导航记录不存在。");
    if (Boolean(existing.archivedAt) === archived) return existing;
    const now = this.clock.now().toISOString();
    await this.repository.setArchived(id, archived ? now : null, now);
    return { ...existing, archivedAt: archived ? now : null, updatedAt: now };
  }
}
