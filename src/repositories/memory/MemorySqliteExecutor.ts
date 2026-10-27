import type { SqlExecutionResult, SqliteExecutor, SqlStatement } from "../sqlite/SqliteExecutor";
import { normalizeActionDetails } from "../../domain/planning/ActionDetails";
import { isPlainDate } from "../../domain/planning/Goal";
import { normalizeReviewStructure } from "../../domain/reviews/ReviewStructure";
import { domainHistoryFields } from "../../domain/life/DomainHistory";
import type { DomainHistoryRow } from "../sqlite/SqliteDomainHistoryRepository";
import type { PersonDateRow } from "../sqlite/SqliteLifeRecordsRepository";
import type { PersonRelationshipHistoryRow } from "../sqlite/SqlitePersonRelationshipHistoryRepository";
import { parsePersonRelationshipSnapshot } from "../../domain/records/PersonRelationshipHistory";
import { normalizePersonDates } from "../../domain/records/LifeRecords";
import type { LandscapeContextRow } from "../sqlite/SqliteLandscapeContextRepository";

interface HabitProgressRecord {
  goal_id: string; habit_id: string; start_on: string; end_on: string;
  weekly_target: number; weight: number; sort_order: number;
}

interface MetadataRecord {
  value: string;
  updatedAt: string;
}

