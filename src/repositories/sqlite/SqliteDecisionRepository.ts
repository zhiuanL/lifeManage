import type { Decision, DecisionDraft, DecisionStatus, DecisionImportance, DecisionReversibility } from "../../domain/decisions/Decision";
import type { DecisionRepository } from "../decisions/DecisionRepository";
import type { SqliteExecutor } from "./SqliteExecutor";

interface DecisionRow {
  id: string;
  title: string;
  decided_on: string;
  importance: DecisionImportance;
  status: DecisionStatus;
  background: string;
  options: string;
  constraints_text: string;
  criteria: string;
  risks: string;
  opportunity_cost: string;
  reversibility: DecisionReversibility;
  choice: string;
  rationale: string;
  execution_conditions: string;
  outcome: string;
  reflection: string;
  goal_id: string | null;
  created_at: string;
  updated_at: string;
}

const columns = `id, title, decided_on, importance, status, background, options,
  constraints_text, criteria, risks, opportunity_cost, reversibility, choice, rationale,
  execution_conditions, outcome, reflection, goal_id, created_at, updated_at`;

export class SqliteDecisionRepository implements DecisionRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async list(): Promise<readonly Decision[]> {
    const [rows, links, navigation, people, resources] = await Promise.all([
      this.executor.select<DecisionRow>(
        `SELECT ${columns} FROM decisions ORDER BY decided_on DESC, created_at DESC, id DESC`,
      ),
      this.executor.select<{ decision_id: string; domain_id: string }>(
        "SELECT decision_id, domain_id FROM decision_domain_links ORDER BY domain_id",
      ),
      this.executor.select<{ decision_id: string; navigation_id: string }>(
        "SELECT decision_id, navigation_id FROM decision_navigation_links ORDER BY navigation_id",
      ),
      this.executor.select<{ decision_id: string; person_id: string }>(
        "SELECT decision_id, person_id FROM decision_person_links ORDER BY person_id",
      ),
      this.executor.select<{ decision_id: string; resource_need_id: string }>(
        "SELECT decision_id, resource_need_id FROM decision_resource_need_links ORDER BY resource_need_id",
      ),
    ]);
    return rows.map((row) => toDecision(row,
      links.filter((link) => link.decision_id === row.id).map((link) => link.domain_id),
      navigation.filter((link) => link.decision_id === row.id).map((link) => link.navigation_id),
      people.filter((link) => link.decision_id === row.id).map((link) => link.person_id),
      resources.filter((link) => link.decision_id === row.id).map((link) => link.resource_need_id)));
  }

  async findById(id: string): Promise<Decision | null> {
    const rows = await this.executor.select<DecisionRow>(
      `SELECT ${columns} FROM decisions WHERE id = ? LIMIT 1`, [id],
    );
    if (!rows[0]) return null;
    const links = await this.executor.select<{ domain_id: string }>(
      "SELECT domain_id FROM decision_domain_links WHERE decision_id = ? ORDER BY domain_id", [id],
    );
    const navigation = await this.executor.select<{ navigation_id: string }>(
      "SELECT navigation_id FROM decision_navigation_links WHERE decision_id = ? ORDER BY navigation_id", [id],
    );
    const people = await this.executor.select<{ person_id: string }>(
      "SELECT person_id FROM decision_person_links WHERE decision_id = ? ORDER BY person_id", [id],
    );
    const resources = await this.executor.select<{ resource_need_id: string }>(
      "SELECT resource_need_id FROM decision_resource_need_links WHERE decision_id = ? ORDER BY resource_need_id", [id],
    );
    return toDecision(rows[0], links.map((link) => link.domain_id), navigation.map((link) => link.navigation_id), people.map((link) => link.person_id), resources.map((link) => link.resource_need_id));
  }

  async create(decision: Decision): Promise<void> {
    await this.executor.execute(`INSERT INTO decision_writes (${columns}, domain_ids_json, navigation_ids_json, person_ids_json, resource_need_ids_json)
      VALUES (${Array.from({ length: 24 }, () => "?").join(", ")})`, bindValues(decision));
  }

  async update(decision: Decision): Promise<void> {
    await this.executor.execute(`UPDATE decision_writes SET
      title = ?, decided_on = ?, importance = ?, status = ?, background = ?, options = ?,
      constraints_text = ?, criteria = ?, risks = ?, opportunity_cost = ?, reversibility = ?,
      choice = ?, rationale = ?, execution_conditions = ?, outcome = ?, reflection = ?,
      goal_id = ?, updated_at = ?, domain_ids_json = ?, navigation_ids_json = ?, person_ids_json = ?, resource_need_ids_json = ? WHERE id = ?`,
    [...bindValues(decision).slice(1, 18), decision.updatedAt,
      JSON.stringify(decision.domainIds), JSON.stringify(decision.navigationIds ?? []), JSON.stringify(decision.personIds ?? []), JSON.stringify(decision.resourceNeedIds ?? []), decision.id]);
  }
}

function bindValues(d: Decision): unknown[] {
  return [d.id, d.title, d.decidedOn, d.importance, d.status, d.background, d.options,
    d.constraints, d.criteria, d.risks, d.opportunityCost, d.reversibility, d.choice,
    d.rationale, d.executionConditions, d.outcome, d.reflection, d.goalId, d.createdAt,
    d.updatedAt, JSON.stringify(d.domainIds), JSON.stringify(d.navigationIds ?? []), JSON.stringify(d.personIds ?? []), JSON.stringify(d.resourceNeedIds ?? [])];
}

function toDecision(row: DecisionRow, domainIds: string[], navigationIds: string[], personIds: string[], resourceNeedIds: string[]): Decision {
  const draft: DecisionDraft = {
    title: row.title, decidedOn: row.decided_on, importance: row.importance, status: row.status,
    background: row.background, options: row.options, constraints: row.constraints_text,
    criteria: row.criteria, risks: row.risks, opportunityCost: row.opportunity_cost,
    reversibility: row.reversibility, choice: row.choice, rationale: row.rationale,
    executionConditions: row.execution_conditions, outcome: row.outcome,
    reflection: row.reflection, goalId: row.goal_id, domainIds, navigationIds, personIds, resourceNeedIds,
  };
  return { ...draft, id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
}
