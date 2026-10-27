const roleFields = ["id", "name", "description", "active", "privacy_level", "archived_at",
  "deleted_at", "created_at", "updated_at", "version"] as const;
const snapshotFields = [...roleFields.filter(key => key !== "id"), "domain_ids", "goal_ids"];

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("身份角色备份结构无效。");
  return value as Record<string, unknown>;
}
function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("身份角色备份缺少数据表。");
  return value.map(object);
}
function shape(row: Record<string, unknown>, fields: readonly string[]): void {
  if (Object.keys(row).length !== fields.length || fields.some(key => !Object.prototype.hasOwnProperty.call(row, key))) {
    throw new Error("身份角色备份字段不完整或包含未知字段。");
  }
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("身份角色备份标识无效。");
  return value;
}
function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("身份角色版本号无效。");
  }
  return value;
}
function timestamp(value: unknown): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("身份角色备份时间无效。");
}
function validateFields(row: Record<string, unknown>): void {
  if (typeof row.name !== "string" || !row.name.trim() || row.name.length > 120
    || typeof row.description !== "string" || row.description.length > 6000
    || (row.active !== 0 && row.active !== 1)
    || !["normal", "private", "highly_sensitive"].includes(String(row.privacy_level))) {
    throw new Error("身份角色备份包含无效内容或隐私级别。");
  }
  version(row.version);
  timestamp(row.created_at);
  timestamp(row.updated_at);
  for (const key of ["archived_at", "deleted_at"]) if (row[key] !== null) timestamp(row[key]);
}

export function validateIdentityRoleHistorySnapshot(value: unknown, expectedVersion: number): Record<string, unknown> {
  const snapshot = object(value);
  shape(snapshot, snapshotFields);
  validateFields(snapshot);
  if (snapshot.version !== expectedVersion) throw new Error("身份角色历史版本与快照不一致。");
  for (const field of ["domain_ids", "goal_ids"]) {
    const list = snapshot[field];
    if (!Array.isArray(list)) throw new Error("身份角色历史关联无效。");
    const ids = list.map(identifier);
    if (new Set(ids).size !== ids.length) throw new Error("身份角色历史关联重复。");
  }
  return snapshot;
}

export function validateIdentityRoleBackupData(data: Record<string, unknown>): void {
  const roles = new Map<string, Record<string, unknown>>();
  for (const row of rows(data.identity_roles)) {
    shape(row, roleFields);
    const id = identifier(row.id);
    if (roles.has(id)) throw new Error("身份角色标识重复。");
    validateFields(row);
    roles.set(id, row);
  }
  for (const type of ["domain", "goal"] as const) {
    const targets = new Set(rows(data[type === "domain" ? "life_domains" : "goals"]).map(row => identifier(row.id)));
    const seen = new Set<string>();
    for (const row of rows(data[`identity_role_${type}_links`])) {
      shape(row, ["role_id", `${type}_id`]);
      const id = identifier(row.role_id), target = identifier(row[`${type}_id`]);
      const key = JSON.stringify([id, target]);
      if (!roles.has(id) || !targets.has(target) || seen.has(key)) throw new Error("身份角色关联无效或重复。");
      seen.add(key);
    }
  }
  const seen = new Set<string>();
  for (const row of rows(data.identity_role_versions)) {
    shape(row, ["role_id", "version", "changed_at", "snapshot_json"]);
    const role = roles.get(identifier(row.role_id));
    const number = version(row.version);
    const key = JSON.stringify([row.role_id, number]);
    if (!role || number >= version(role.version) || seen.has(key)) throw new Error("身份角色历史归属或版本无效。");
    seen.add(key);
    timestamp(row.changed_at);
    if (typeof row.snapshot_json !== "string") throw new Error("身份角色历史快照无效。");
    let snapshot: Record<string, unknown>;
    try { snapshot = object(JSON.parse(row.snapshot_json)); }
    catch { throw new Error("身份角色历史快照无效。"); }
    validateIdentityRoleHistorySnapshot(snapshot, number);
  }
}
