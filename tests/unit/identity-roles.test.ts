import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MigrationRunner } from "../../src/db/MigrationRunner";
import { migrations } from "../../src/db/migrations";
import { SqliteIdentityRoleRepository } from "../../src/repositories/sqlite/SqliteIdentityRoleRepository";
import { SqliteLifeDomainRepository } from "../../src/repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteGoalRepository } from "../../src/repositories/sqlite/SqliteGoalRepository";
import { IdentityRoleService } from "../../src/services/life/IdentityRoleService";
import { LifeDomainService } from "../../src/services/life/LifeDomainService";
import { nativeSqliteExecutor } from "../helpers/nativeSqliteExecutor";

const clock = { now: () => new Date("2026-10-13T08:00:00Z") };
const draft = { name: "家长", description: "陪伴与支持", active: true,
  privacyLevel: "private" as const, domainIds: [] as string[], goalIds: [] as string[] };

async function setup(db: DatabaseSync) {
  const executor = nativeSqliteExecutor(db);
  await new MigrationRunner(executor, migrations, clock).run();
  let sequence = 0;
  const ids = { next: () => `role-test-${++sequence}` };
  const repository = new SqliteIdentityRoleRepository(executor);
  const domains = new SqliteLifeDomainRepository(executor);
  return { repository, service: new IdentityRoleService(repository, domains,
    new SqliteGoalRepository(executor), clock, ids),
  domains: new LifeDomainService(domains, clock, ids) };
}

describe("identity roles persistence", () => {
  it("reloads Chinese roles, preserves links when inactive and snapshots prior values", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const { service, domains } = await setup(db);
      const domain = await domains.create({ name: "关系", description: "", focus: "", color: "fern", icon: "users" });
      db.prepare(`INSERT INTO goals (id, title, status, sort_order, created_at, updated_at)
        VALUES ('family-goal', '每周陪伴', 'active', 0, ?, ?)`)
        .run(clock.now().toISOString(), clock.now().toISOString());
      const role = await service.create({ ...draft, domainIds: [domain.id], goalIds: ["family-goal"] });
      const inactive = await service.update(role.id, { ...role, active: false });
      expect(await new SqliteIdentityRoleRepository(nativeSqliteExecutor(db)).findById(role.id)).toEqual(inactive);
      expect(inactive.domainIds).toEqual([domain.id]);
      expect(inactive.goalIds).toEqual(["family-goal"]);
      const snapshot = JSON.parse(String(db.prepare(
        "SELECT snapshot_json FROM identity_role_versions WHERE role_id = ?").get(role.id)!.snapshot_json));
      expect(snapshot).toMatchObject({ active: 1, domain_ids: [domain.id], goal_ids: ["family-goal"], version: 1 });
      expect(await service.listHistory(role.id)).toEqual([{
        roleId: role.id, version: 1, changedAt: clock.now().toISOString(), snapshot,
      }]);
      await domains.update(domain.id, { ...domain, status: "archived" });
      db.prepare(`UPDATE goals SET lifecycle_status = 'archived', archived_at = ? WHERE id = 'family-goal'`)
        .run(clock.now().toISOString());
      expect((await service.update(role.id, { ...inactive, description: "保留旧关联" })).goalIds)
        .toEqual(["family-goal"]);
      await service.setArchived(role.id, true);
      await expect(service.update(role.id, draft)).rejects.toThrow("归档");
      expect((await service.setArchived(role.id, false)).domainIds).toEqual([domain.id]);
      const cleared = await service.update(role.id, { ...draft, active: false });
      expect(cleared.domainIds).toEqual([]);
      expect(cleared.goalIds).toEqual([]);
      await expect(service.update(role.id, { ...cleared, goalIds: ["family-goal"] })).rejects.toThrow("归档");
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });

  it("rejects invalid links and rolls back the role and history when a target disappears", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      const { service, repository, domains } = await setup(db);
      const role = await service.create(draft);
      await expect(service.update(role.id, { ...draft, goalIds: ["missing"] })).rejects.toThrow("关联目标");
      const domain = await domains.create({ name: "健康", description: "", focus: "", color: "fern", icon: "heart" });
      await domains.update(domain.id, { ...domain, status: "archived" });
      await expect(service.update(role.id, { ...draft, domainIds: [domain.id] })).rejects.toThrow("归档");
      await expect(repository.save({ ...role, name: "不应保存", domainIds: ["missing"],
        version: 2 }, role)).rejects.toThrow("发生变化");
      expect(await service.findById(role.id)).toEqual(role);
      expect(db.prepare("SELECT * FROM identity_role_versions").all()).toEqual([]);
      const changed = await service.update(role.id, { ...draft, name: "学习者" });
      await expect(repository.save({ ...role, name: "旧窗口覆盖", version: 2 }, role))
        .rejects.toThrow("发生变化");
      expect(await service.findById(role.id)).toEqual(changed);
      await expect(service.update(role.id, { ...draft, domainIds: [domain.id, domain.id] }))
        .rejects.toThrow("重复");
    } finally { db.close(); }
  });
});