interface LifeDomainRecord {
  id: string;
  name: string;
  description: string;
  focus: string;
  color_key: string;
  icon_key: string;
  current_state: string;
  long_term_expectation: string;
  status: "active" | "paused" | "archived";
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface GoalRecord {
  priority: string;
  horizon: string | null;
  direction_id: string | null;
  id: string;
  title: string;
  description: string;
  domain_id: string | null;
  parent_id: string | null;
  lifecycle_status: string | null;
  status_reason: string | null;
  archived_at: string | null;
  progress_mode: string;
  progress_weight: number;
  status: "active" | "paused" | "completed";
  target_date: string | null;
  sort_order: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ProgressItemRecord {
  id: string; goal_id: string; kind: string; title: string;
  target_value: number; current_value: number; weight: number; sort_order: number;
  created_at: string; updated_at: string;
}

interface ActionRecord {
  details_json: string;
  progress_weight: number;
  id: string;
  title: string;
  notes: string;
  domain_id: string | null;
  goal_id: string | null;
  status: "open" | "completed";
  scheduled_for: string | null;
  sort_order: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PlanChangeRecord {
  id: number;
  action_id: string;
  before_date: string | null;
  after_date: string | null;
  reason_code: "initial" | "personal" | "external" | "conflict" | "other";
  note: string;
  changed_at: string;
  completed_at_at_change: string | null;
  domain_id: string | null;
  goal_id: string | null;
}

interface StateEventRecord {
  id: number;
  action_id: string;
  before_status: ActionRecord["status"] | null;
  after_status: ActionRecord["status"];
  scheduled_for: string | null;
  changed_at: string;
}

interface ReviewRecord extends Partial<Record<"review_type" | "period_start" | "period_end" | "review_status" | "review_mode" | "template_snapshot", string | null>> {
  id: string;
  title: string;
  reflection: string;
  insight: string;
  next_focus: string;
  domain_id: string | null;
  reviewed_on: string;
  created_at: string;
  updated_at: string;
}

interface InboxRecord {
  id: string;
  content: string;
  source: "quick-capture" | "inbox";
  status: "unprocessed" | "processing" | "organized" | "archived";
  target_type: "goal" | "action" | "review" | "issue" | "decision" | "event" | "person" | null;
  target_id: string | null;
  created_at: string;
  updated_at: string;
}

interface IssueRecord {
  id: string;
  title: string;
  description: string;
  first_seen: string;
  occurrence_count: number;
  cause_hypothesis: string;
  attempts: string;
  follow_up: string;
  status: "open" | "watching" | "resolved";
  goal_id: string | null;
  created_at: string;
  updated_at: string;
}

interface DecisionRecord {
  id: string;
  title: string;
  decided_on: string;
  importance: "ordinary" | "major";
  status: "considering" | "decided";
  background: string;
  options: string;
  constraints_text: string;
  criteria: string;
  risks: string;
  opportunity_cost: string;
  reversibility: "unknown" | "reversible" | "difficult";
  choice: string;
  rationale: string;
  execution_conditions: string;
  outcome: string;
  reflection: string;
  goal_id: string | null;
  created_at: string;
  updated_at: string;
}

interface MetricDefinitionRow {
  id: string;
  name: string;
  unit: string;
  archived: number;
  created_at: string;
}

interface MetricRecordRow {
  id: string;
  metric_id: string;
  recorded_on: string;
  value: number;
  note: string;
  created_at: string;
  updated_at: string;
}

interface HabitRow {
  id: string; title: string; intention: string; weekly_target: number;
  stable_context: string; trigger_condition: string; obstacle: string;
  adjustment: string; start_on: string; archived: number;
  created_at: string; updated_at: string;
}

interface HabitLogRow {
  id: string; habit_id: string; recorded_on: string; completed: number;
  obstacle: string; adjustment: string; created_at: string; updated_at: string;
}

interface IdentityRoleRow {
  id: string; name: string; description: string; active: number; privacy_level: string;
  archived_at: string | null; deleted_at: string | null;
  created_at: string; updated_at: string; version: number;
}
interface IdentityRoleVersionRow {
  role_id: string; version: number; changed_at: string; snapshot_json: string;
}

export class MemorySqliteExecutor implements SqliteExecutor {
  async executeTransaction(statements: readonly SqlStatement[]): Promise<readonly SqlExecutionResult[] | null> {
    await this.execute("BEGIN IMMEDIATE");
    try {
      const results: SqlExecutionResult[] = [];
      for (const { statement, bindValues, requireAffectedRows } of statements) {
        const result = await this.execute(statement, bindValues);
        if (requireAffectedRows && result.rowsAffected === 0) {
          await this.execute("ROLLBACK");
          return null;
        }
        results.push(result);
      }
      await this.execute("COMMIT");
      return results;
    } catch (error) {
      await this.execute("ROLLBACK");
      throw error;
    }
  }
  private readonly appliedMigrations = new Set<string>();
  private readonly metadata = new Map<string, MetadataRecord>();
  private landscapeContext: LandscapeContextRow | null = null;
  private readonly lifeDomains = new Map<string, LifeDomainRecord>();
  private readonly domainVersions: DomainHistoryRow[] = [];
  private readonly goals = new Map<string, GoalRecord>();
  private readonly goalDomainLinks = new Map<string, Set<string>>();
  private readonly goalProgressItems = new Map<string, ProgressItemRecord>();
  private readonly goalRelations = new Map<string, { goal_id: string; target_goal_id: string; relation_type: string }>();
  private readonly goalHabitProgress = new Map<string, HabitProgressRecord>();
  private readonly actions = new Map<string, ActionRecord>();
  private readonly actionDomainLinks = new Map<string, Set<string>>();
  private readonly planChanges: PlanChangeRecord[] = [];
  private readonly stateEvents: StateEventRecord[] = [];
  private readonly completionPlans = new Map<string, {
    action_id: string; completed_at: string; planned_date: string | null;
  }>();
  private readonly reviews = new Map<string, ReviewRecord>();
  private readonly reviewAnswers = new Map<string, { review_id: string; field_key: string; value: string }>();
  private readonly reviewGoalLinks = new Map<string, Set<string>>();
  private readonly reviewIssueLinks = new Map<string, Set<string>>();
  private readonly reviewDomainLinks = new Map<string, Set<string>>();
  private readonly inboxItems = new Map<string, InboxRecord>();
  private readonly issues = new Map<string, IssueRecord>();
  private readonly issueDomainLinks = new Map<string, Set<string>>();
  private readonly decisions = new Map<string, DecisionRecord>();
  private readonly decisionResourceNeedLinks = new Map<string, Set<string>>();
  private readonly decisionPersonLinks = new Map<string, Set<string>>();
  private readonly decisionNavigationLinks = new Map<string, Set<string>>();
  private readonly decisionDomainLinks = new Map<string, Set<string>>();
  private readonly privacyLevels = new Map<string, string>();
  private readonly metricDefinitions = new Map<string, MetricDefinitionRow>();
  private readonly metricDomainLinks = new Map<string, Set<string>>();
  private readonly metricRecords = new Map<string, MetricRecordRow>();
  private readonly satisfactionLinks = new Map<string, string>();
  private readonly habits = new Map<string, HabitRow>();
  private readonly habitDomainLinks = new Map<string, Set<string>>();
  private readonly habitLogs = new Map<string, HabitLogRow>();
  private readonly lifeRecords = {
    people: new Map<string, Record<string, unknown>>(),
    life_events: new Map<string, Record<string, unknown>>(),
    skills: new Map<string, Record<string, unknown>>(),
  };
  private readonly personDates = new Map<string, PersonDateRow>();
  private readonly personRelationshipVersions: PersonRelationshipHistoryRow[] = [];
  private readonly recordLinks = {
    person_domain_links: new Map<string, Set<string>>(),
    event_domain_links: new Map<string, Set<string>>(),
    skill_domain_links: new Map<string, Set<string>>(),
  };
  private readonly navigation = new Map<string, Record<string, unknown>>();
  private readonly identityRoles = new Map<string, IdentityRoleRow>();
  private readonly identityRoleDomainLinks = new Map<string, Set<string>>();
  private readonly identityRoleGoalLinks = new Map<string, Set<string>>();
  private readonly identityRoleVersions: IdentityRoleVersionRow[] = [];
  private readonly resourceNeeds = new Map<string, Record<string, unknown>>();
  private readonly assessments = new Map<string, Record<string, unknown>>();
  private readonly objectVersions: {
    id: number; object_type: string; object_id: string; changed_at: string; snapshot_json: string;
  }[] = [];
  private readonly templates = new Map<string, {
    id: string; category: string; name: string; version: number;
    defaults_json: string; created_at: string; updated_at: string;
  }>();
  private metricTransaction: {
    landscapeContext: LandscapeContextRow | null;
    identityRoles: Map<string, IdentityRoleRow>;
    identityRoleDomainLinks: Map<string, Set<string>>;
    identityRoleGoalLinks: Map<string, Set<string>>;
    identityRoleVersions: IdentityRoleVersionRow[];
    navigation: Map<string, Record<string, unknown>>;
    metadata: Map<string, MetadataRecord>;
    lifeDomains: Map<string, LifeDomainRecord>;
    domainVersions: DomainHistoryRow[];
    goals: Map<string, GoalRecord>;
    goalLinks: Map<string, Set<string>>;
    progressItems: Map<string, ProgressItemRecord>;
    relations: Map<string, { goal_id: string; target_goal_id: string; relation_type: string }>;
    habitProgress: Map<string, HabitProgressRecord>;
    actions: Map<string, ActionRecord>;
    actionLinks: Map<string, Set<string>>;
    reviews: Map<string, ReviewRecord>;
    reviewGoalLinks: Map<string, Set<string>>;
    reviewIssueLinks: Map<string, Set<string>>;
    reviewLinks: Map<string, Set<string>>;
    reviewAnswers: Map<string, { review_id: string; field_key: string; value: string }>;
    planChanges: PlanChangeRecord[];
    stateEvents: StateEventRecord[];
    completionPlans: Map<string, {
      action_id: string; completed_at: string; planned_date: string | null;
    }>;
    objectVersions: {
      id: number; object_type: string; object_id: string; changed_at: string; snapshot_json: string;
    }[];
    definitions: Map<string, MetricDefinitionRow>;
    satisfactionLinks: Map<string, string>;
    links: Map<string, Set<string>>;
    habits: Map<string, HabitRow>;
    habitLinks: Map<string, Set<string>>;
    habitLogs: Map<string, HabitLogRow>;
    records: {
      people: Map<string, Record<string, unknown>>;
      life_events: Map<string, Record<string, unknown>>;
      skills: Map<string, Record<string, unknown>>;
    };
    personDates: Map<string, PersonDateRow>;
    personRelationshipVersions: PersonRelationshipHistoryRow[];
    recordLinks: {
      person_domain_links: Map<string, Set<string>>;
      event_domain_links: Map<string, Set<string>>;
      skill_domain_links: Map<string, Set<string>>;
    };
    needs: Map<string, Record<string, unknown>>;
    assessments: Map<string, Record<string, unknown>>;
  } | null = null;

  async select<T>(statement: string, bindValues: unknown[] = []): Promise<T[]> {
    const normalized = normalize(statement);
    if (normalized === "SELECT * FROM LANDSCAPE_CONTEXT WHERE ID = 'CURRENT'") {
      return this.landscapeContext ? [{ ...this.landscapeContext } as T] : [];
    }
    if (normalized === "SELECT DOMAIN_ID, METRIC_ID FROM DOMAIN_SATISFACTION_LINKS ORDER BY DOMAIN_ID") {
      return [...this.satisfactionLinks].sort(([a], [b]) => a.localeCompare(b))
        .map(([domain_id, metric_id]) => ({ domain_id, metric_id }) as T);
    }
    if (normalized.includes("FROM PERSON_RELATIONSHIP_VERSIONS")) {
      return this.personRelationshipVersions.filter(row =>
        !normalized.includes("WHERE PERSON_ID = ?") || row.person_id === bindValues[0])
        .sort((a, b) => a.id - b.id).map(row => ({ ...row }) as T);
    }
    if (normalized.startsWith("SELECT * FROM PERSON_DATES")) {
      return [...this.personDates.values()]
        .filter(row => !normalized.includes("WHERE PERSON_ID = ?") || row.person_id === bindValues[0])
        .sort((a, b) => a.person_id.localeCompare(b.person_id) || a.sort_order - b.sort_order)
        .map(row => ({ ...row }) as T);
    }
    if (normalized.includes("FROM LIFE_DOMAIN_VERSIONS")) {
      return this.domainVersions.filter(row =>
        !normalized.includes("WHERE DOMAIN_ID = ?") || row.domain_id === bindValues[0])
        .sort((a, b) => a.id - b.id).map(row => ({ ...row }) as T);
    }
    if (normalized.startsWith("SELECT * FROM IDENTITY_ROLES")) {
      return [...this.identityRoles.values()]
        .filter(row => (!normalized.includes("DELETED_AT IS NULL") || row.deleted_at === null)
          && (!normalized.includes("WHERE ID = ?") || row.id === bindValues[0]))
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
        .map(row => ({ ...row }) as T);
    }
    if (/^SELECT .* FROM IDENTITY_ROLE_(DOMAIN|GOAL)_LINKS/.test(normalized)) {
      const type = normalized.includes("FROM IDENTITY_ROLE_DOMAIN_LINKS") ? "domain" : "goal";
      const links = type === "domain" ? this.identityRoleDomainLinks : this.identityRoleGoalLinks;
      return [...links].filter(([id]) => !normalized.includes("WHERE ROLE_ID") || bindValues.includes(id))
        .flatMap(([role_id, ids]) => [...ids].sort().map(id => ({ role_id, [type + "_id"]: id }))) as T[];
    }
    if (normalized.includes("FROM IDENTITY_ROLE_VERSIONS")) {
      return this.identityRoleVersions.filter(row => !normalized.includes("WHERE ROLE_ID = ?") || row.role_id === bindValues[0])
        .sort((a, b) => b.version - a.version).map(row => ({ ...row }) as T);
    }
    if (/^SELECT .* FROM REVIEW_(GOAL|ISSUE)_LINKS/.test(normalized)) {
      const type = normalized.includes("FROM REVIEW_GOAL_LINKS") ? "goal" : "issue";
      const links = type === "goal" ? this.reviewGoalLinks : this.reviewIssueLinks;
      return [...links].filter(([id]) => !normalized.includes("WHERE REVIEW_ID = ?") || id === bindValues[0])
        .sort(([a], [b]) => a.localeCompare(b)).flatMap(([review_id, ids]) => [...ids].sort().map(id => ({ review_id, [type + "_id"]: id }))) as T[];
    }
    if (normalized.startsWith("SELECT * FROM LIFE_NAVIGATION")) {
      return [...this.navigation.values()].filter(row => !normalized.includes("WHERE ID") || row.id === bindValues[0])
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
        .map(row => ({ ...row }) as T);
    }
    if (normalized.startsWith("SELECT NAME FROM SQLITE_MASTER WHERE TYPE = 'TABLE'")) {
      return this.appliedMigrations.size > 0
        ? ([{ name: "schema_migrations" }] as T[])
        : [];
    }
    if (normalized === "PRAGMA TABLE_INFO(SCHEMA_MIGRATIONS)") {
      return [{ name: "version" }, { name: "applied_at" }] as T[];
    }
    if (normalized === "PRAGMA TABLE_INFO(INBOX_ITEMS)") {
      return ["id", "content", "source", "status", "target_type", "target_id",
        "created_at", "updated_at", "privacy_level"].map(name => ({ name })) as T[];
    }
    for (const table of ["people", "life_events", "skills"] as const) {
      if (normalized.startsWith(`SELECT * FROM ${table.toUpperCase()} ORDER BY`)) {
        const rows = [...this.lifeRecords[table].values()];
        rows.sort((a, b) => table === "life_events"
          ? String(b.happened_on).localeCompare(String(a.happened_on)) ||
            String(b.id).localeCompare(String(a.id))
          : Number(a.archived) - Number(b.archived) ||
            String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
        return rows.map((row) => ({ ...row }) as T);
      }
    }
    for (const table of [
      "person_domain_links", "event_domain_links", "skill_domain_links",
    ] as const) {
      if (normalized.includes(`FROM ${table.toUpperCase()} ORDER BY`)) {
        return [...this.recordLinks[table].entries()]
          .flatMap(([owner_id, ids]) => [...ids].map((domain_id) => ({ owner_id, domain_id })))
          .sort((a, b) => a.owner_id.localeCompare(b.owner_id) ||
            a.domain_id.localeCompare(b.domain_id)).map((row) => row as T);
      }
    }
    if (normalized.startsWith("SELECT * FROM RESOURCE_NEEDS ORDER BY")) {
      return [...this.resourceNeeds.values()].sort((a, b) =>
        Number(a.met) - Number(b.met) || String(b.created_at).localeCompare(String(a.created_at)) ||
        String(b.id).localeCompare(String(a.id))).map((row) => ({ ...row }) as T);
    }
    if (normalized.startsWith("SELECT * FROM SYSTEM_ASSESSMENTS ORDER BY")) {
      return [...this.assessments.values()].sort((a, b) =>
        String(b.period_start).localeCompare(String(a.period_start)) ||
        String(a.period_kind).localeCompare(String(b.period_kind)) ||
        String(b.id).localeCompare(String(a.id))).map((row) => ({ ...row }) as T);
    }
    const privacyTable = /^SELECT ID, PRIVACY_LEVEL FROM (\w+)$/.exec(normalized)?.[1];
    if (privacyTable) {
      const records = this.recordsForPrivacy(privacyTable);
      return [...records.keys()].map((id) => ({
        id, privacy_level: this.privacyLevels.get(`${privacyTable}:${id}`) ?? "private",
      }) as T);
    }

    if (normalized.startsWith("SELECT VERSION FROM SCHEMA_MIGRATIONS")) {
      return [...this.appliedMigrations].map((version) => ({ version }) as T);
    }

    if (normalized.startsWith("SELECT VALUE FROM APP_METADATA")) {
      const key = asString(bindValues[0]);
      const record = this.metadata.get(key);
      return record ? ([{ value: record.value }] as T[]) : [];
    }

    if (normalized.includes("FROM OBJECT_VERSIONS WHERE OBJECT_TYPE = ? AND OBJECT_ID = ?")) {
      return this.objectVersions.filter((item) =>
        item.object_type === bindValues[0] && item.object_id === bindValues[1])
        .reverse().map((item) => ({ ...item }) as T);
    }
    if (normalized.includes("FROM OBJECT_VERSIONS WHERE OBJECT_TYPE = ? ORDER BY ID ASC")) {
      return this.objectVersions.filter(item => item.object_type === bindValues[0])
        .sort((a, b) => a.id - b.id).map(item => ({ ...item }) as T);
    }
    if (normalized.includes("FROM TEMPLATES WHERE ID = ?")) {
      const row = this.templates.get(asString(bindValues[0]));
      return row ? [{ ...row } as T] : [];
    }
    if (normalized.includes("FROM TEMPLATES ORDER BY CATEGORY, NAME")) {
      return [...this.templates.values()].sort((a, b) =>
        a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
        .map((row) => ({ ...row }) as T);
    }
    if (normalized.includes("FROM HABITS ORDER BY ARCHIVED, CREATED_AT DESC, ID DESC")) {
      return [...this.habits.values()].sort((a, b) =>
        a.archived - b.archived || b.created_at.localeCompare(a.created_at) ||
        b.id.localeCompare(a.id)).map((row) => ({ ...row }) as T);
    }
    if (normalized.includes("FROM HABIT_DOMAIN_LINKS ORDER BY HABIT_ID, DOMAIN_ID")) {
      return [...this.habitDomainLinks.entries()]
        .flatMap(([habit_id, ids]) => [...ids].map((domain_id) => ({ habit_id, domain_id })))
        .sort((a, b) => a.habit_id.localeCompare(b.habit_id) || a.domain_id.localeCompare(b.domain_id))
        .map((row) => row as T);
    }
    if (normalized.includes("FROM HABIT_LOGS ORDER BY RECORDED_ON DESC, CREATED_AT DESC, ID DESC")) {
      return [...this.habitLogs.values()].sort((a, b) =>
        b.recorded_on.localeCompare(a.recorded_on) ||
        b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
        .map((row) => ({ ...row }) as T);
    }

    if (normalized.includes("FROM LIFE_DOMAINS WHERE ID = ?")) {
      const id = asString(bindValues[0]);
      const record = this.lifeDomains.get(id);
      return record ? ([record] as T[]) : [];
    }

    if (normalized.includes("FROM LIFE_DOMAINS ORDER BY SORT_ORDER ASC, CREATED_AT ASC")) {
      return [...this.lifeDomains.values()]
        .sort(
          (left, right) =>
            left.sort_order - right.sort_order ||
            left.created_at.localeCompare(right.created_at),
        )
        .map((record) => ({ ...record }) as T);
    }

    if (normalized.includes("FROM GOAL_RELATIONS")) {
      return [...this.goalRelations.values()]
        .filter((row) => !normalized.includes("WHERE GOAL_ID = ?") || row.goal_id === bindValues[0])
        .sort((a, b) => a.goal_id.localeCompare(b.goal_id) || a.target_goal_id.localeCompare(b.target_goal_id) || a.relation_type.localeCompare(b.relation_type))
        .map((row) => ({ ...row }) as T);
    }
    if (normalized.includes("FROM GOAL_HABIT_PROGRESS")) {
      return [...this.goalHabitProgress.values()]
        .filter((row) => !normalized.includes("WHERE GOAL_ID = ?") || row.goal_id === bindValues[0])
        .sort((a, b) => a.goal_id.localeCompare(b.goal_id) || a.sort_order - b.sort_order)
        .map((row) => ({ ...row }) as T);
    }
    if (normalized.includes("FROM GOALS WHERE ID = ?")) {
      const id = asString(bindValues[0]);
      const record = this.goals.get(id);
      return record ? ([{ ...record }] as T[]) : [];
    }
    if (normalized.includes("FROM GOAL_PROGRESS_ITEMS ORDER BY GOAL_ID, SORT_ORDER, ID")) {
      return [...this.goalProgressItems.values()]
        .sort((a, b) => a.goal_id.localeCompare(b.goal_id) ||
          a.sort_order - b.sort_order || a.id.localeCompare(b.id))
        .map((row) => ({ ...row }) as T);
    }
    if (normalized.includes("FROM GOAL_DOMAIN_LINKS WHERE GOAL_ID = ? ORDER BY DOMAIN_ID")) {
      return [...(this.goalDomainLinks.get(asString(bindValues[0])) ?? [])].sort()
        .map((domain_id) => ({ domain_id }) as T);
    }
    if (normalized.includes("FROM GOAL_DOMAIN_LINKS ORDER BY GOAL_ID, DOMAIN_ID")) {
      return [...this.goalDomainLinks.entries()]
        .flatMap(([goal_id, ids]) => [...ids].map((domain_id) => ({ goal_id, domain_id })))
        .sort((a, b) => a.goal_id.localeCompare(b.goal_id) || a.domain_id.localeCompare(b.domain_id))
        .map((row) => row as T);
    }

    if (normalized.includes("FROM GOALS ORDER BY")) {
      return [...this.goals.values()]
        .sort(
          (left, right) =>
            goalStatusRank(left.lifecycle_status ?? left.status) - goalStatusRank(right.lifecycle_status ?? right.status) ||
            left.sort_order - right.sort_order ||
            left.created_at.localeCompare(right.created_at),
        )
        .map((record) => ({ ...record }) as T);
    }

    if (normalized.includes("FROM ACTIONS WHERE ID = ?")) {
      const id = asString(bindValues[0]);
      const record = this.actions.get(id);
      return record ? ([{ ...record }] as T[]) : [];
    }
    if (normalized.includes("FROM ACTION_DOMAIN_LINKS WHERE ACTION_ID = ? ORDER BY DOMAIN_ID")) {
      return [...(this.actionDomainLinks.get(asString(bindValues[0])) ?? [])].sort()
        .map((domain_id) => ({ domain_id }) as T);
    }
    if (normalized.includes("FROM ACTION_DOMAIN_LINKS ORDER BY ACTION_ID, DOMAIN_ID")) {
      return [...this.actionDomainLinks.entries()]
        .flatMap(([action_id, ids]) => [...ids].map((domain_id) => ({ action_id, domain_id })))
        .sort((a, b) => a.action_id.localeCompare(b.action_id) ||
          a.domain_id.localeCompare(b.domain_id)).map((row) => row as T);
    }

    if (normalized.includes("FROM ACTIONS ORDER BY")) {
      return [...this.actions.values()]
        .sort(compareActionRecords)
        .map((record) => ({ ...record }) as T);
    }

    if (normalized.includes("FROM ACTION_PLAN_CHANGES ORDER BY")) {
      return this.planChanges.map((record) => ({ ...record }) as T);
    }

    if (normalized.includes("FROM ACTION_COMPLETION_PLANS")) {
      return [...this.completionPlans.values()].map((record) => ({ ...record }) as T);
    }

    if (normalized.includes("FROM ACTION_STATE_EVENTS ORDER BY")) {
      return [...this.stateEvents].sort((left, right) =>
        left.action_id.localeCompare(right.action_id) ||
        left.changed_at.localeCompare(right.changed_at) || left.id - right.id)
        .map((record) => ({ ...record }) as T);
    }

    if (normalized.includes("FROM REVIEW_ANSWERS")) {
      return [...this.reviewAnswers.values()]
        .filter(row => !normalized.includes("WHERE REVIEW_ID = ?") || row.review_id === bindValues[0])
        .sort((a, b) => a.review_id.localeCompare(b.review_id) || a.field_key.localeCompare(b.field_key))
        .map(row => ({ ...row }) as T);
    }
    if (normalized.includes("FROM REVIEWS WHERE ID = ?")) {
      const id = asString(bindValues[0]);
      const record = this.reviews.get(id);
      return record ? ([{ ...record }] as T[]) : [];
    }
    if (normalized.includes("FROM REVIEW_DOMAIN_LINKS WHERE REVIEW_ID = ? ORDER BY DOMAIN_ID")) {
      return [...(this.reviewDomainLinks.get(asString(bindValues[0])) ?? [])].sort()
        .map((domain_id) => ({ domain_id }) as T);
    }
    if (normalized.includes("FROM REVIEW_DOMAIN_LINKS ORDER BY REVIEW_ID, DOMAIN_ID")) {
      return [...this.reviewDomainLinks.entries()]
        .flatMap(([review_id, ids]) => [...ids].map((domain_id) => ({ review_id, domain_id })))
        .sort((a, b) => a.review_id.localeCompare(b.review_id) ||
          a.domain_id.localeCompare(b.domain_id)).map((row) => row as T);
    }

    if (normalized.includes("FROM REVIEWS ORDER BY REVIEWED_ON DESC, CREATED_AT DESC")) {
      return [...this.reviews.values()]
        .sort(
          (left, right) =>
            right.reviewed_on.localeCompare(left.reviewed_on) ||
            right.created_at.localeCompare(left.created_at),
        )
        .map((record) => ({ ...record }) as T);
    }

    if (normalized.includes("FROM INBOX_ITEMS WHERE ID = ?")) {
      const record = this.inboxItems.get(asString(bindValues[0]));
      return record ? ([{ ...record }] as T[]) : [];
    }

    if (normalized.includes("FROM INBOX_ITEMS ORDER BY CREATED_AT DESC, ID DESC")) {
      return [...this.inboxItems.values()]
        .sort((left, right) =>
          right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))
        .map((record) => ({ ...record }) as T);
    }

    if (normalized.includes("FROM ISSUES WHERE ID = ?")) {
      const record = this.issues.get(asString(bindValues[0]));
      return record ? ([{ ...record }] as T[]) : [];
    }

    if (normalized.includes("FROM ISSUES ORDER BY FIRST_SEEN DESC")) {
      return [...this.issues.values()]
        .sort((left, right) => right.first_seen.localeCompare(left.first_seen) ||
          right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))
        .map((record) => ({ ...record }) as T);
    }

    if (normalized.includes("FROM ISSUE_DOMAIN_LINKS WHERE ISSUE_ID = ?")) {
      const id = asString(bindValues[0]);
      return [...(this.issueDomainLinks.get(id) ?? [])].sort()
        .map((domain_id) => ({ issue_id: id, domain_id }) as T);
    }

    if (normalized.includes("FROM ISSUE_DOMAIN_LINKS ORDER BY DOMAIN_ID")) {
      return [...this.issueDomainLinks.entries()]
        .flatMap(([issue_id, ids]) => [...ids].map((domain_id) => ({ issue_id, domain_id })))
        .sort((left, right) => left.domain_id.localeCompare(right.domain_id))
        .map((record) => record as T);
    }

    if (normalized.includes("FROM DECISIONS WHERE ID = ?")) {
      const record = this.decisions.get(asString(bindValues[0]));
      return record ? ([{ ...record }] as T[]) : [];
    }

    if (normalized.includes("FROM DECISIONS ORDER BY DECIDED_ON DESC")) {
      return [...this.decisions.values()]
        .sort((left, right) => right.decided_on.localeCompare(left.decided_on) ||
          right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))
        .map((record) => ({ ...record }) as T);
    }

    if (normalized.includes("FROM DECISION_RESOURCE_NEED_LINKS")) {
      return [...this.decisionResourceNeedLinks.entries()]
        .flatMap(([decision_id, ids]) => [...ids].map((resource_need_id) => ({ decision_id, resource_need_id })))
        .filter((row) => !normalized.includes("WHERE") || row.decision_id === bindValues[0])
        .sort((a, b) => a.resource_need_id.localeCompare(b.resource_need_id)).map((row) => row as T);
    }
    if (normalized.includes("FROM DECISION_PERSON_LINKS")) {
      return [...this.decisionPersonLinks.entries()]
        .flatMap(([decision_id, ids]) => [...ids].map((person_id) => ({ decision_id, person_id })))
        .filter((row) => !normalized.includes("WHERE") || row.decision_id === bindValues[0])
        .sort((a, b) => a.person_id.localeCompare(b.person_id)).map((row) => row as T);
    }
    if (normalized.includes("FROM DECISION_NAVIGATION_LINKS")) {
      const records = [...this.decisionNavigationLinks.entries()]
        .flatMap(([decision_id, ids]) => [...ids].map((navigation_id) => ({ decision_id, navigation_id })))
        .sort((a, b) => a.navigation_id.localeCompare(b.navigation_id));
      return records.filter((row) => !normalized.includes("WHERE") || row.decision_id === bindValues[0])
        .map((row) => row as T);
    }

    if (normalized.includes("FROM DECISION_DOMAIN_LINKS WHERE DECISION_ID = ?")) {
      return [...(this.decisionDomainLinks.get(asString(bindValues[0])) ?? [])].sort()
        .map((domain_id) => ({ domain_id }) as T);
    }

    if (normalized.includes("FROM DECISION_DOMAIN_LINKS ORDER BY DOMAIN_ID")) {
      return [...this.decisionDomainLinks.entries()]
        .flatMap(([decision_id, ids]) => [...ids].map((domain_id) => ({ decision_id, domain_id })))
        .sort((left, right) => left.domain_id.localeCompare(right.domain_id))
        .map((record) => record as T);
    }

    if (normalized.includes("FROM METRIC_DEFINITIONS ORDER BY CREATED_AT, ID")) {
      return [...this.metricDefinitions.values()].sort((a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
        .map((row) => ({ ...row }) as T);
    }

    if (normalized.includes("FROM METRIC_DOMAIN_LINKS ORDER BY METRIC_ID, DOMAIN_ID")) {
      return [...this.metricDomainLinks.entries()]
        .flatMap(([metric_id, domains]) => [...domains].map((domain_id) => ({ metric_id, domain_id })))
        .sort((a, b) => a.metric_id.localeCompare(b.metric_id) || a.domain_id.localeCompare(b.domain_id))
        .map((row) => row as T);
    }

    if (normalized.includes("FROM METRIC_RECORDS ORDER BY RECORDED_ON DESC")) {
      return [...this.metricRecords.values()].sort((a, b) =>
        b.recorded_on.localeCompare(a.recorded_on) ||
        b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
        .map((row) => ({ ...row }) as T);
    }

    throw new Error(`Memory executor does not support select statement: ${statement}`);
  }

  async execute(
    statement: string,
    bindValues: unknown[] = [],
  ): Promise<SqlExecutionResult> {
    const normalized = normalize(statement);
    if (normalized.startsWith("INSERT INTO LANDSCAPE_CONTEXT ")) {
      const [life_state, current_stage, current_focus, life_tensions, updated_at] = bindValues;
      this.landscapeContext = { id: "current", life_state, current_stage,
        current_focus, life_tensions, updated_at } as LandscapeContextRow;
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("INSERT INTO IDENTITY_ROLES")) {
      const [name, description, active, privacy_level, archived_at, deleted_at, updated_at, version, id, created_at] = bindValues;
      if (this.identityRoles.has(String(id))) throw new Error("身份角色标识重复。");
      this.identityRoles.set(String(id), { id, name, description, active, privacy_level,
        archived_at, deleted_at, updated_at, version, created_at } as IdentityRoleRow);
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("UPDATE IDENTITY_ROLES SET")) {
      const [name, description, active, privacy_level, archived_at, deleted_at, updated_at, version, id, previousVersion] = bindValues;
      const old = this.identityRoles.get(String(id));
      if (!old || old.deleted_at !== null || old.version !== previousVersion) return { rowsAffected: 0 };
      if (this.identityRoleVersions.some(row => row.role_id === id && row.version === old.version)) {
        throw new Error("身份角色历史版本重复。");
      }
      const { id: role_id, ...snapshot } = old;
      this.identityRoleVersions.push({ role_id, version: old.version, changed_at: String(updated_at),
        snapshot_json: JSON.stringify({ ...snapshot,
          domain_ids: [...(this.identityRoleDomainLinks.get(role_id) ?? [])].sort(),
          goal_ids: [...(this.identityRoleGoalLinks.get(role_id) ?? [])].sort() }) });
      this.identityRoles.set(String(id), { ...old, name, description, active, privacy_level,
        archived_at, deleted_at, updated_at, version } as IdentityRoleRow);
      return { rowsAffected: 1 };
    }
    if (/^(DELETE FROM|INSERT INTO) IDENTITY_ROLE_(DOMAIN|GOAL)_LINKS/.test(normalized)) {
      const type = normalized.includes("IDENTITY_ROLE_DOMAIN_LINKS") ? "domain" : "goal";
      const links = type === "domain" ? this.identityRoleDomainLinks : this.identityRoleGoalLinks;
      const id = String(bindValues[0]);
      if (normalized.startsWith("DELETE")) {
        const old = links.get(id) ?? new Set<string>();
        const next = new Set([...old].filter(target => bindValues.slice(1).includes(target)));
        links.set(id, next);
        return { rowsAffected: old.size - next.size };
      }
      const targetId = String(bindValues[1]);
      const domain = this.lifeDomains.get(targetId), goal = this.goals.get(targetId);
      if (!this.identityRoles.has(id) || (type === "domain"
        ? !domain || domain.status === "archived"
        : !goal || goal.archived_at !== null)) return { rowsAffected: 0 };
      const next = new Set(links.get(id));
      if (next.has(targetId)) throw new Error("身份角色关联重复。");
      next.add(targetId); links.set(id, next);
      return { rowsAffected: 1 };
    }
    const reviewColumn = /^ALTER TABLE REVIEWS ADD COLUMN (REVIEW_TYPE|PERIOD_START|PERIOD_END|REVIEW_STATUS|REVIEW_MODE|TEMPLATE_SNAPSHOT) TEXT$/.exec(normalized);
    if (reviewColumn) {
      for (const [id, row] of this.reviews) {
        this.reviews.set(id, { ...row, [reviewColumn[1].toLowerCase()]: null });
      }
      return { rowsAffected: 0 };
    }

    if (
      normalized.startsWith("CREATE TABLE") ||
      normalized.startsWith("CREATE INDEX") ||
      normalized.startsWith("CREATE UNIQUE INDEX") ||
      normalized.startsWith("CREATE VIEW") ||
      normalized.startsWith("CREATE TRIGGER") ||
      normalized.startsWith("DROP TRIGGER") ||
      normalized.startsWith("DROP VIEW") ||
      normalized.startsWith("CREATE TEMP TABLE PRESERVED_RESOURCE_LINKS") ||
      normalized === "DROP TABLE DECISION_RESOURCE_NEED_LINKS" ||
      normalized === "DROP TABLE RESOURCE_NEEDS" ||
      normalized === "ALTER TABLE RESOURCE_NEEDS_NEXT RENAME TO RESOURCE_NEEDS" ||
      normalized === "DROP TABLE PRESERVED_RESOURCE_LINKS" ||
      normalized.startsWith("INSERT INTO RESOURCE_NEEDS_NEXT") ||
      normalized.startsWith("INSERT INTO DECISION_RESOURCE_NEED_LINKS SELECT") ||
      normalized === "DROP TABLE INBOX_ITEMS" ||
      normalized === "DROP TABLE TEMPLATES" ||
      normalized === "DROP TABLE OBJECT_VERSIONS" ||
      normalized.startsWith("INSERT INTO OBJECT_VERSIONS_V34 SELECT") ||
      normalized.startsWith("INSERT INTO OBJECT_VERSIONS_V42 SELECT") ||
      normalized.startsWith("UPDATE SQLITE_SEQUENCE SET") ||
      normalized.startsWith("ALTER TABLE OBJECT_VERSIONS_V34 RENAME") ||
      normalized.startsWith("ALTER TABLE OBJECT_VERSIONS_V42 RENAME") ||
      normalized.startsWith("ALTER TABLE TEMPLATES_M6_HABITS RENAME") ||
      normalized.startsWith("INSERT INTO TEMPLATES_M6_HABITS") ||
      normalized === "ALTER TABLE TEMPLATES_V47 RENAME TO TEMPLATES" ||
      normalized.startsWith("INSERT INTO TEMPLATES_V47") ||
      normalized.startsWith("ALTER TABLE INBOX_ITEMS_M4_ISSUES RENAME") ||
      normalized.startsWith("ALTER TABLE INBOX_ITEMS_M4_DECISIONS RENAME") ||
      normalized.startsWith("INSERT INTO INBOX_ITEMS_M4_ISSUES") ||
      normalized.startsWith("INSERT INTO INBOX_ITEMS_M4_DECISIONS") ||
      normalized === "ALTER TABLE INBOX_ITEMS_V46 RENAME TO INBOX_ITEMS" ||
      normalized.startsWith("INSERT INTO INBOX_ITEMS_V46") ||
      normalized.startsWith("ALTER TABLE ") && normalized.includes(" ADD COLUMN PRIVACY_LEVEL ") ||
      normalized.startsWith("ALTER TABLE LIFE_DOMAINS ADD COLUMN ") ||
      normalized.startsWith("ALTER TABLE GOALS ADD COLUMN PARENT_ID ") ||
      normalized.startsWith("ALTER TABLE GOALS ADD COLUMN LIFECYCLE_STATUS ") ||
      normalized.startsWith("ALTER TABLE GOALS ADD COLUMN STATUS_REASON ") ||
      normalized.startsWith("ALTER TABLE GOALS ADD COLUMN ARCHIVED_AT ") ||
      normalized.startsWith("ALTER TABLE GOALS ADD COLUMN PROGRESS_MODE ") ||
      normalized.startsWith("ALTER TABLE GOALS ADD COLUMN PRIORITY ") ||
      normalized.startsWith("ALTER TABLE GOALS ADD COLUMN HORIZON ") ||
      normalized.startsWith("ALTER TABLE GOALS ADD COLUMN DIRECTION_ID ") ||
      normalized.startsWith("ALTER TABLE GOALS ADD COLUMN PROGRESS_WEIGHT ") ||
      normalized.startsWith("ALTER TABLE ACTIONS ADD COLUMN PROGRESS_WEIGHT ") ||
      normalized.startsWith("ALTER TABLE ACTIONS ADD COLUMN DETAILS_JSON ") ||
      normalized.startsWith("PRAGMA ")
    ) {
      return { rowsAffected: 0 };
    }
    if (normalized.startsWith("INSERT INTO GOAL_DOMAIN_LINKS (GOAL_ID, DOMAIN_ID) SELECT")) {
      let count = 0;
      for (const goal of this.goals.values()) {
        if (goal.domain_id) {
          this.goalDomainLinks.set(goal.id, new Set([goal.domain_id]));
          count++;
        }
      }
      return { rowsAffected: count };
    }
    if (normalized.startsWith("INSERT INTO ACTION_DOMAIN_LINKS (ACTION_ID, DOMAIN_ID) SELECT")) {
      let count = 0;
      for (const action of this.actions.values()) {
        if (action.domain_id) {
          this.actionDomainLinks.set(action.id, new Set([action.domain_id]));
          count++;
        }
      }
      return { rowsAffected: count };
    }
    if (normalized.startsWith("INSERT INTO REVIEW_DOMAIN_LINKS (REVIEW_ID, DOMAIN_ID) SELECT")) {
      let count = 0;
      for (const review of this.reviews.values()) {
        if (review.domain_id) {
          this.reviewDomainLinks.set(review.id, new Set([review.domain_id]));
          count++;
        }
      }
      return { rowsAffected: count };
    }

    if (normalized === "BEGIN IMMEDIATE") {
      if (this.metricTransaction) throw new Error("Transaction already open.");
      this.metricTransaction = {
        landscapeContext: this.landscapeContext ? { ...this.landscapeContext } : null,
        identityRoles: new Map(this.identityRoles),
        identityRoleDomainLinks: copyLinks(this.identityRoleDomainLinks),
        identityRoleGoalLinks: copyLinks(this.identityRoleGoalLinks),
        identityRoleVersions: this.identityRoleVersions.map(row => ({ ...row })),
        navigation: new Map(this.navigation),
        metadata: new Map(this.metadata),
        lifeDomains: new Map(this.lifeDomains),
        domainVersions: this.domainVersions.map(row => ({ ...row })),
        goals: new Map(this.goals),
        goalLinks: copyLinks(this.goalDomainLinks),
        progressItems: new Map(this.goalProgressItems),
        habitProgress: new Map(this.goalHabitProgress),
        relations: new Map(this.goalRelations),
        actions: new Map(this.actions),
        actionLinks: copyLinks(this.actionDomainLinks),
        reviews: new Map(this.reviews),
        reviewGoalLinks: copyLinks(this.reviewGoalLinks),
        reviewIssueLinks: copyLinks(this.reviewIssueLinks),
        reviewLinks: copyLinks(this.reviewDomainLinks),
        reviewAnswers: new Map(this.reviewAnswers),
        planChanges: this.planChanges.map((change) => ({ ...change })),
        stateEvents: this.stateEvents.map((event) => ({ ...event })),
        completionPlans: new Map(this.completionPlans),
        objectVersions: this.objectVersions.map((version) => ({ ...version })),
        definitions: new Map(this.metricDefinitions),
        satisfactionLinks: new Map(this.satisfactionLinks),
        links: new Map([...this.metricDomainLinks].map(([id, links]) => [id, new Set(links)])),
        habits: new Map(this.habits),
        habitLinks: new Map([...this.habitDomainLinks].map(([id, links]) => [id, new Set(links)])),
        habitLogs: new Map(this.habitLogs),
        records: {
          people: new Map(this.lifeRecords.people),
          life_events: new Map(this.lifeRecords.life_events),
          skills: new Map(this.lifeRecords.skills),
        },
        personDates: new Map(this.personDates),
        personRelationshipVersions: this.personRelationshipVersions.map(row => ({ ...row })),
        recordLinks: {
          person_domain_links: copyLinks(this.recordLinks.person_domain_links),
          event_domain_links: copyLinks(this.recordLinks.event_domain_links),
          skill_domain_links: copyLinks(this.recordLinks.skill_domain_links),
        },
        needs: new Map(this.resourceNeeds),
        assessments: new Map(this.assessments),
      };
      return { rowsAffected: 0 };
    }
    if (normalized === "COMMIT") {
      this.metricTransaction = null;
      return { rowsAffected: 0 };
    }
    if (normalized === "ROLLBACK") {
      if (this.metricTransaction) {
        this.landscapeContext = this.metricTransaction.landscapeContext;
        this.identityRoles.clear();
        for (const [id, row] of this.metricTransaction.identityRoles) this.identityRoles.set(id, row);
        this.identityRoleDomainLinks.clear();
        for (const [id, ids] of this.metricTransaction.identityRoleDomainLinks) this.identityRoleDomainLinks.set(id, ids);
        this.identityRoleGoalLinks.clear();
        for (const [id, ids] of this.metricTransaction.identityRoleGoalLinks) this.identityRoleGoalLinks.set(id, ids);
        this.identityRoleVersions.splice(0, this.identityRoleVersions.length, ...this.metricTransaction.identityRoleVersions);
        this.navigation.clear();
        for (const [id, row] of this.metricTransaction.navigation) this.navigation.set(id, row);
        this.metadata.clear();
        for (const [key, record] of this.metricTransaction.metadata) this.metadata.set(key, record);
        this.lifeDomains.clear();
        for (const [id, record] of this.metricTransaction.lifeDomains) this.lifeDomains.set(id, record);
        this.domainVersions.splice(0, this.domainVersions.length, ...this.metricTransaction.domainVersions);
        this.goals.clear();
        for (const [id, record] of this.metricTransaction.goals) this.goals.set(id, record);
        this.goalDomainLinks.clear();
        for (const [id, ids] of this.metricTransaction.goalLinks) this.goalDomainLinks.set(id, ids);
        this.goalProgressItems.clear();
        this.goalRelations.clear();
        for (const [id, row] of this.metricTransaction.relations) this.goalRelations.set(id, row);
        this.goalHabitProgress.clear();
        for (const [id, row] of this.metricTransaction.habitProgress) this.goalHabitProgress.set(id, row);
        for (const [id, row] of this.metricTransaction.progressItems) this.goalProgressItems.set(id, row);
        this.actions.clear();
        for (const [id, row] of this.metricTransaction.actions) this.actions.set(id, row);
        this.actionDomainLinks.clear();
        for (const [id, ids] of this.metricTransaction.actionLinks) this.actionDomainLinks.set(id, ids);
        this.reviews.clear();
        for (const [id, row] of this.metricTransaction.reviews) this.reviews.set(id, row);
        this.reviewGoalLinks.clear();
        this.reviewIssueLinks.clear();
        for (const [id, ids] of this.metricTransaction.reviewGoalLinks) this.reviewGoalLinks.set(id, ids);
        for (const [id, ids] of this.metricTransaction.reviewIssueLinks) this.reviewIssueLinks.set(id, ids);
        this.reviewDomainLinks.clear();
        this.reviewAnswers.clear();
        for (const [key, row] of this.metricTransaction.reviewAnswers) this.reviewAnswers.set(key, row);
        for (const [id, ids] of this.metricTransaction.reviewLinks) this.reviewDomainLinks.set(id, ids);
        this.planChanges.splice(0, this.planChanges.length, ...this.metricTransaction.planChanges);
        this.stateEvents.splice(0, this.stateEvents.length, ...this.metricTransaction.stateEvents);
        this.completionPlans.clear();
        for (const [id, row] of this.metricTransaction.completionPlans) this.completionPlans.set(id, row);
        this.objectVersions.splice(0, this.objectVersions.length, ...this.metricTransaction.objectVersions);
        this.metricDefinitions.clear();
        for (const [id, row] of this.metricTransaction.definitions) this.metricDefinitions.set(id, row);
        this.satisfactionLinks.clear();
        for (const [id, metric] of this.metricTransaction.satisfactionLinks) this.satisfactionLinks.set(id, metric);
        this.metricDomainLinks.clear();
        for (const [id, links] of this.metricTransaction.links) this.metricDomainLinks.set(id, links);
        this.habits.clear();
        for (const [id, row] of this.metricTransaction.habits) this.habits.set(id, row);
        this.habitDomainLinks.clear();
        for (const [id, links] of this.metricTransaction.habitLinks) this.habitDomainLinks.set(id, links);
        this.habitLogs.clear();
        for (const [id, row] of this.metricTransaction.habitLogs) this.habitLogs.set(id, row);
        for (const table of ["people", "life_events", "skills"] as const) {
          this.lifeRecords[table].clear();
          for (const [id, row] of this.metricTransaction.records[table])
            this.lifeRecords[table].set(id, row);
        }
        this.personDates.clear();
        this.personRelationshipVersions.splice(0, this.personRelationshipVersions.length,
          ...this.metricTransaction.personRelationshipVersions);
        for (const [id, row] of this.metricTransaction.personDates) this.personDates.set(id, row);
        for (const table of ["person_domain_links", "event_domain_links", "skill_domain_links"] as const) {
          this.recordLinks[table].clear();
          for (const [id, ids] of this.metricTransaction.recordLinks[table])
            this.recordLinks[table].set(id, ids);
        }
        this.resourceNeeds.clear();
        for (const [id, row] of this.metricTransaction.needs) this.resourceNeeds.set(id, row);
        this.assessments.clear();
        for (const [id, row] of this.metricTransaction.assessments) this.assessments.set(id, row);
        this.metricTransaction = null;
      }
      return { rowsAffected: 0 };
    }

    if (normalized.startsWith("INSERT INTO SCHEMA_MIGRATIONS")) {
      this.appliedMigrations.add(asString(bindValues[0]));
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("INSERT INTO DOMAIN_SATISFACTION_LINKS ")) {
      const domainId = asString(bindValues[0]);
      const metricId = asString(bindValues[1]);
      if (!this.appliedMigrations.has("0051-v1-domain-satisfaction") ||
        !this.lifeDomains.has(domainId) || !this.metricDefinitions.has(metricId) ||
        !this.metricDomainLinks.get(metricId)?.has(domainId)) {
        throw new Error("Invalid domain satisfaction reference.");
      }
      this.satisfactionLinks.set(domainId, metricId);
      return { rowsAffected: 1 };
    }
    if (normalized === "DELETE FROM DOMAIN_SATISFACTION_LINKS WHERE DOMAIN_ID = ?") {
      return { rowsAffected: this.satisfactionLinks.delete(asString(bindValues[0])) ? 1 : 0 };
    }
    if (normalized.startsWith("INSERT INTO PERSON_RELATIONSHIP_VERSIONS ")) {
      if (!this.appliedMigrations.has("0050-v1-person-relationship-history")) {
        throw new Error("Person relationship history migration is not applied.");
      }
      const [changedAt, afterJson, personId, relationshipType, state] = bindValues;
      const previous = this.lifeRecords.people.get(String(personId));
      if (!previous || (previous.relationship_type === relationshipType && previous.state === state)) {
        return { rowsAffected: 0 };
      }
      const after = parsePersonRelationshipSnapshot(JSON.parse(String(afterJson)));
      const before = parsePersonRelationshipSnapshot({ name: previous.name,
        relationshipType: previous.relationship_type, state: previous.state,
        domainIds: [...(this.recordLinks.person_domain_links.get(String(personId)) ?? [])].sort() });
      this.personRelationshipVersions.push({
        id: (this.personRelationshipVersions[this.personRelationshipVersions.length - 1]?.id ?? 0) + 1,
        person_id: String(personId), changed_at: String(changedAt),
        before_json: JSON.stringify(before), after_json: JSON.stringify(after),
      });
      return { rowsAffected: 1 };
    }
    if (normalized === "DELETE FROM PERSON_DATES WHERE PERSON_ID = ?") {
      let rowsAffected = 0;
      for (const [key, row] of this.personDates) {
        if (row.person_id === bindValues[0]) { this.personDates.delete(key); rowsAffected += 1; }
      }
      return { rowsAffected };
    }
    if (normalized.startsWith("INSERT INTO PERSON_DATES ")) {
      const [personId, position, kind, label, date] = bindValues;
      if (!this.lifeRecords.people.has(String(personId)) ||
        !Number.isInteger(position) || Number(position) < 0 || Number(position) > 20) {
        throw new Error("Invalid person date ownership or position.");
      }
      const key = JSON.stringify([personId, position]);
      if (this.personDates.has(key)) throw new Error("Duplicate person date position.");
      const existing = [...this.personDates.values()].filter(row => row.person_id === personId)
        .map(row => ({ kind: row.kind, label: row.label, date: row.happened_on }));
      const checked = normalizePersonDates([...existing, { kind, label, date }], false);
      const last = checked[checked.length - 1];
      this.personDates.set(key, { person_id: String(personId), sort_order: Number(position),
        kind: last.kind, label: last.label, happened_on: last.date });
      return { rowsAffected: 1 };
    }
    const recordInsert = /^INSERT INTO (PEOPLE|LIFE_EVENTS|SKILLS) \((.+)\) VALUES \(/.exec(normalized);
    const recordUpdate = normalized.includes(" SET PRIVACY_LEVEL = ") ? null
      : /^UPDATE (PEOPLE|LIFE_EVENTS|SKILLS) SET (.+) WHERE ID = \?/.exec(normalized);
    if (recordInsert || recordUpdate) {
      const table = (recordInsert?.[1] ?? recordUpdate?.[1] ?? "").toLowerCase() as
        "people" | "life_events" | "skills";
      const map = this.lifeRecords[table];
      const id = asString(recordInsert ? bindValues[0] : bindValues[bindValues.length - 1]);
      const previous = map.get(id);
      if (recordInsert && previous) throw new Error("Duplicate record.");
      if (recordUpdate && !previous) return { rowsAffected: 0 };
      const columns = recordInsert
        ? recordInsert[2].split(", ") : recordUpdate![2].split(", ").map((part) => part.split(" =")[0]);
      const values = recordInsert ? bindValues : bindValues.slice(0, -1);
      const record: Record<string, unknown> = { ...previous, id, archived: previous?.archived ?? 0 };
      columns.forEach((column, index) => { record[column.toLowerCase()] = values[index]; });
      if (!(String(record.name ?? record.title).trim())) throw new Error("Empty record name.");
      if (table === "life_events") {
        if (record.person_id && !this.lifeRecords.people.has(String(record.person_id))) throw new Error("Missing person.");
        if (record.goal_id && !this.goals.has(String(record.goal_id))) throw new Error("Missing goal.");
      }
      if (table === "skills") {
        if (record.goal_id && !this.goals.has(String(record.goal_id))) throw new Error("Missing goal.");
        for (const key of ["current_level", "target_level"]) {
          if (!Number.isInteger(record[key]) || Number(record[key]) < 0 || Number(record[key]) > 5)
            throw new Error("Invalid skill level.");
        }
      }
      map.set(id, record);
      return { rowsAffected: 1 };
    }
    for (const [table, ownerColumn, parent] of [
      ["person_domain_links", "person_id", "people"],
      ["event_domain_links", "event_id", "life_events"],
      ["skill_domain_links", "skill_id", "skills"],
    ] as const) {
      if (normalized.startsWith(`DELETE FROM ${table.toUpperCase()}`)) {
        return { rowsAffected: this.recordLinks[table].delete(asString(bindValues[0])) ? 1 : 0 };
      }
      if (normalized.startsWith(`INSERT INTO ${table.toUpperCase()}`)) {
        const id = asString(bindValues[0]);
        const domain = asString(bindValues[1]);
        if (!this.lifeRecords[parent].has(id) || !this.lifeDomains.has(domain))
          throw new Error(`Invalid ${ownerColumn} link.`);
        const ids = this.recordLinks[table].get(id) ?? new Set<string>();
        if (ids.has(domain)) throw new Error("Duplicate domain link.");
        ids.add(domain);
        this.recordLinks[table].set(id, ids);
        return { rowsAffected: 1 };
      }
    }
    const archive = /^UPDATE (PEOPLE|LIFE_EVENTS|SKILLS) SET ARCHIVED = \?, UPDATED_AT = \? WHERE ID = \?$/.exec(normalized);
    if (archive) {
      const table = archive[1].toLowerCase() as "people" | "life_events" | "skills";
      const id = asString(bindValues[2]);
      const previous = this.lifeRecords[table].get(id);
      if (!previous) return { rowsAffected: 0 };
      this.lifeRecords[table].set(id, { ...previous, archived: bindValues[0], updated_at: bindValues[1] });
      return { rowsAffected: 1 };
    }
    const privacyUpdate = /^UPDATE (\w+) SET PRIVACY_LEVEL = \? WHERE ID = \?$/.exec(normalized);
    if (privacyUpdate) {
      const table = privacyUpdate[1];
      const level = asString(bindValues[0]);
      const id = asString(bindValues[1]);
      const records = this.recordsForPrivacy(table);
      if (!["normal", "private", "highly_sensitive"].includes(level)) {
        throw new Error("Invalid privacy level.");
      }
      if (!records.has(id)) return { rowsAffected: 0 };
      this.privacyLevels.set(`${table}:${id}`, level);
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("UPDATE RESOURCE_NEEDS SET PRIVACY_LEVEL = COALESCE(")) {
      for (const [id, need] of this.resourceNeeds) {
        const owner = need.goal_id ? `GOALS:${need.goal_id}` : `DECISIONS:${need.decision_id}`;
        this.privacyLevels.set(`RESOURCE_NEEDS:${id}`, this.privacyLevels.get(owner) ?? "private");
      }
      return { rowsAffected: this.resourceNeeds.size };
    }
    if (normalized.startsWith("INSERT INTO RESOURCE_NEEDS") ||
        normalized.startsWith("UPDATE RESOURCE_NEEDS SET")) {
      const insert = normalized.startsWith("INSERT");
      const id = asString(bindValues[insert ? 0 : 8]);
      const previous = this.resourceNeeds.get(id);
      if ((insert && previous) || (!insert && !previous)) {
        if (!insert) return { rowsAffected: 0 };
        throw new Error("Duplicate resource need.");
      }
      const offset = insert ? 1 : 0;
      const goalId = asOptionalString(bindValues[offset]);
      const skillId = asOptionalString(bindValues[offset + 3]);
      const personId = asOptionalString(bindValues[offset + 4]);
      const decisionId = asOptionalString(bindValues[insert ? 9 : 7]);
      if (Boolean(goalId) === Boolean(decisionId) || (goalId && !this.goals.has(goalId)) ||
          (decisionId && !this.decisions.has(decisionId)) || (skillId && !this.lifeRecords.skills.has(skillId)) ||
          (personId && !this.lifeRecords.people.has(personId))) throw new Error("Invalid resource reference.");
      this.resourceNeeds.set(id, {
        id, goal_id: goalId, decision_id: decisionId, kind: bindValues[offset + 1], description: bindValues[offset + 2],
        skill_id: skillId, person_id: personId, met: bindValues[offset + 5],
        created_at: previous?.created_at ?? bindValues[7], updated_at: bindValues[insert ? 8 : 6],
      });
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("INSERT INTO SYSTEM_ASSESSMENTS") ||
        normalized.startsWith("UPDATE SYSTEM_ASSESSMENTS SET")) {
      const insert = normalized.startsWith("INSERT");
      const id = asString(bindValues[insert ? 0 : 7]);
      const previous = this.assessments.get(id);
      if (!insert && !previous) return { rowsAffected: 0 };
      const kind = insert ? bindValues[1] : previous?.period_kind;
      const period = insert ? bindValues[2] : previous?.period_start;
      if (insert && [...this.assessments.values()].some((row) =>
        row.period_kind === kind && row.period_start === period)) throw new Error("Duplicate period.");
      const start = insert ? 3 : 0;
      this.assessments.set(id, {
        id, period_kind: kind, period_start: period, clarity: bindValues[start],
        alignment: bindValues[start + 1], reviews: bindValues[start + 2],
        decisions: bindValues[start + 3], early_issues: bindValues[start + 4],
        adjustment: bindValues[start + 5], created_at: previous?.created_at ?? bindValues[9],
        updated_at: bindValues[insert ? 10 : 6],
      });
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("INSERT INTO TEMPLATES")) {
      const id = asString(bindValues[0]);
      if (this.templates.has(id)) throw new Error("Duplicate template id.");
      this.templates.set(id, {
        id, category: asString(bindValues[1]), name: asString(bindValues[2]),
        version: 1, defaults_json: asString(bindValues[3]),
        created_at: asString(bindValues[4]), updated_at: asString(bindValues[5]),
      });
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("UPDATE TEMPLATES SET")) {
      const id = asString(bindValues[3]);
      const previous = this.templates.get(id);
      if (!previous) return { rowsAffected: 0 };
      this.templates.set(id, { ...previous, name: asString(bindValues[0]),
        defaults_json: asString(bindValues[1]), version: previous.version + 1,
        updated_at: asString(bindValues[2]) });
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("INSERT INTO HABITS ")) {
      const row: HabitRow = {
        id: asString(bindValues[0]), title: asString(bindValues[1]),
        intention: asString(bindValues[2]), weekly_target: asNumber(bindValues[3]),
        stable_context: asString(bindValues[4]), trigger_condition: asString(bindValues[5]),
        obstacle: asString(bindValues[6]), adjustment: asString(bindValues[7]),
        start_on: asString(bindValues[8]), archived: 0,
        created_at: asString(bindValues[9]), updated_at: asString(bindValues[10]),
      };
      if (this.habits.has(row.id) || !row.title.trim() ||
          !Number.isInteger(row.weekly_target) || row.weekly_target < 1 || row.weekly_target > 7) {
        throw new Error("Invalid habit.");
      }
      this.habits.set(row.id, row);
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("UPDATE HABITS SET TITLE = ?")) {
      const id = asString(bindValues[9]);
      const previous = this.habits.get(id);
      if (!previous) return { rowsAffected: 0 };
      const title = asString(bindValues[0]);
      const weekly = asNumber(bindValues[2]);
      if (!title.trim() || !Number.isInteger(weekly) || weekly < 1 || weekly > 7) {
        throw new Error("Invalid habit.");
      }
      this.habits.set(id, { ...previous, title, intention: asString(bindValues[1]),
        weekly_target: weekly, stable_context: asString(bindValues[3]),
        trigger_condition: asString(bindValues[4]), obstacle: asString(bindValues[5]),
        adjustment: asString(bindValues[6]), start_on: asString(bindValues[7]),
        updated_at: asString(bindValues[8]) });
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("UPDATE HABITS SET ARCHIVED = ?")) {
      const id = asString(bindValues[2]);
      const previous = this.habits.get(id);
      if (!previous) return { rowsAffected: 0 };
      const archived = asNumber(bindValues[0]);
      if (archived !== 0 && archived !== 1) throw new Error("Invalid archive state.");
      this.habits.set(id, { ...previous, archived, updated_at: asString(bindValues[1]) });
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("DELETE FROM HABIT_DOMAIN_LINKS")) {
      this.habitDomainLinks.delete(asString(bindValues[0]));
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("INSERT INTO HABIT_DOMAIN_LINKS")) {
      const habitId = asString(bindValues[0]);
      const domainId = asString(bindValues[1]);
      if (!this.habits.has(habitId) || !this.lifeDomains.has(domainId) ||
          this.habitDomainLinks.get(habitId)?.has(domainId)) throw new Error("Invalid habit link.");
      const links = this.habitDomainLinks.get(habitId) ?? new Set<string>();
      links.add(domainId);
      this.habitDomainLinks.set(habitId, links);
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("INSERT INTO HABIT_LOGS")) {
      const row: HabitLogRow = {
        id: asString(bindValues[0]), habit_id: asString(bindValues[1]),
        recorded_on: asString(bindValues[2]), completed: asNumber(bindValues[3]),
        obstacle: asString(bindValues[4]), adjustment: asString(bindValues[5]),
        created_at: asString(bindValues[6]), updated_at: asString(bindValues[7]),
      };
      if (!this.habits.has(row.habit_id) || this.habitLogs.has(row.id) ||
          (row.completed !== 0 && row.completed !== 1) ||
          [...this.habitLogs.values()].some((item) =>
            item.habit_id === row.habit_id && item.recorded_on === row.recorded_on)) {
        throw new Error("Invalid habit log.");
      }
      this.habitLogs.set(row.id, row);
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("UPDATE HABIT_LOGS SET")) {
      const id = asString(bindValues[4]);
      const previous = this.habitLogs.get(id);
      if (!previous || previous.habit_id !== asString(bindValues[5])) return { rowsAffected: 0 };
      const completed = asNumber(bindValues[0]);
      if (completed !== 0 && completed !== 1) throw new Error("Invalid completion state.");
      this.habitLogs.set(id, { ...previous, completed, obstacle: asString(bindValues[1]),
        adjustment: asString(bindValues[2]), updated_at: asString(bindValues[3]) });
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("INSERT INTO LIFE_NAVIGATION")) {
      const [id, kind, title, description, archived_at, created_at, updated_at] = bindValues;
      if (this.navigation.has(String(id))) throw new Error("导航标识重复。");
      this.navigation.set(String(id), { id, kind, title, description, archived_at, created_at, updated_at });
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("UPDATE LIFE_NAVIGATION SET")) {
      const id = String(bindValues[bindValues.length - 1]), current = this.navigation.get(id);
      if (!current || (normalized.includes("ARCHIVED_AT IS NULL") && current.archived_at !== null)) return { rowsAffected: 0 };
      const row: Record<string, unknown> = normalized.includes("SET TITLE")
        ? { ...current, title: bindValues[0], description: bindValues[1], updated_at: bindValues[2] }
        : { ...current, archived_at: bindValues[0], updated_at: bindValues[1] };
      if (current.title !== row.title || current.description !== row.description || current.archived_at !== row.archived_at) {
        this.captureVersion("navigation", { ...current, id }, String(row.updated_at));
      }
      this.navigation.set(id, row);
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("INSERT INTO APP_METADATA") ||
        normalized.startsWith("INSERT OR IGNORE INTO APP_METADATA")) {
      const key = asString(bindValues[0]);
      const value = asString(bindValues[1]);
      const updatedAt = asString(bindValues[2]);
      if (normalized.startsWith("INSERT OR IGNORE INTO APP_METADATA") && this.metadata.has(key)) {
        return { rowsAffected: 0 };
      }
      this.metadata.set(key, { value, updatedAt });
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("DELETE FROM APP_METADATA WHERE KEY = ?")) {
      return { rowsAffected: this.metadata.delete(asString(bindValues[0])) ? 1 : 0 };
    }

    if (normalized.startsWith("INSERT INTO LIFE_DOMAINS")) {
      const name = asString(bindValues[1]);
      if (normalized.includes("WHERE NOT EXISTS") &&
        [...this.lifeDomains.values()].some((domain) => domain.name === name)) {
        return { rowsAffected: 0 };
      }
      const record: LifeDomainRecord = {
        id: asString(bindValues[0]),
        name: asString(bindValues[1]),
        description: asString(bindValues[2]),
        focus: asString(bindValues[3]),
        color_key: asString(bindValues[4]),
        icon_key: asString(bindValues[5]),
        sort_order: asNumber(bindValues[6]),
        created_at: asString(bindValues[7]),
        updated_at: asString(bindValues[8]),
        current_state: asString(bindValues[9]),
        long_term_expectation: asString(bindValues[10]),
        status: asDomainStatus(bindValues[11]),
      };
      if (this.lifeDomains.has(record.id)) throw new Error("Duplicate domain.");
      this.lifeDomains.set(record.id, record);
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("INSERT INTO METRIC_DEFINITIONS")) {
      const row: MetricDefinitionRow = {
        id: asString(bindValues[0]), name: asString(bindValues[1]),
        unit: asString(bindValues[2]), archived: 0, created_at: asString(bindValues[3]),
      };
      if (this.metricDefinitions.has(row.id) || !row.name.trim() || !row.unit.trim()) {
        throw new Error("Invalid metric definition.");
      }
      this.metricDefinitions.set(row.id, row);
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("INSERT INTO METRIC_DOMAIN_LINKS")) {
      const metricId = asString(bindValues[0]);
      const domainId = asString(bindValues[1]);
      if (!this.metricDefinitions.has(metricId) || !this.lifeDomains.has(domainId) ||
          this.metricDomainLinks.get(metricId)?.has(domainId)) {
        throw new Error("Invalid metric domain link.");
      }
      const links = this.metricDomainLinks.get(metricId) ?? new Set<string>();
      links.add(domainId);
      this.metricDomainLinks.set(metricId, links);
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("UPDATE METRIC_DEFINITIONS SET ARCHIVED = ?")) {
      const id = asString(bindValues[1]);
      const existing = this.metricDefinitions.get(id);
      if (!existing) return { rowsAffected: 0 };
      this.metricDefinitions.set(id, { ...existing, archived: asNumber(bindValues[0]) });
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("INSERT INTO METRIC_RECORDS")) {
      const row: MetricRecordRow = {
        id: asString(bindValues[0]), metric_id: asString(bindValues[1]),
        recorded_on: asString(bindValues[2]), value: asNumber(bindValues[3]),
        note: asString(bindValues[4]), created_at: asString(bindValues[5]),
        updated_at: asString(bindValues[6]),
      };
      if (this.metricRecords.has(row.id) || !this.metricDefinitions.has(row.metric_id) ||
          [...this.metricRecords.values()].some((item) =>
            item.metric_id === row.metric_id && item.recorded_on === row.recorded_on)) {
        throw new Error("Duplicate or invalid metric record.");
      }
      this.metricRecords.set(row.id, row);
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("UPDATE METRIC_RECORDS SET")) {
      const id = asString(bindValues[4]);
      const metricId = asString(bindValues[5]);
      const previous = this.metricRecords.get(id);
      if (!previous || previous.metric_id !== metricId) return { rowsAffected: 0 };
      const date = asString(bindValues[0]);
      if ([...this.metricRecords.values()].some((item) =>
        item.id !== id && item.metric_id === metricId && item.recorded_on === date)) {
        throw new Error("Duplicate metric date.");
      }
      this.metricRecords.set(id, { ...previous, recorded_on: date, value: asNumber(bindValues[1]),
        note: asString(bindValues[2]), updated_at: asString(bindValues[3]) });
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("UPDATE LIFE_DOMAINS SET SORT_ORDER = ?")) {
      const id = asString(bindValues[1]);
      const existing = this.lifeDomains.get(id);
      if (!existing || this.lifeDomains.size !== asNumber(bindValues[2])) {
        return { rowsAffected: 0 };
      }
      this.lifeDomains.set(id, { ...existing, sort_order: asNumber(bindValues[0]) });
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("UPDATE LIFE_DOMAINS SET")) {
      const id = asString(bindValues[9]);
      const existingRecord = this.lifeDomains.get(id);

      if (!existingRecord) {
        return { rowsAffected: 0 };
      }

      const updated: LifeDomainRecord = {
        ...existingRecord,
        name: asString(bindValues[0]),
        description: asString(bindValues[1]),
        focus: asString(bindValues[2]),
        color_key: asString(bindValues[3]),
        icon_key: asString(bindValues[4]),
        current_state: asString(bindValues[5]),
        long_term_expectation: asString(bindValues[6]),
        status: asDomainStatus(bindValues[7]),
        updated_at: asString(bindValues[8]),
      };
      if (this.appliedMigrations.has("0048-v1-domain-history") &&
        domainHistoryFields.some(field => existingRecord[field] !== updated[field])) {
        const snapshot = (record: LifeDomainRecord) => JSON.stringify(
          Object.fromEntries(domainHistoryFields.map(field => [field, record[field]])));
        this.domainVersions.push({ id: (this.domainVersions[this.domainVersions.length - 1]?.id ?? 0) + 1,
          domain_id: id, changed_at: updated.updated_at,
          before_json: snapshot(existingRecord), after_json: snapshot(updated) });
      }
      this.lifeDomains.set(id, updated);
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("INSERT INTO GOALS")) {
      const record: GoalRecord = {
        id: asString(bindValues[0]),
        title: asString(bindValues[1]),
        description: asString(bindValues[2]),
        domain_id: asOptionalString(bindValues[3]),
        parent_id: asOptionalString(bindValues[7]),
        status: asGoalStatus(bindValues[4]),
        target_date: asOptionalString(bindValues[5]),
        sort_order: asNumber(bindValues[6]),
        completed_at: asOptionalString(bindValues[8]),
        created_at: asString(bindValues[9]),
        updated_at: asString(bindValues[10]),
        lifecycle_status: asOptionalString(bindValues[11]),
        status_reason: asOptionalString(bindValues[12]),
        archived_at: asOptionalString(bindValues[13]),
        progress_mode: asString(bindValues[14] ?? "automatic"),
        progress_weight: asNumber(bindValues[15] ?? 1),
        priority: asString(bindValues[16] ?? "medium"),
        horizon: asOptionalString(bindValues[17]), direction_id: asOptionalString(bindValues[18]),
      };
      if (!Number.isFinite(record.progress_weight) || record.progress_weight <= 0 || record.progress_weight > 100) throw new Error("Invalid progress weight.");
      this.assertGoalDirection(record);
      if (record.parent_id && !this.goals.has(record.parent_id)) throw new Error("Missing parent goal.");
      if (this.goals.has(record.id)) throw new Error("Duplicate goal id.");
      this.goals.set(record.id, record);
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("INSERT INTO OBJECT_VERSIONS (OBJECT_TYPE, OBJECT_ID, CHANGED_AT, SNAPSHOT_JSON) SELECT 'GOAL'")) {
      const goalId = asString(bindValues[1]);
      const goal = this.goals.get(goalId);
      if (!goal) return { rowsAffected: 0 };
      this.captureVersion("goal", { ...goal,
        status: goal.lifecycle_status ?? goal.status,
        domain_ids: [...(this.goalDomainLinks.get(goalId) ?? [])],
        progress_items: this.progressSnapshot(goalId),
        habit_progress: this.habitSnapshot(goalId),
        relations: this.relationSnapshot(goalId),
      }, asString(bindValues[0]));
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("UPDATE GOALS SET UPDATED_AT = ? WHERE ID = ?")) {
      const id = asString(bindValues[1]);
      const goal = this.goals.get(id);
      if (!goal) return { rowsAffected: 0 };
      this.goals.set(id, { ...goal, updated_at: asString(bindValues[0]) });
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("DELETE FROM GOAL_PROGRESS_ITEMS WHERE GOAL_ID = ?")) {
      let count = 0;
      for (const [id, item] of this.goalProgressItems) {
        if (item.goal_id === bindValues[0]) { this.goalProgressItems.delete(id); count++; }
      }
      return { rowsAffected: count };
    }
    if (normalized.startsWith("INSERT INTO GOAL_PROGRESS_ITEMS")) {
      const record: ProgressItemRecord = {
        id: asString(bindValues[0]), goal_id: asString(bindValues[1]),
        kind: asString(bindValues[2]), title: asString(bindValues[3]),
        target_value: asNumber(bindValues[4]), current_value: asNumber(bindValues[5]),
        weight: asNumber(bindValues[6]), sort_order: asNumber(bindValues[7]),
        created_at: asString(bindValues[8]), updated_at: asString(bindValues[9]),
      };
      if (!this.goals.has(record.goal_id) || this.goalProgressItems.has(record.id) ||
          !record.title.trim() || record.target_value <= 0 ||
          record.current_value < 0 || record.weight <= 0) throw new Error("Invalid goal progress item.");
      this.goalProgressItems.set(record.id, record);
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("DELETE FROM GOAL_RELATIONS WHERE GOAL_ID = ?")) {
      let count = 0;
      for (const [key, row] of this.goalRelations) {
        if (row.goal_id === bindValues[0]) { this.goalRelations.delete(key); count++; }
      }
      return { rowsAffected: count };
    }
    if (normalized.startsWith("INSERT INTO GOAL_RELATIONS")) {
      const row = { goal_id: asString(bindValues[0]), target_goal_id: asString(bindValues[1]), relation_type: asString(bindValues[2]) };
      const key = JSON.stringify([row.goal_id, row.target_goal_id, row.relation_type]);
      const reverse = JSON.stringify([row.target_goal_id, row.goal_id, row.relation_type]);
      if (!this.goals.has(row.goal_id) || !this.goals.has(row.target_goal_id) || row.goal_id === row.target_goal_id ||
          !["support", "depend", "conflict", "related"].includes(row.relation_type) || this.goalRelations.has(key) ||
          (["conflict", "related"].includes(row.relation_type) && this.goalRelations.has(reverse))) {
        throw new Error("Invalid goal relation.");
      }
      this.goalRelations.set(key, row);
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("DELETE FROM GOAL_HABIT_PROGRESS WHERE GOAL_ID = ?")) {
      let count = 0;
      for (const [key, row] of this.goalHabitProgress) {
        if (row.goal_id === bindValues[0]) { this.goalHabitProgress.delete(key); count++; }
      }
      return { rowsAffected: count };
    }
    if (normalized.startsWith("INSERT INTO GOAL_HABIT_PROGRESS")) {
      const row = { goal_id: asString(bindValues[0]), habit_id: asString(bindValues[1]),
        start_on: asString(bindValues[2]), end_on: asString(bindValues[3]),
        weekly_target: asNumber(bindValues[4]), weight: asNumber(bindValues[5]), sort_order: asNumber(bindValues[6]) };
      const key = JSON.stringify([row.goal_id, row.habit_id]);
      const count = [...this.goalHabitProgress.values()].filter((item) => item.goal_id === row.goal_id).length;
      if (!this.goals.has(row.goal_id) || !this.habits.has(row.habit_id) || this.goalHabitProgress.has(key) || count >= 30 ||
          this.goals.get(row.goal_id)?.progress_mode !== "automatic" ||
          !Number.isInteger(row.weekly_target) || row.weekly_target < 1 || row.weekly_target > 7 ||
          !Number.isFinite(row.weight) || row.weight <= 0 || row.weight > 100 ||
          !Number.isInteger(row.sort_order) || row.sort_order < 0 ||
          !isPlainDate(row.start_on) || !isPlainDate(row.end_on) || row.start_on > row.end_on) {
        throw new Error("Invalid habit goal settings.");
      }
      this.goalHabitProgress.set(key, row);
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("DELETE FROM GOAL_DOMAIN_LINKS WHERE GOAL_ID = ?")) {
      const id = asString(bindValues[0]);
      const count = this.goalDomainLinks.get(id)?.size ?? 0;
      this.goalDomainLinks.delete(id);
      return { rowsAffected: count };
    }
    if (normalized.startsWith("INSERT INTO GOAL_DOMAIN_LINKS (GOAL_ID, DOMAIN_ID) VALUES")) {
      const goalId = asString(bindValues[0]);
      const domainId = asString(bindValues[1]);
      if (!this.goals.has(goalId) || !this.lifeDomains.has(domainId) ||
          this.goalDomainLinks.get(goalId)?.has(domainId)) throw new Error("Invalid goal link.");
      const ids = this.goalDomainLinks.get(goalId) ?? new Set<string>();
      ids.add(domainId);
      this.goalDomainLinks.set(goalId, ids);
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("UPDATE GOALS SET")) {
      const id = asString(bindValues[16]);
      const existingRecord = this.goals.get(id);

      if (!existingRecord) {
        return { rowsAffected: 0 };
      }

      this.assertGoalDirection({ horizon: asOptionalString(bindValues[14]), direction_id: asOptionalString(bindValues[15]) });
      this.captureVersion("goal", { ...existingRecord,
        status: existingRecord.lifecycle_status ?? existingRecord.status,
        domain_ids: [...(this.goalDomainLinks.get(id) ?? [])],
        progress_items: this.progressSnapshot(id),
        habit_progress: this.habitSnapshot(id),
        relations: this.relationSnapshot(id),
      }, asString(bindValues[7]));
      this.goals.set(id, {
        ...existingRecord,
        title: asString(bindValues[0]),
        description: asString(bindValues[1]),
        domain_id: asOptionalString(bindValues[2]),
        parent_id: asOptionalString(bindValues[5]),
        status: asGoalStatus(bindValues[3]),
        target_date: asOptionalString(bindValues[4]),
        completed_at: asOptionalString(bindValues[6]),
        updated_at: asString(bindValues[7]),
        lifecycle_status: asOptionalString(bindValues[8]),
        status_reason: asOptionalString(bindValues[9]),
        archived_at: asOptionalString(bindValues[10]),
        progress_mode: asString(bindValues[11]),
        progress_weight: checkedProgressWeight(bindValues[12]),
        priority: asString(bindValues[13]),
        horizon: asOptionalString(bindValues[14]), direction_id: asOptionalString(bindValues[15]),
      });
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("INSERT INTO ACTIONS")) {
      const record: ActionRecord = {
        progress_weight: checkedProgressWeight(bindValues[11] ?? 1),
        details_json: asString(bindValues[12] ?? "{}"),
        id: asString(bindValues[0]),
        title: asString(bindValues[1]),
        notes: asString(bindValues[2]),
        domain_id: asOptionalString(bindValues[3]),
        goal_id: asOptionalString(bindValues[4]),
        status: asActionStatus(bindValues[5]),
        scheduled_for: asOptionalString(bindValues[6]),
        sort_order: asNumber(bindValues[7]),
        completed_at: asOptionalString(bindValues[8]),
        created_at: asString(bindValues[9]),
        updated_at: asString(bindValues[10]),
      };
      this.actions.set(record.id, record);
      this.planChanges.push({
        id: this.planChanges.length + 1, action_id: record.id, before_date: null,
        after_date: record.scheduled_for, reason_code: "initial", note: "",
        changed_at: record.created_at, completed_at_at_change: record.completed_at,
        domain_id: record.domain_id, goal_id: record.goal_id,
      });
      this.stateEvents.push({
        id: this.stateEvents.length + 1, action_id: record.id,
        before_status: null, after_status: record.status,
        scheduled_for: record.scheduled_for, changed_at: record.created_at,
      });
      if (record.status === "completed" && record.completed_at) {
        this.completionPlans.set(record.id, {
          action_id: record.id, completed_at: record.completed_at,
          planned_date: record.scheduled_for,
        });
      }
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("DELETE FROM ACTION_DOMAIN_LINKS WHERE ACTION_ID = ?")) {
      const id = asString(bindValues[0]);
      const count = this.actionDomainLinks.get(id)?.size ?? 0;
      this.actionDomainLinks.delete(id);
      return { rowsAffected: count };
    }
    if (normalized.startsWith("INSERT INTO ACTION_DOMAIN_LINKS (ACTION_ID, DOMAIN_ID) VALUES")) {
      const actionId = asString(bindValues[0]);
      const domainId = asString(bindValues[1]);
      if (!this.actions.has(actionId) || !this.lifeDomains.has(domainId) ||
          this.actionDomainLinks.get(actionId)?.has(domainId)) throw new Error("Invalid action link.");
      const ids = this.actionDomainLinks.get(actionId) ?? new Set<string>();
      ids.add(domainId);
      this.actionDomainLinks.set(actionId, ids);
      return { rowsAffected: 1 };
    }

    if (normalized === "UPDATE ACTIONS SET PROGRESS_WEIGHT = ? WHERE ID = ?") {
      const row = this.actions.get(asString(bindValues[1]));
      const weight = asNumber(bindValues[0]);
      if (!Number.isFinite(weight) || weight <= 0 || weight > 100) throw new Error("Invalid progress weight.");
      if (!row) return { rowsAffected: 0 };
      this.actions.set(row.id, { ...row, progress_weight: weight });
      return { rowsAffected: 1 };
    }
    if (normalized === "UPDATE ACTIONS SET ID = ID WHERE ID = ?") {
      return { rowsAffected: this.actions.has(asString(bindValues[0])) ? 1 : 0 };
    }
    if (normalized === "UPDATE ACTIONS SET DETAILS_JSON = ?, UPDATED_AT = ? WHERE ID = ?") {
      const row = this.actions.get(asString(bindValues[2]));
      if (!row) return { rowsAffected: 0 };
      const details = asString(bindValues[0]);
      if (JSON.stringify(JSON.parse(row.details_json)) !== JSON.stringify(JSON.parse(details))) {
        const before = normalizeActionDetails(JSON.parse(row.details_json));
        const after = normalizeActionDetails(JSON.parse(details));
        if (JSON.stringify(before) !== JSON.stringify(after)) this.captureVersion("action", {
          id: row.id, title: row.title, status: row.status, scheduled_for: row.scheduled_for,
          completed_at: row.completed_at, details_json: row.details_json,
          created_at: row.created_at, updated_at: row.updated_at,
        }, asString(bindValues[1]));
      }
      this.actions.set(row.id, { ...row, details_json: details, updated_at: asString(bindValues[1]) });
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("UPDATE ACTION_PLAN_WRITES SET")) {
      const hasAdjustment = bindValues.length === 11;
      const id = asString(bindValues[hasAdjustment ? 10 : 8]);
      const existing = this.actions.get(id);
      if (!existing) return { rowsAffected: 0 };
      const after = asOptionalString(bindValues[5]);
      const reason = hasAdjustment ? bindValues[8] : "";
      const note = hasAdjustment ? asString(bindValues[9]) : "";
      if (existing.scheduled_for !== after &&
          (!["personal", "external", "conflict", "other"].includes(asString(reason)) ||
            note.length > 500)) {
        throw new Error("Schedule change requires a reason");
      }
      const updated: ActionRecord = {
        ...existing,
        title: asString(bindValues[0]), notes: asString(bindValues[1]),
        domain_id: asOptionalString(bindValues[2]), goal_id: asOptionalString(bindValues[3]),
        status: asActionStatus(bindValues[4]), scheduled_for: after,
        completed_at: asOptionalString(bindValues[6]), updated_at: asString(bindValues[7]),
      };
      if (updated.goal_id && !this.goals.has(updated.goal_id)) throw new Error("Missing goal.");
      if (updated.domain_id && !this.lifeDomains.has(updated.domain_id)) {
        throw new Error("Missing domain.");
      }
      this.actions.set(id, updated);
      this.recordCompletion(existing, updated);
      if (existing.status !== updated.status || existing.scheduled_for !== updated.scheduled_for) {
        this.stateEvents.push({
          id: this.stateEvents.length + 1, action_id: id,
          before_status: existing.status, after_status: updated.status,
          scheduled_for: updated.scheduled_for, changed_at: updated.updated_at,
        });
      }
      if (existing.scheduled_for !== after) {
        this.planChanges.push({
          id: this.planChanges.length + 1, action_id: id,
          before_date: existing.scheduled_for, after_date: after,
          reason_code: reason as PlanChangeRecord["reason_code"], note,
          changed_at: updated.updated_at, completed_at_at_change: updated.completed_at,
          domain_id: updated.domain_id, goal_id: updated.goal_id,
        });
      }
      return { rowsAffected: 1 };
    }

    if (/^(INSERT INTO|DELETE FROM) REVIEW_(GOAL|ISSUE)_LINKS/.test(normalized)) {
      const goal = normalized.includes("REVIEW_GOAL_LINKS");
      const links = goal ? this.reviewGoalLinks : this.reviewIssueLinks;
      const id = asString(bindValues[0]);
      if (normalized.startsWith("DELETE")) { const count = links.get(id)?.size ?? 0; links.delete(id); return { rowsAffected: count }; }
      const target = asString(bindValues[1]);
      if (!this.reviews.has(id) || !(goal ? this.goals : this.issues).has(target) || links.get(id)?.has(target)) throw new Error("Invalid review object link.");
      const ids = links.get(id) ?? new Set<string>();
      ids.add(target); links.set(id, ids);
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("INSERT INTO REVIEWS")) {
      const record: ReviewRecord = {
        id: asString(bindValues[0]),
        title: asString(bindValues[1]),
        reflection: asString(bindValues[2]),
        insight: asString(bindValues[3]),
        next_focus: asString(bindValues[4]),
        domain_id: asOptionalString(bindValues[5]),
        reviewed_on: asString(bindValues[6]),
        created_at: asString(bindValues[7]),
        updated_at: asString(bindValues[8]),
      };
      if (bindValues.length === 15) Object.assign(record, reviewMetadata(bindValues.slice(9, 15)));
      if (this.reviews.has(record.id)) throw new Error("Duplicate review id.");
      this.reviews.set(record.id, record);
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("DELETE FROM REVIEW_ANSWERS WHERE REVIEW_ID = ?")) {
      let count = 0;
      for (const [key, row] of this.reviewAnswers) {
        if (row.review_id === bindValues[0]) { this.reviewAnswers.delete(key); count++; }
      }
      return { rowsAffected: count };
    }
    if (normalized.startsWith("INSERT INTO REVIEW_ANSWERS (REVIEW_ID, FIELD_KEY, VALUE) VALUES")) {
      const [review_id, field_key, value] = bindValues.map(asString);
      const key = JSON.stringify([review_id, field_key]);
      if (!this.reviews.has(review_id) || this.reviewAnswers.has(key) ||
          field_key.length < 1 || field_key.length > 64 || value.length > 12000) {
        throw new Error("Invalid review answer.");
      }
      this.reviewAnswers.set(key, { review_id, field_key, value });
      return { rowsAffected: 1 };
    }
    if (normalized.startsWith("DELETE FROM REVIEW_DOMAIN_LINKS WHERE REVIEW_ID = ?")) {
      const id = asString(bindValues[0]);
      const count = this.reviewDomainLinks.get(id)?.size ?? 0;
      this.reviewDomainLinks.delete(id);
      return { rowsAffected: count };
    }
    if (normalized.startsWith("INSERT INTO REVIEW_DOMAIN_LINKS (REVIEW_ID, DOMAIN_ID) VALUES")) {
      const reviewId = asString(bindValues[0]);
      const domainId = asString(bindValues[1]);
      if (!this.reviews.has(reviewId) || !this.lifeDomains.has(domainId) ||
          this.reviewDomainLinks.get(reviewId)?.has(domainId)) throw new Error("Invalid review link.");
      const ids = this.reviewDomainLinks.get(reviewId) ?? new Set<string>();
      ids.add(domainId);
      this.reviewDomainLinks.set(reviewId, ids);
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("UPDATE REVIEWS SET")) {
      const id = asString(bindValues[bindValues.length - 1]);
      const existingRecord = this.reviews.get(id);

      if (!existingRecord) {
        return { rowsAffected: 0 };
      }

      this.captureVersion("review", { ...existingRecord,
        ...(existingRecord.review_type !== undefined ? { answers: [...this.reviewAnswers.values()]
          .filter(row => row.review_id === id).sort((a, b) => a.field_key.localeCompare(b.field_key))
          .map(({ field_key, value }) => ({ field_key, value })) } : {}),
        ...(this.appliedMigrations.has("0044-v1-review-object-links") ? {
          goal_ids: [...(this.reviewGoalLinks.get(id) ?? [])].sort(),
          issue_ids: [...(this.reviewIssueLinks.get(id) ?? [])].sort(),
        } : {}),
        domain_ids: [...(this.reviewDomainLinks.get(id) ?? [])],
      }, asString(bindValues[6]));
      this.reviews.set(id, {
        ...existingRecord,
        ...(bindValues.length === 14 ? reviewMetadata(bindValues.slice(7, 13)) : {}),
        title: asString(bindValues[0]),
        reflection: asString(bindValues[1]),
        insight: asString(bindValues[2]),
        next_focus: asString(bindValues[3]),
        domain_id: asOptionalString(bindValues[4]),
        reviewed_on: asString(bindValues[5]),
        updated_at: asString(bindValues[6]),
      });
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("INSERT INTO INBOX_ITEMS")) {
      const record: InboxRecord = {
        id: asString(bindValues[0]),
        content: asString(bindValues[1]),
        source: asInboxSource(bindValues[2]),
        status: asInboxStatus(bindValues[3]),
        target_type: asOptionalInboxTarget(bindValues[4]),
        target_id: asOptionalString(bindValues[5]),
        created_at: asString(bindValues[6]),
        updated_at: asString(bindValues[7]),
      };
      if (this.inboxItems.has(record.id)) {
        throw new Error("Duplicate inbox item id.");
      }
      this.inboxItems.set(record.id, record);
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("INSERT INTO ISSUE_WRITES")) {
      const record: IssueRecord = {
        id: asString(bindValues[0]),
        title: asString(bindValues[1]),
        description: asString(bindValues[2]),
        first_seen: asString(bindValues[3]),
        occurrence_count: asNumber(bindValues[4]),
        cause_hypothesis: asString(bindValues[5]),
        attempts: asString(bindValues[6]),
        follow_up: asString(bindValues[7]),
        status: asIssueStatus(bindValues[8]),
        goal_id: asOptionalString(bindValues[9]),
        created_at: asString(bindValues[10]),
        updated_at: asString(bindValues[11]),
      };
      const links = parseIssueLinks(bindValues[12], this.lifeDomains);
      if (this.issues.has(record.id)) throw new Error("Duplicate issue id.");
      if (record.goal_id && !this.goals.has(record.goal_id)) throw new Error("Missing goal.");
      this.issues.set(record.id, record);
      this.issueDomainLinks.set(record.id, links);
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("UPDATE ISSUE_WRITES SET")) {
      const id = asString(bindValues[11]);
      const existing = this.issues.get(id);
      if (!existing) return { rowsAffected: 0 };
      const links = parseIssueLinks(bindValues[10], this.lifeDomains);
      const goalId = asOptionalString(bindValues[8]);
      if (goalId && !this.goals.has(goalId)) throw new Error("Missing goal.");
      this.captureVersion("issue", { ...existing,
        domain_ids: [...(this.issueDomainLinks.get(id) ?? [])],
      }, asString(bindValues[9]));
      this.issues.set(id, {
        ...existing,
        title: asString(bindValues[0]),
        description: asString(bindValues[1]),
        first_seen: asString(bindValues[2]),
        occurrence_count: asNumber(bindValues[3]),
        cause_hypothesis: asString(bindValues[4]),
        attempts: asString(bindValues[5]),
        follow_up: asString(bindValues[6]),
        status: asIssueStatus(bindValues[7]),
        goal_id: goalId,
        updated_at: asString(bindValues[9]),
      });
      this.issueDomainLinks.set(id, links);
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("UPDATE ISSUES SET OCCURRENCE_COUNT = OCCURRENCE_COUNT + 1")) {
      const id = asString(bindValues[1]);
      const issue = this.issues.get(id);
      if (!issue || issue.occurrence_count >= 999999) return { rowsAffected: 0 };
      this.captureVersion("issue", { ...issue,
        domain_ids: [...(this.issueDomainLinks.get(id) ?? [])],
      }, asString(bindValues[0]));
      this.issues.set(id, { ...issue, occurrence_count: issue.occurrence_count + 1,
        status: "open", updated_at: asString(bindValues[0]) });
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("INSERT INTO DECISION_WRITES")) {
      const record = readDecision(bindValues);
      const resourceLinks = parseIssueLinks(bindValues[23] ?? "[]", this.resourceNeeds);
      const peopleLinks = parseIssueLinks(bindValues[22] ?? "[]", this.lifeRecords.people);
      const navigationLinks = parseIssueLinks(bindValues[21] ?? "[]", this.navigation);
      const links = parseIssueLinks(bindValues[20], this.lifeDomains);
      if (this.decisions.has(record.id)) throw new Error("Duplicate decision id.");
      if (record.goal_id && !this.goals.has(record.goal_id)) throw new Error("Missing goal.");
      this.decisions.set(record.id, record);
      this.decisionDomainLinks.set(record.id, links);
      this.decisionNavigationLinks.set(record.id, navigationLinks);
      this.decisionResourceNeedLinks.set(record.id, resourceLinks);
      this.decisionPersonLinks.set(record.id, peopleLinks);
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("UPDATE DECISION_WRITES SET")) {
      const id = asString(bindValues[22]);
      const previous = this.decisions.get(id);
      if (!previous) return { rowsAffected: 0 };
      const record = readDecision([id, ...bindValues.slice(0, 17),
        previous.created_at, bindValues[17]]);
      const links = parseIssueLinks(bindValues[18], this.lifeDomains);
      const navigationLinks = parseIssueLinks(bindValues[19], this.navigation);
      const resourceLinks = parseIssueLinks(bindValues[21], this.resourceNeeds);
      const peopleLinks = parseIssueLinks(bindValues[20], this.lifeRecords.people);
      if (previous.importance === "major" && record.importance === "ordinary") {
        throw new Error("Cannot downgrade a major decision.");
      }
      if (record.goal_id && !this.goals.has(record.goal_id)) throw new Error("Missing goal.");
      this.captureVersion("decision", { ...previous,
        resource_need_ids: [...(this.decisionResourceNeedLinks.get(id) ?? [])],
        person_ids: [...(this.decisionPersonLinks.get(id) ?? [])],
        navigation_ids: [...(this.decisionNavigationLinks.get(id) ?? [])],
        domain_ids: [...(this.decisionDomainLinks.get(id) ?? [])],
      }, record.updated_at);
      this.decisions.set(id, record);
      this.decisionDomainLinks.set(id, links);
      this.decisionNavigationLinks.set(id, navigationLinks);
      this.decisionResourceNeedLinks.set(id, resourceLinks);
      this.decisionPersonLinks.set(id, peopleLinks);
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("UPDATE INBOX_ITEMS SET STATUS = 'PROCESSING'")) {
      const id = asString(bindValues[3]);
      const record = this.inboxItems.get(id);
      if (!record || record.status !== "unprocessed") {
        return { rowsAffected: 0 };
      }
      this.inboxItems.set(id, {
        ...record, status: "processing", target_type: asInboxTarget(bindValues[0]),
        target_id: asString(bindValues[1]), updated_at: asString(bindValues[2]),
      });
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("UPDATE INBOX_ITEMS SET STATUS = 'ORGANIZED'")) {
      const id = asString(bindValues[1]);
      const record = this.inboxItems.get(id);
      if (!record || record.status !== "processing" ||
          record.target_type !== asInboxTarget(bindValues[2]) ||
          record.target_id !== asString(bindValues[3])) {
        return { rowsAffected: 0 };
      }
      this.inboxItems.set(id, { ...record, status: "organized", updated_at: asString(bindValues[0]) });
      return { rowsAffected: 1 };
    }

    if (normalized.startsWith("UPDATE INBOX_ITEMS SET STATUS = ?")) {
      const id = asString(bindValues[2]);
      const record = this.inboxItems.get(id);
      if (!record || record.status !== asInboxStatus(bindValues[3])) {
        return { rowsAffected: 0 };
      }
      this.inboxItems.set(id, {
        ...record, status: asInboxStatus(bindValues[0]), updated_at: asString(bindValues[1]),
      });
      return { rowsAffected: 1 };
    }

    throw new Error(`Memory executor does not support execute statement: ${statement}`);
  }

  private recordCompletion(previous: ActionRecord, current: ActionRecord): void {
    if (previous.status !== "completed" && current.status === "completed" && current.completed_at) {
      this.completionPlans.set(current.id, {
        action_id: current.id, completed_at: current.completed_at,
        planned_date: current.scheduled_for,
      });
    }
  }

  private assertGoalDirection(record: { horizon: unknown; direction_id: unknown }): void {
    if (record.horizon !== null && !["annual", "quarter", "stage", "month"].includes(String(record.horizon))) {
      throw new Error("目标周期无效。");
    }
    if (record.direction_id !== null && !this.navigation.has(String(record.direction_id))) {
      throw new Error("关联的长期方向不存在。");
    }
  }

  private relationSnapshot(goalId: string) {
    return [...this.goalRelations.values()].filter((row) => row.goal_id === goalId)
      .sort((a, b) => a.target_goal_id.localeCompare(b.target_goal_id) || a.relation_type.localeCompare(b.relation_type))
      .map(({ target_goal_id, relation_type }) => ({ target_goal_id, relation_type }));
  }

  private habitSnapshot(goalId: string) {
    return [...this.goalHabitProgress.values()].filter((row) => row.goal_id === goalId)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ habit_id, start_on, end_on, weekly_target, weight, sort_order }) => ({
        habit_id, start_on, end_on, weekly_target, weight, sort_order,
      }));
  }

  private progressSnapshot(goalId: string) {
    return [...this.goalProgressItems.values()]
      .filter((item) => item.goal_id === goalId)
      .map(({ id, kind, title, target_value, current_value, weight, sort_order }) => ({
        id, kind, title, target_value, current_value, weight, sort_order,
      }));
  }

  private captureVersion<T extends { id: string }>(type: string, record: T, changedAt: string): void {
    this.objectVersions.push({
      id: this.objectVersions.length + 1, object_type: type,
      object_id: record.id, changed_at: changedAt,
      snapshot_json: JSON.stringify(record),
    });
  }

  private recordsForPrivacy(table: string): ReadonlyMap<string, unknown> {
    switch (table) {
      case "RESOURCE_NEEDS": return this.resourceNeeds;
      case "LIFE_NAVIGATION": return this.navigation;
      case "LIFE_DOMAINS": return this.lifeDomains;
      case "GOALS": return this.goals;
      case "ACTIONS": return this.actions;
      case "REVIEWS": return this.reviews;
      case "INBOX_ITEMS": return this.inboxItems;
      case "ISSUES": return this.issues;
      case "DECISIONS": return this.decisions;
      case "METRIC_DEFINITIONS": return this.metricDefinitions;
      case "HABITS": return this.habits;
      case "PEOPLE": return this.lifeRecords.people;
      case "LIFE_EVENTS": return this.lifeRecords.life_events;
      case "SKILLS": return this.lifeRecords.skills;
      default: throw new Error("Unknown privacy table.");
    }
  }
}

function copyLinks(map: Map<string, Set<string>>): Map<string, Set<string>> {
  return new Map([...map].map(([id, ids]) => [id, new Set(ids)]));
}

function reviewMetadata(values: readonly unknown[]) {
  const columns = ["review_type", "period_start", "period_end", "review_status", "review_mode", "template_snapshot"];
  if (values.length !== 6) throw new Error("Invalid review metadata.");
  if (!values.every(value => value === null)) {
    if (values.some(value => typeof value !== "string")) throw new Error("Incomplete review metadata.");
    normalizeReviewStructure({ type: values[0], start: values[1], end: values[2],
      status: values[3], mode: values[4], template: JSON.parse(String(values[5])), answers: {} });
  }
  return Object.fromEntries(columns.map((column, index) => [column, values[index] as string | null]));
}

function normalize(statement: string): string {
  return statement.replace(/\s+/g, " ").trim().toUpperCase();
}

function asString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Memory executor expected a string bind value.");
  }

  return value;
}

function asNumber(value: unknown): number {
  if (typeof value !== "number") {
    throw new Error("Memory executor expected a number bind value.");
  }

  return value;
}

function asOptionalString(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  return asString(value);
}

function asGoalStatus(value: unknown): GoalRecord["status"] {
  if (value === "active" || value === "paused" || value === "completed") {
    return value;
  }

  throw new Error("Memory executor expected a goal status.");
}

function asDomainStatus(value: unknown): LifeDomainRecord["status"] {
  if (value === "active" || value === "paused" || value === "archived") return value;
  throw new Error("Memory executor expected a domain status.");
}

function asActionStatus(value: unknown): ActionRecord["status"] {
  if (value === "open" || value === "completed") {
    return value;
  }

  throw new Error("Memory executor expected an action status.");
}

function asInboxSource(value: unknown): InboxRecord["source"] {
  if (value === "inbox" || value === "quick-capture") return value;
  throw new Error("Memory executor expected an inbox source.");
}

function asInboxStatus(value: unknown): InboxRecord["status"] {
  if (value === "unprocessed" || value === "processing" ||
      value === "organized" || value === "archived") return value;
  throw new Error("Memory executor expected an inbox status.");
}

function asInboxTarget(value: unknown): NonNullable<InboxRecord["target_type"]> {
  if (value === "goal" || value === "action" || value === "review" ||
      value === "issue" || value === "decision" || value === "event" || value === "person") return value;
  throw new Error("Memory executor expected an inbox target.");
}

function asIssueStatus(value: unknown): IssueRecord["status"] {
  if (value === "open" || value === "watching" || value === "resolved") return value;
  throw new Error("Memory executor expected an issue status.");
}

function parseIssueLinks(value: unknown, domains: ReadonlyMap<string, unknown>): Set<string> {
  const ids: unknown = JSON.parse(asString(value));
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !domains.has(id))) {
    throw new Error("Missing issue domain.");
  }
  return new Set(ids as string[]);
}

