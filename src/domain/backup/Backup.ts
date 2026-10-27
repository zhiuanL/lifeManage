import { goalRelationTypes, relationKey, type GoalRelationType } from "../planning/GoalRelation";
import { isPlainDate } from "../planning/Goal";
import { parseActionDetails } from "../planning/ActionDetails";
import { normalizeHabitGoalSettings } from "../progress/HabitGoalProgress";

import { validateReviewBackupData } from "./ReviewBackupData";
import { validateIdentityRoleBackupData } from "./IdentityRoleBackup";
import { normalizeDomainTemplateDefaults } from "../life/DomainTemplate";
import { validateDomainHistoryBackupData } from "./DomainHistoryBackup";
import { validatePersonDatesBackupData } from "./PersonDatesBackup";
import { validatePersonRelationshipHistoryBackupData } from "./PersonRelationshipHistoryBackup";
import { validateDomainSatisfactionBackupData } from "./DomainSatisfactionBackup";
import { validateLandscapeContextBackupData } from "./LandscapeContextBackup";

export const backupTables = [
  "app_metadata", "life_domains", "metric_definitions", "goals", "actions",
  "reviews", "issues", "decisions", "inbox_items",
  "metric_domain_links", "metric_records", "issue_domain_links",
  "decision_domain_links", "action_plan_changes", "action_completion_plans",
  "action_state_events", "object_versions", "templates",
  "habits", "habit_domain_links", "habit_logs",
  "people", "person_domain_links", "life_events", "event_domain_links",
  "skills", "skill_domain_links", "resource_needs", "system_assessments",
  "goal_domain_links",
  "action_domain_links",
  "review_domain_links",
  "goal_progress_items",
  "goal_habit_progress",
  "goal_relations", "life_navigation", "decision_navigation_links", "decision_person_links", "decision_resource_need_links",
] as const;
export const legacyBackupTables = backupTables.slice(0, 18);
export const structuredBackupTables = [...backupTables, "review_answers"] as const;
export const supportedBackupTables = [...structuredBackupTables, "review_goal_links", "review_issue_links"] as const;
export const identityRoleTables = ["identity_roles", "identity_role_domain_links", "identity_role_goal_links", "identity_role_versions"] as const;
export const identityRoleBackupTables = [...supportedBackupTables, ...identityRoleTables] as const;
export const domainHistoryBackupTables = [...identityRoleBackupTables, "life_domain_versions"] as const;
export const personDatesBackupTables = [...domainHistoryBackupTables, "person_dates"] as const;
export const personRelationshipBackupTables = [...personDatesBackupTables, "person_relationship_versions"] as const;
export const domainSatisfactionBackupTables = [...personRelationshipBackupTables, "domain_satisfaction_links"] as const;
export const landscapeContextBackupTables = [...domainSatisfactionBackupTables, "landscape_context"] as const;
export type BackupTable = (typeof landscapeContextBackupTables)[number];
type LegacyBackupData = Partial<BackupData>;
export const backupTableLabels: Record<BackupTable, string> = {
  landscape_context: "整体生活状态与当前阶段",
  domain_satisfaction_links: "领域满意度评分选择",
  person_relationship_versions: "人物关系变化历史",
  person_dates: "生日与命名重要日期",
  life_domain_versions: "领域变化历史",
  identity_roles: "身份角色",
  identity_role_domain_links: "身份角色与领域关联",
  identity_role_goal_links: "身份角色与目标关联",
  identity_role_versions: "身份角色历史",
  decision_resource_need_links: "决策与资源需求关联",
  decision_person_links: "决策与人物关联",
  decision_navigation_links: "决策与人生导航关联",
  review_answers: "复盘答案",
  review_goal_links: "复盘与目标关联",
  review_issue_links: "复盘与问题关联",
  app_metadata: "本地设置",
  life_domains: "生活领域",
  metric_definitions: "领域指标",
  goals: "目标",
  actions: "行动",
  reviews: "回顾",
  issues: "问题",
  decisions: "决策",
  inbox_items: "收集箱",
  metric_domain_links: "指标与领域关联",
  metric_records: "指标记录",
  issue_domain_links: "问题与领域关联",
  decision_domain_links: "决策与领域关联",
  action_plan_changes: "行动排期历史",
  action_completion_plans: "行动完成时安排",
  action_state_events: "行动状态历史",
  object_versions: "对象版本历史",
  templates: "自定义模板",
  habits: "习惯",
  habit_domain_links: "习惯与领域关联",
  habit_logs: "习惯打卡",
  people: "人物",
  person_domain_links: "人物与领域关联",
  life_events: "重要事件",
  event_domain_links: "事件与领域关联",
  skills: "能力成长",
  skill_domain_links: "能力与领域关联",
  resource_needs: "目标与决策资源需求",
  system_assessments: "系统成效评估",
  goal_domain_links: "目标与领域关联",
  action_domain_links: "行动与领域关联",
  review_domain_links: "复盘与领域关联",
  goal_progress_items: "目标进度项",
  goal_habit_progress: "习惯型目标配置",
  goal_relations: "目标关系", life_navigation: "人生导航",
};
export type BackupRow = Record<string, string | number | null>;
export type BackupData = Record<(typeof backupTables)[number], BackupRow[]>
  & Partial<Record<Exclude<BackupTable, (typeof backupTables)[number]>, BackupRow[]>>;
