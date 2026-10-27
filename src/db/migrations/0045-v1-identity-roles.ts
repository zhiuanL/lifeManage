import type { Migration } from "./types";

export const v1IdentityRolesMigration: Migration = {
  id: "0045-v1-identity-roles",
  statements: [
    `CREATE TABLE identity_roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
      description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 6000),
      active INTEGER NOT NULL CHECK (active IN (0, 1)),
      privacy_level TEXT NOT NULL DEFAULT 'private'
        CHECK (privacy_level IN ('normal', 'private', 'highly_sensitive')),
      archived_at TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1)
    )`,
    ...(["domain", "goal"] as const).flatMap(type => [
      `CREATE TABLE identity_role_${type}_links (
        role_id TEXT NOT NULL REFERENCES identity_roles(id) ON DELETE CASCADE,
        ${type}_id TEXT NOT NULL REFERENCES ${type === "domain" ? "life_domains" : "goals"}(id) ON DELETE RESTRICT,
        PRIMARY KEY (role_id, ${type}_id)
      )`,
      `CREATE INDEX idx_identity_role_${type}_target ON identity_role_${type}_links (${type}_id, role_id)`,
    ]),
    `CREATE TABLE identity_role_versions (
      role_id TEXT NOT NULL REFERENCES identity_roles(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      changed_at TEXT NOT NULL,
      snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
      PRIMARY KEY (role_id, version)
    )`,
    `CREATE TRIGGER identity_roles_before_update BEFORE UPDATE ON identity_roles
      BEGIN
        INSERT INTO identity_role_versions (role_id, version, changed_at, snapshot_json)
        VALUES (OLD.id, OLD.version, NEW.updated_at, json_object(
          'name', OLD.name, 'description', OLD.description, 'active', OLD.active,
          'privacy_level', OLD.privacy_level, 'archived_at', OLD.archived_at,
          'deleted_at', OLD.deleted_at, 'created_at', OLD.created_at, 'updated_at', OLD.updated_at,
          'version', OLD.version,
          'domain_ids', (SELECT json_group_array(domain_id) FROM (
            SELECT domain_id FROM identity_role_domain_links WHERE role_id = OLD.id ORDER BY domain_id)),
          'goal_ids', (SELECT json_group_array(goal_id) FROM (
            SELECT goal_id FROM identity_role_goal_links WHERE role_id = OLD.id ORDER BY goal_id))
        ));
      END`,
  ],
};