function readDecision(values: unknown[]): DecisionRecord {
  const importance = values[3];
  const status = values[4];
  const reversibility = values[11];
  if (importance !== "ordinary" && importance !== "major") throw new Error("Invalid importance.");
  if (status !== "considering" && status !== "decided") throw new Error("Invalid decision status.");
  if (reversibility !== "unknown" && reversibility !== "reversible" &&
      reversibility !== "difficult") throw new Error("Invalid reversibility.");
  const choice = asString(values[12]);
  if (status === "decided" && !choice.trim()) throw new Error("Missing decision choice.");
  return {
    id: asString(values[0]), title: asString(values[1]), decided_on: asString(values[2]),
    importance, status, background: asString(values[5]), options: asString(values[6]),
    constraints_text: asString(values[7]), criteria: asString(values[8]),
    risks: asString(values[9]), opportunity_cost: asString(values[10]),
    reversibility, choice, rationale: asString(values[13]),
    execution_conditions: asString(values[14]), outcome: asString(values[15]),
    reflection: asString(values[16]), goal_id: asOptionalString(values[17]),
    created_at: asString(values[18]), updated_at: asString(values[19]),
  };
}

function asOptionalInboxTarget(value: unknown): InboxRecord["target_type"] {
  return value === null ? null : asInboxTarget(value);
}

function checkedProgressWeight(value: unknown): number {
  const weight = asNumber(value);
  if (!Number.isFinite(weight) || weight <= 0 || weight > 100) throw new Error("Invalid progress weight.");
  return weight;
}

function goalStatusRank(status: string): number {
  return ["active", "candidate", "paused", "completed", "abandoned", "archived"].indexOf(status);
}

function actionStatusRank(status: ActionRecord["status"]): number {
  return status === "open" ? 0 : 1;
}

function compareActionRecords(left: ActionRecord, right: ActionRecord): number {
  const statusDifference = actionStatusRank(left.status) - actionStatusRank(right.status);

  if (statusDifference) {
    return statusDifference;
  }

  const scheduleDifference = Number(!left.scheduled_for) - Number(!right.scheduled_for);

  if (scheduleDifference) {
    return scheduleDifference;
  }

  return (
    (left.scheduled_for ?? "").localeCompare(right.scheduled_for ?? "") ||
    left.sort_order - right.sort_order ||
    left.created_at.localeCompare(right.created_at)
  );
}