export interface LifeOSBackup {
  format: "lifeos-backup";
  schemaVersion: 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48 | 49 | 50 | 51 | 52;
  appVersion: string;
  exportedAt: string;
  data: BackupData | LegacyBackupData;
}
export interface BackupReport {
  backup: LifeOSBackup;
  counts: Record<BackupTable, number>;
  total: number;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("备份结构不是有效的对象。");
  return value as Record<string, unknown>;
}

export function inspectBackup(value: unknown): BackupReport {
  return inspectBackupData(value);
}

function inspectBackupData(value: unknown, allowRecordTargets = false, allowDomainTemplates = false): BackupReport {
  const backup = requireRecord(value);
  if (backup.schemaVersion === 52) {
    const data = requireRecord(backup.data);
    if (Object.keys(data).length !== landscapeContextBackupTables.length ||
      landscapeContextBackupTables.some(table => !Object.prototype.hasOwnProperty.call(data, table))) {
      throw new Error("备份数据表与当前版本不一致，未更改当前数据。");
    }
    const base = inspectBackupData({ ...backup, schemaVersion: 51,
      data: Object.fromEntries(domainSatisfactionBackupTables.map(table => [table, data[table]])) });
    validateLandscapeContextBackupData(data);
    const count = (data.landscape_context as unknown[]).length;
    return { backup: value as LifeOSBackup, counts: { ...base.counts, landscape_context: count },
      total: base.total + count };
  }
  if (backup.schemaVersion === 51) {
    const data = requireRecord(backup.data);
    if (Object.keys(data).length !== domainSatisfactionBackupTables.length ||
      domainSatisfactionBackupTables.some(table => !Object.prototype.hasOwnProperty.call(data, table))) {
      throw new Error("备份数据表与当前版本不一致，未更改当前数据。");
    }
    const base = inspectBackupData({ ...backup, schemaVersion: 50,
      data: Object.fromEntries(personRelationshipBackupTables.map(table => [table, data[table]])) });
    validateDomainSatisfactionBackupData(data);
    const count = (data.domain_satisfaction_links as unknown[]).length;
    return { backup: value as LifeOSBackup, counts: { ...base.counts, domain_satisfaction_links: count },
      total: base.total + count };
  }
  if (backup.schemaVersion === 50) {
    const data = requireRecord(backup.data);
    if (Object.keys(data).length !== personRelationshipBackupTables.length ||
      personRelationshipBackupTables.some(table => !Object.prototype.hasOwnProperty.call(data, table))) {
      throw new Error("备份数据表与当前版本不一致，未更改当前数据。");
    }
    const base = inspectBackupData({ ...backup, schemaVersion: 49,
      data: Object.fromEntries(personDatesBackupTables.map(table => [table, data[table]])) });
    validatePersonRelationshipHistoryBackupData(data);
    const count = (data.person_relationship_versions as unknown[]).length;
    return { backup: value as LifeOSBackup, counts: { ...base.counts, person_relationship_versions: count },
      total: base.total + count };
  }
  if (backup.schemaVersion === 49) {
    const data = requireRecord(backup.data);
    if (Object.keys(data).length !== personDatesBackupTables.length ||
      personDatesBackupTables.some(table => !Object.prototype.hasOwnProperty.call(data, table))) {
      throw new Error("备份数据表与当前版本不一致，未更改当前数据。");
    }
    const base = inspectBackupData({ ...backup, schemaVersion: 48,
      data: Object.fromEntries(domainHistoryBackupTables.map(table => [table, data[table]])) });
    validatePersonDatesBackupData(data);
    const count = (data.person_dates as unknown[]).length;
    return { backup: value as LifeOSBackup, counts: { ...base.counts, person_dates: count },
      total: base.total + count };
  }
  if (backup.schemaVersion === 48) {
    const data = requireRecord(backup.data);
    if (Object.keys(data).length !== domainHistoryBackupTables.length ||
      domainHistoryBackupTables.some(table => !Object.prototype.hasOwnProperty.call(data, table))) {
      throw new Error("备份数据表与当前版本不一致，未更改当前数据。");
    }
    const base = inspectBackupData({ ...backup, schemaVersion: 47,
      data: Object.fromEntries(identityRoleBackupTables.map(table => [table, data[table]])) });
    validateDomainHistoryBackupData(data);
    const count = (data.life_domain_versions as unknown[]).length;
    return { backup: value as LifeOSBackup, counts: { ...base.counts, life_domain_versions: count },
      total: base.total + count };
  }
  if (backup.schemaVersion === 47) {
    const base = inspectBackupData({ ...backup, schemaVersion: 46 }, true, true);
    return { ...base, backup: value as LifeOSBackup };
  }
  if (backup.schemaVersion === 46) {
    const base = inspectBackupData({ ...backup, schemaVersion: 45 }, true, allowDomainTemplates);
    return { ...base, backup: value as LifeOSBackup };
  }
  if (backup.schemaVersion === 45) {
    const data = requireRecord(backup.data);
    if (Object.keys(data).length !== identityRoleBackupTables.length ||
      identityRoleBackupTables.some(table => !Object.prototype.hasOwnProperty.call(data, table))) {
      throw new Error("备份数据表与当前版本不一致，未更改当前数据。");
    }
    const base = inspectBackupData({ ...backup, schemaVersion: 44,
      data: Object.fromEntries(supportedBackupTables.map(table => [table, data[table]])) }, allowRecordTargets, allowDomainTemplates);
    validateIdentityRoleBackupData(data);
    let total = base.total;
    for (const table of identityRoleTables) {
      base.counts[table] = (data[table] as unknown[]).length;
      total += base.counts[table];
    }
    return { backup: value as LifeOSBackup, counts: base.counts, total };
  }
  if (backup.schemaVersion === 44) {
    const data = requireRecord(backup.data);
    if (Object.keys(data).length !== supportedBackupTables.length || supportedBackupTables.some(table => !Object.prototype.hasOwnProperty.call(data, table))) {
      throw new Error("备份数据表与当前版本不一致，未更改当前数据。");
    }
    const base = inspectBackupData({ ...backup, schemaVersion: 43,
      data: Object.fromEntries(structuredBackupTables.map(table => [table, data[table]])) }, allowRecordTargets, allowDomainTemplates);
    const reviews = new Set((data.reviews as BackupRow[]).map(row => row.id));
    let total = base.total;
    for (const type of ["goal", "issue"] as const) {
      const table = `review_${type}_links` as const;
      const list = data[table];
      if (!Array.isArray(list)) throw new Error("复盘关联表无效。");
      const targets = new Set((data[type === "goal" ? "goals" : "issues"] as BackupRow[]).map(row => row.id));
      const pairs = new Set<string>();
      for (const value of list) {
        const row = requireRecord(value);
        const target = row[type + "_id"];
        const key = JSON.stringify([row.review_id, target]);
        if (Object.keys(row).length !== 2 || typeof row.review_id !== "string" || typeof target !== "string" || !reviews.has(row.review_id) || !targets.has(target) || pairs.has(key)) throw new Error("复盘关联引用无效或重复。");
        pairs.add(key);
      }
      base.counts[table] = list.length;
      total += list.length;
    }
    return { backup: value as LifeOSBackup, counts: base.counts, total };
  }
  if (backup.schemaVersion === 43) {
    const data = requireRecord(backup.data);
    if (Object.keys(data).length !== structuredBackupTables.length ||
        structuredBackupTables.some(table => !Object.prototype.hasOwnProperty.call(data, table))) {
      throw new Error("备份数据表与当前版本不一致，未更改当前数据。");
    }
    const baseData = Object.fromEntries(backupTables.map(table => [table, data[table]]));
    const base = inspectBackupData({ ...backup, schemaVersion: 42, data: baseData }, allowRecordTargets, allowDomainTemplates);
    validateReviewBackupData(data);
    const answers = data.review_answers as BackupRow[];
    return { backup: value as LifeOSBackup, counts: { ...base.counts, review_answers: answers.length },
      total: base.total + answers.length };
  }
  if (backup.format !== "lifeos-backup" ||
      ![15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42].includes(backup.schemaVersion as number)) {
    throw new Error("备份格式或数据库版本不受支持，未更改当前数据。");
  }
  const schemaVersion = backup.schemaVersion as number;
  if (typeof backup.appVersion !== "string" || !backup.appVersion ||
      typeof backup.exportedAt !== "string" ||
      !Number.isFinite(Date.parse(backup.exportedAt))) throw new Error("备份元信息无效。");
  const data = requireRecord(backup.data);
  const required = schemaVersion >= 38 ? backupTables : schemaVersion >= 37 ? backupTables.slice(0, 38) : schemaVersion >= 36 ? backupTables.slice(0, 37) : schemaVersion >= 32 ? backupTables.slice(0, 36) : schemaVersion === 31 ? backupTables.slice(0, 35) : schemaVersion >= 28 ? backupTables.slice(0, 34) : schemaVersion >= 25 ? backupTables.slice(0, 33)
    : schemaVersion >= 23 ? backupTables.slice(0, 32)
    : backup.schemaVersion === 22 ? backupTables.slice(0, 31)
    : backup.schemaVersion === 21 ? backupTables.slice(0, 30)
    : backup.schemaVersion === 19 || backup.schemaVersion === 20 ? backupTables.slice(0, 29)
    : backup.schemaVersion === 18 ? backupTables.slice(0, 27)
    : backup.schemaVersion === 17 ? backupTables.slice(0, 21) : legacyBackupTables;
  if (Object.keys(data).length !== required.length ||
      Object.keys(data).some((name) => !required.includes(name as (typeof backupTables)[number]))) {
    throw new Error("备份数据表与当前版本不一致，未更改当前数据。");
  }
  const counts = {} as Record<BackupTable, number>;
  const rows = {} as BackupData;
  counts.review_answers = 0;
  counts.life_domain_versions = 0;
  counts.person_dates = 0;
  counts.person_relationship_versions = 0;
  counts.domain_satisfaction_links = 0;
  counts.landscape_context = 0;
  counts.review_goal_links = 0;
  counts.review_issue_links = 0;
  for (const table of identityRoleTables) counts[table] = 0;
  for (const table of backupTables) { counts[table] = 0; rows[table] = []; }
  for (const table of required) {
    const list = data[table];
    if (!Array.isArray(list)) throw new Error(`备份缺少 ${table} 表。`);
    rows[table] = list.map((item) => {
      const row = requireRecord(item);
      if (Object.values(row).some((cell) =>
        cell !== null && typeof cell !== "string" &&
        !(typeof cell === "number" && Number.isFinite(cell)))) {
        throw new Error(`${table} 包含无效字段值。`);
      }
      return row as BackupRow;
    });
    counts[table] = rows[table].length;
  }
  for (const row of rows.templates) {
    if (row.category !== "domain") continue;
    if (!allowDomainTemplates) throw new Error("此备份版本不支持领域模板，未更改当前数据。");
    if (typeof row.name !== "string" || !row.name.trim() || row.name.trim().length > 80 ||
      typeof row.version !== "number" || !Number.isSafeInteger(row.version) || row.version < 1 ||
      typeof row.defaults_json !== "string") {
      throw new Error("领域模板备份字段无效，未更改当前数据。");
    }
    try { normalizeDomainTemplateDefaults(JSON.parse(row.defaults_json)); }
    catch { throw new Error("领域模板备份内容无效，未更改当前数据。"); }
  }
  const keys = (table: (typeof backupTables)[number], column: string) => {
    const ids = rows[table].map((row) => row[column]);
    if (ids.some((id) => typeof id !== "string" || !id) ||
        ids.length !== new Set(ids).size) throw new Error(`${table} 的标识缺失或重复。`);
    return new Set(ids);
  };
  const navigation = keys("life_navigation", "id");
  const decisionNavigation = new Set<string>();
  for (const row of rows.decision_navigation_links) {
    const key = JSON.stringify([row.decision_id, row.navigation_id]);
    if (decisionNavigation.has(key)) throw new Error("决策与人生导航关联重复。");
    decisionNavigation.add(key);
  }
  const decisionResources = new Set<string>();
  for (const row of rows.decision_resource_need_links) {
    if (typeof row.decision_id !== "string" || !row.decision_id || typeof row.resource_need_id !== "string" || !row.resource_need_id) {
      throw new Error("决策与资源需求关联标识无效。");
    }
    const key = JSON.stringify([row.decision_id, row.resource_need_id]);
    if (decisionResources.has(key)) throw new Error("决策与资源需求关联重复。");
    decisionResources.add(key);
  }
  const decisionPeople = new Set<string>();
  for (const row of rows.decision_person_links) {
    const key = JSON.stringify([row.decision_id, row.person_id]);
    if (decisionPeople.has(key)) throw new Error("决策与人物关联重复。");
    decisionPeople.add(key);
  }
  for (const row of rows.life_navigation) {
    if (schemaVersion >= 35 && !["normal", "private", "highly_sensitive"].includes(String(row.privacy_level))) {
      throw new Error("人生导航隐私级别无效。");
    }
    if (!["mission", "value", "vision", "principle"].includes(String(row.kind)) ||
        typeof row.title !== "string" || !row.title.trim() || row.title.length > 120 ||
        typeof row.description !== "string" || row.description.length > 6000 ||
        ![row.created_at, row.updated_at].every(value => typeof value === "string" && Number.isFinite(Date.parse(value))) ||
        !(row.archived_at === null || (typeof row.archived_at === "string" && Number.isFinite(Date.parse(row.archived_at))))) {
      throw new Error("人生导航包含无效字段。");
    }
  }
  for (const row of rows.object_versions) {
    const types = schemaVersion >= 42 ? ["goal", "review", "issue", "decision", "navigation", "action"] : schemaVersion >= 34 ? ["goal", "review", "issue", "decision", "navigation"]
      : ["goal", "review", "issue", "decision"];
    if (!types.includes(String(row.object_type))) throw new Error("对象版本历史包含未知类型。");
    if (row.object_type === "action") {
      const snapshot = requireRecord(JSON.parse(String(row.snapshot_json)));
      parseActionDetails(String(snapshot.details_json));
      if (typeof snapshot.title !== "string" || !snapshot.title.trim() || snapshot.title.length > 120 ||
          !["open", "completed"].includes(String(snapshot.status)) ||
          typeof row.object_id !== "string" || !row.object_id ||
          ![snapshot.created_at, snapshot.updated_at, row.changed_at].every(value =>
            typeof value === "string" && Number.isFinite(Date.parse(value))) ||
          !(snapshot.scheduled_for === null || (typeof snapshot.scheduled_for === "string" && isPlainDate(snapshot.scheduled_for))) ||
          !(snapshot.completed_at === null || (typeof snapshot.completed_at === "string" && Number.isFinite(Date.parse(snapshot.completed_at))))) {
        throw new Error("行动反馈历史包含无效快照。");
      }
    }
    if (row.object_type === "navigation") {
      const snapshot = requireRecord(JSON.parse(String(row.snapshot_json)));
      if (!["mission", "value", "vision", "principle"].includes(String(snapshot.kind)) ||
          typeof snapshot.title !== "string" || !snapshot.title.trim() || snapshot.title.length > 120 ||
          typeof snapshot.description !== "string" || snapshot.description.length > 6000 ||
          ![snapshot.created_at, snapshot.updated_at, row.changed_at].every(value =>
            typeof value === "string" && Number.isFinite(Date.parse(value))) ||
          !(snapshot.archived_at === null || (typeof snapshot.archived_at === "string" &&
            Number.isFinite(Date.parse(snapshot.archived_at)))) ||
          typeof row.object_id !== "string" || !row.object_id) {
        throw new Error("人生导航版本历史包含无效快照。");
      }
    }
  }
  const domains = keys("life_domains", "id");
  const goals = keys("goals", "id");
  const relationKeys = new Set<string>();
  for (const row of rows.goal_relations) {
    if (typeof row.goal_id !== "string" || typeof row.target_goal_id !== "string" ||
        !goals.has(row.goal_id) || !goals.has(row.target_goal_id) || row.goal_id === row.target_goal_id ||
        !goalRelationTypes.includes(row.relation_type as GoalRelationType)) throw new Error("目标关系包含无效类型或目标引用。");
    const key = relationKey(row.goal_id, row.target_goal_id, row.relation_type as GoalRelationType);
    if (relationKeys.has(key)) throw new Error("目标关系重复。");
    relationKeys.add(key);
  }
  if (schemaVersion >= 30 && rows.goals.some((row) =>
    !["high", "medium", "low"].includes(String(row.priority)))) {
    throw new Error("目标优先级无效。");
  }
  if (schemaVersion >= 27 && rows.goals.some((row) =>
    !["automatic", "exploration", "exploration_percent"].includes(String(row.progress_mode)))) {
    throw new Error("目标进度方式无效。");
  }
  if (schemaVersion >= 26) {
    for (const row of rows.goals) {
      const extension = row.lifecycle_status;
      const reason = row.status_reason;
      if (!["active", "paused", "completed"].includes(String(row.status)) ||
          !(extension === null || (extension === "candidate" && row.status === "active") ||
            (extension === "abandoned" && row.status === "paused") ||
            (extension === "archived" && ["active", "completed"].includes(String(row.status)))) ||
          !(reason === null || (typeof reason === "string" && reason.trim().length > 0 && reason.length <= 600)) ||
          (extension === "abandoned" && !reason) ||
          (extension === "archived" ? typeof row.archived_at !== "string" ||
            !Number.isFinite(Date.parse(row.archived_at)) : row.archived_at !== null)) {
        throw new Error("目标生命周期或状态原因无效。");
      }
    }
  }
  if (schemaVersion >= 33) {
    const directions = new Set(rows.life_navigation.filter((row) => row.kind === "vision").map((row) => row.id));
    for (const row of rows.goals) {
      if (!(row.horizon === null || ["annual", "quarter", "stage", "month"].includes(String(row.horizon))) ||
          !(row.direction_id === null || directions.has(row.direction_id))) {
        throw new Error("目标周期或长期方向关联无效。");
      }
    }
  }
  if (schemaVersion >= 24) {
    const parents = new Map(rows.goals.map((row) => [row.id, row.parent_id]));
    for (const row of rows.goals) {
      if (row.parent_id === undefined) throw new Error("目标缺少上级目标字段。");
      const seen = new Set([row.id]);
      let parent = row.parent_id;
      while (parent !== null) {
        if (typeof parent !== "string" || !goals.has(parent)) {
          throw new Error("上级目标引用了备份中不存在的目标。");
        }
        if (seen.has(parent)) throw new Error("上级目标不能形成循环关联。");
        seen.add(parent);
        parent = parents.get(parent) ?? null;
      }
    }
  }
  const actions = keys("actions", "id");
  if (schemaVersion >= 41) for (const row of rows.actions) {
    if (typeof row.details_json !== "string") throw new Error("行动反馈字段缺失。");
    parseActionDetails(row.details_json);
  }
  if (schemaVersion >= 29 && [...rows.goals, ...rows.actions].some((row) =>
    typeof row.progress_weight !== "number" || row.progress_weight <= 0 || row.progress_weight > 100)) {
    throw new Error("目标或行动贡献权重无效。");
  }
  if (schemaVersion >= 25) {
    keys("goal_progress_items", "id");
    for (const row of rows.goal_progress_items) {
      if (!goals.has(row.goal_id) ||
          !["key_result", "milestone", "outcome", "exploration"].includes(String(row.kind)) ||
          typeof row.title !== "string" || !row.title.trim() || row.title.length > 80 ||
          typeof row.target_value !== "number" || row.target_value <= 0 || row.target_value > 1e9 ||
          typeof row.current_value !== "number" || row.current_value < 0 || row.current_value > 1e9 ||
          typeof row.weight !== "number" || row.weight <= 0 || row.weight > 100 ||
          !Number.isInteger(row.sort_order) || (row.sort_order as number) < 0) {
        throw new Error("目标进度项包含无效数据或目标引用。");
      }
    }
  }
  const metrics = keys("metric_definitions", "id");
  const issues = keys("issues", "id");
  const decisions = keys("decisions", "id");
  const reviews = keys("reviews", "id");
  const habits = keys("habits", "id");
  if (schemaVersion >= 28) {
    const byGoal = new Map<string, typeof rows.goal_habit_progress>();
    for (const row of rows.goal_habit_progress) {
      if (typeof row.goal_id !== "string" || !goals.has(row.goal_id) || !habits.has(row.habit_id) ||
          rows.goals.find((goal) => goal.id === row.goal_id)?.progress_mode !== "automatic" ||
          !Number.isInteger(row.sort_order) || (row.sort_order as number) < 0) {
        throw new Error("习惯型目标配置包含无效关联或排序。");
      }
      const group = byGoal.get(row.goal_id) ?? [];
      group.push(row);
      byGoal.set(row.goal_id, group);
    }
    for (const group of byGoal.values()) normalizeHabitGoalSettings(group.map((row) => ({
      habitId: row.habit_id as string, startOn: row.start_on as string, endOn: row.end_on as string,
      weeklyTarget: row.weekly_target as number, weight: row.weight as number,
    })));
  }
  const people = keys("people", "id");
  const events = keys("life_events", "id");
  const skills = keys("skills", "id");
  for (const table of ["inbox_items", "metric_records", "templates"] as const) keys(table, "id");
  keys("habit_logs", "id");
  const resourceNeeds = keys("resource_needs", "id");
  keys("system_assessments", "id");
  for (const row of rows.resource_needs) {
    if (schemaVersion >= 40 && !["normal", "private", "highly_sensitive"].includes(String(row.privacy_level))) {
      throw new Error("资源需求隐私级别无效。");
    }
    const goalOwned = typeof row.goal_id === "string" && Boolean(row.goal_id);
    const decisionOwned = schemaVersion >= 39 && typeof row.decision_id === "string" && Boolean(row.decision_id);
    if (goalOwned === decisionOwned) throw new Error("资源需求必须且只能属于一个目标或决策。");
  }
  for (const [table, column, referenced] of [
    ["goals", "domain_id", domains], ["actions", "domain_id", domains],
    ["goal_domain_links", "goal_id", goals],
    ["goal_domain_links", "domain_id", domains],
    ["action_domain_links", "action_id", actions],
    ["action_domain_links", "domain_id", domains],
    ["review_domain_links", "review_id", reviews],
    ["review_domain_links", "domain_id", domains],
    ["actions", "goal_id", goals], ["reviews", "domain_id", domains],
    ["issues", "goal_id", goals], ["decisions", "goal_id", goals],
    ["metric_domain_links", "metric_id", metrics],
    ["metric_domain_links", "domain_id", domains], ["metric_records", "metric_id", metrics],
    ["issue_domain_links", "issue_id", issues], ["issue_domain_links", "domain_id", domains],
    ["decision_domain_links", "decision_id", decisions],
    ["decision_domain_links", "domain_id", domains],
    ["decision_resource_need_links", "decision_id", decisions],
    ["decision_resource_need_links", "resource_need_id", resourceNeeds],
    ["decision_person_links", "decision_id", decisions],
    ["decision_person_links", "person_id", people],
    ["decision_navigation_links", "decision_id", decisions],
    ["decision_navigation_links", "navigation_id", navigation],
    ["action_plan_changes", "action_id", actions],
    ["action_completion_plans", "action_id", actions],
    ["action_state_events", "action_id", actions],
    ["habit_domain_links", "habit_id", habits],
    ["habit_domain_links", "domain_id", domains],
    ["habit_logs", "habit_id", habits],
    ["person_domain_links", "person_id", people],
    ["person_domain_links", "domain_id", domains],
    ["life_events", "person_id", people],
    ["life_events", "goal_id", goals],
    ["event_domain_links", "event_id", events],
    ["event_domain_links", "domain_id", domains],
    ["skills", "goal_id", goals],
    ["skill_domain_links", "skill_id", skills],
    ["skill_domain_links", "domain_id", domains],
    ["resource_needs", "goal_id", goals],
    ...(schemaVersion >= 39 ? [["resource_needs", "decision_id", decisions] as const] : []),
    ["resource_needs", "skill_id", skills],
    ["resource_needs", "person_id", people],
  ] as const) {
    for (const row of rows[table]) {
      if (row[column] !== null && !referenced.has(row[column])) {
        throw new Error(`${table}.${column} 引用了备份中不存在的记录。`);
      }
    }
  }
  const goalLinks = new Set<string>();
  for (const row of rows.goal_domain_links) {
    const key = `${row.goal_id}:${row.domain_id}`;
    if (goalLinks.has(key)) throw new Error("目标与领域关联重复。");
    goalLinks.add(key);
  }
  if (schemaVersion >= 21 && rows.goals.some((row) =>
    row.domain_id && !goalLinks.has(`${row.id}:${row.domain_id}`))) {
    throw new Error("目标的主领域缺少对应关联。");
  }
  const actionLinks = new Set<string>();
  for (const row of rows.action_domain_links) {
    const key = `${row.action_id}:${row.domain_id}`;
    if (actionLinks.has(key)) throw new Error("行动与领域关联重复。");
    actionLinks.add(key);
  }
  if (schemaVersion >= 22 && rows.actions.some((row) =>
    row.domain_id && !actionLinks.has(`${row.id}:${row.domain_id}`))) {
    throw new Error("行动的主领域缺少对应关联。");
  }
  const reviewLinks = new Set<string>();
  for (const row of rows.review_domain_links) {
    const key = `${row.review_id}:${row.domain_id}`;
    if (reviewLinks.has(key)) throw new Error("复盘与领域关联重复。");
    reviewLinks.add(key);
  }
  if (schemaVersion >= 23 && rows.reviews.some((row) =>
    row.domain_id && !reviewLinks.has(`${row.id}:${row.domain_id}`))) {
    throw new Error("复盘的主领域缺少对应关联。");
  }
  const dates = new Set<string>();
  for (const row of rows.habit_logs) {
    if (typeof row.recorded_on !== "string" || !row.recorded_on) {
      throw new Error("习惯打卡日期无效。");
    }
    const key = `${row.habit_id}:${row.recorded_on}`;
    if (dates.has(key)) throw new Error("习惯打卡日期重复。");
    dates.add(key);
  }
  const targets: Record<string, Set<string | number | null>> = {
    goal: goals, action: actions, review: reviews, issue: issues, decision: decisions,
    ...(allowRecordTargets ? { event: events, person: people } : {}),
  };
  for (const row of rows.inbox_items) {
    if (row.target_type && !Object.prototype.hasOwnProperty.call(targets, row.target_type)) {
      throw new Error("收集箱指向了未知的记录类型。");
    }
    if (row.status === "organized" && (!row.target_type ||
        !targets[String(row.target_type)].has(row.target_id))) {
      throw new Error("收集箱指向了备份中不存在的记录。");
    }
    if (allowRecordTargets) {
      if (!["unprocessed", "archived", "processing", "organized"].includes(String(row.status))) {
        throw new Error("收集箱状态无效。");
      }
      if ((row.status === "unprocessed" || row.status === "archived")
          ? row.target_type !== null || row.target_id !== null
          : typeof row.target_type !== "string" || !row.target_type ||
            typeof row.target_id !== "string" || !row.target_id.trim()) {
        throw new Error("收集箱状态与整理关联不一致。");
      }
    }
  }
  return { backup: value as LifeOSBackup, counts,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
}
