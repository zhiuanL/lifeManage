import type { Issue, IssueStatus } from "../../domain/issues/Issue";
import type { IssueRepository } from "../issues/IssueRepository";
import type { SqliteExecutor } from "./SqliteExecutor";

interface IssueRow {
  id: string;
  title: string;
  description: string;
  first_seen: string;
  occurrence_count: number;
  cause_hypothesis: string;
  attempts: string;
  follow_up: string;
  status: IssueStatus;
  goal_id: string | null;
  created_at: string;
  updated_at: string;
}

interface IssueDomainRow { issue_id: string; domain_id: string }

const columns = `id, title, description, first_seen, occurrence_count,
  cause_hypothesis, attempts, follow_up, status, goal_id, created_at, updated_at`;

export class SqliteIssueRepository implements IssueRepository {
  constructor(private readonly executor: SqliteExecutor) {}

  async list(): Promise<readonly Issue[]> {
    const [rows, links] = await Promise.all([
      this.executor.select<IssueRow>(
        `SELECT ${columns} FROM issues ORDER BY first_seen DESC, created_at DESC, id DESC`,
      ),
      this.executor.select<IssueDomainRow>("SELECT issue_id, domain_id FROM issue_domain_links ORDER BY domain_id"),
    ]);
    return rows.map((row) => toIssue(row, links.filter((link) => link.issue_id === row.id)
      .map((link) => link.domain_id)));
  }

  async findById(id: string): Promise<Issue | null> {
    const rows = await this.executor.select<IssueRow>(
      `SELECT ${columns} FROM issues WHERE id = ? LIMIT 1`, [id],
    );
    if (!rows[0]) return null;
    const links = await this.executor.select<IssueDomainRow>(
      "SELECT issue_id, domain_id FROM issue_domain_links WHERE issue_id = ? ORDER BY domain_id", [id],
    );
    return toIssue(rows[0], links.map((link) => link.domain_id));
  }

  async create(issue: Issue): Promise<void> {
    await this.executor.execute(
      `INSERT INTO issue_writes (${columns}, domain_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      toBindValues(issue),
    );
  }

  async update(issue: Issue): Promise<void> {
    await this.executor.execute(
      `UPDATE issue_writes SET title = ?, description = ?, first_seen = ?,
       occurrence_count = ?, cause_hypothesis = ?, attempts = ?, follow_up = ?,
       status = ?, goal_id = ?, updated_at = ?, domain_ids_json = ? WHERE id = ?`,
      [issue.title, issue.description, issue.firstSeen, issue.occurrenceCount,
        issue.causeHypothesis, issue.attempts, issue.followUp, issue.status,
        issue.goalId, issue.updatedAt, JSON.stringify(issue.domainIds), issue.id],
    );
  }

  async recordRecurrence(id: string, updatedAt: string): Promise<boolean> {
    const result = await this.executor.execute(
      `UPDATE issues SET occurrence_count = occurrence_count + 1,
       status = 'open', updated_at = ?
       WHERE id = ? AND occurrence_count < 999999`,
      [updatedAt, id],
    );
    return result.rowsAffected === 1;
  }
}

function toBindValues(issue: Issue): unknown[] {
  return [issue.id, issue.title, issue.description, issue.firstSeen, issue.occurrenceCount,
    issue.causeHypothesis, issue.attempts, issue.followUp, issue.status, issue.goalId,
    issue.createdAt, issue.updatedAt, JSON.stringify(issue.domainIds)];
}

function toIssue(row: IssueRow, domainIds: string[]): Issue {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    firstSeen: row.first_seen,
    occurrenceCount: row.occurrence_count,
    causeHypothesis: row.cause_hypothesis,
    attempts: row.attempts,
    followUp: row.follow_up,
    status: row.status,
    goalId: row.goal_id,
    domainIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
