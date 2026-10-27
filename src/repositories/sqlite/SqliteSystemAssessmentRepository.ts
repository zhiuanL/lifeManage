import type { SystemAssessment } from "../../domain/assessments/SystemAssessment";
import type { SystemAssessmentRepository } from "../assessments/SystemAssessmentRepository";
import type { SqliteExecutor } from "./SqliteExecutor";

type Row = {
  id: string; period_kind: SystemAssessment["periodKind"]; period_start: string;
  clarity: string; alignment: string; reviews: string; decisions: string; early_issues: string;
  adjustment: string; created_at: string; updated_at: string;
};

export class SqliteSystemAssessmentRepository implements SystemAssessmentRepository {
  constructor(private readonly db: SqliteExecutor) {}

  async list(): Promise<readonly SystemAssessment[]> {
    const rows = await this.db.select<Row>(
      "SELECT * FROM system_assessments ORDER BY period_start DESC, period_kind, id DESC",
    );
    return rows.map(row => ({
      id: row.id, periodKind: row.period_kind, periodStart: row.period_start,
      clarity: row.clarity, alignment: row.alignment, reviews: row.reviews,
      decisions: row.decisions, earlyIssues: row.early_issues, adjustment: row.adjustment,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }));
  }

  async save(assessment: SystemAssessment, create: boolean): Promise<boolean> {
    const fields = [assessment.clarity, assessment.alignment, assessment.reviews,
      assessment.decisions, assessment.earlyIssues, assessment.adjustment];
    const result = create
      ? await this.db.execute(`INSERT INTO system_assessments
          (id, period_kind, period_start, clarity, alignment, reviews, decisions,
           early_issues, adjustment, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [assessment.id, assessment.periodKind, assessment.periodStart, ...fields,
          assessment.createdAt, assessment.updatedAt])
      : await this.db.execute(`UPDATE system_assessments SET clarity = ?, alignment = ?,
          reviews = ?, decisions = ?, early_issues = ?, adjustment = ?, updated_at = ?
          WHERE id = ?`, [...fields, assessment.updatedAt, assessment.id]);
    return result.rowsAffected === 1;
  }
}
