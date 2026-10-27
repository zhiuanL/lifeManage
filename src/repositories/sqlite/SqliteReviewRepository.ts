import type { Review } from "../../domain/reviews/Review";
import type { ReviewRepository } from "../reviews/ReviewRepository";
import { decodeReviewStructure, encodeReviewStructure, type ReviewAnswerRow, type ReviewStructureColumns } from "../reviews/ReviewStructureStorage";
import type { SqliteExecutor } from "./SqliteExecutor";

interface ReviewRow extends Partial<ReviewStructureColumns> {
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

const selectedColumns = `id, title, reflection, insight, next_focus, domain_id,
  reviewed_on, created_at, updated_at`;

export class SqliteReviewRepository implements ReviewRepository {
  // Enable only alongside migration 0043 and its backup contract.
  constructor(private readonly executor: SqliteExecutor, private readonly structuredReviews = false, private readonly objectLinks = false) {}

  private columns(): string {
    return selectedColumns + (this.structuredReviews ? ", review_type, period_start, period_end, review_status, review_mode, template_snapshot" : "");
  }

  private storage(review: Review) {
    if (!this.structuredReviews && review.structure != null) throw new Error("结构化复盘存储尚未启用。");
    if (!this.objectLinks && ((review.goalIds?.length ?? 0) || (review.issueIds?.length ?? 0))) throw new Error("复盘对象关联存储尚未启用。");
    return encodeReviewStructure(review.id, review.structure ?? null);
  }

  async list(): Promise<readonly Review[]> {
    const [rows, links, answers] = await Promise.all([this.executor.select<ReviewRow>(
      `SELECT ${this.columns()}
       FROM reviews
       ORDER BY reviewed_on DESC, created_at DESC`,
    ), this.executor.select<{ review_id: string; domain_id: string }>(
      "SELECT review_id, domain_id FROM review_domain_links ORDER BY review_id, domain_id",
    ), this.structuredReviews ? this.executor.select<ReviewAnswerRow>(
      "SELECT review_id, field_key, value FROM review_answers ORDER BY review_id, field_key",
    ) : Promise.resolve([])]);

    const byReview = new Map<string, string[]>();
    for (const link of links) {
      const ids = byReview.get(link.review_id) ?? [];
      ids.push(link.domain_id);
      byReview.set(link.review_id, ids);
    }
    const byAnswer = new Map<string, ReviewAnswerRow[]>();
    for (const answer of answers) {
      const group = byAnswer.get(answer.review_id) ?? [];
      group.push(answer);
      byAnswer.set(answer.review_id, group);
    }
    const objects = await this.readObjectLinks();
    return rows.map((row) => ({ ...toReview(row, byReview.get(row.id) ?? [], byAnswer.get(row.id) ?? []),
      ...(this.objectLinks ? { goalIds: objects.goals.filter(link => link.review_id === row.id).map(link => link.goal_id),
        issueIds: objects.issues.filter(link => link.review_id === row.id).map(link => link.issue_id) } : {}),
    }));
  }

  async findById(id: string): Promise<Review | null> {
    const rows = await this.executor.select<ReviewRow>(
      `SELECT ${this.columns()}
       FROM reviews
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    if (!rows[0]) return null;
    const links = await this.executor.select<{ domain_id: string }>(
      "SELECT domain_id FROM review_domain_links WHERE review_id = ? ORDER BY domain_id", [id],
    );
    const answers = this.structuredReviews ? await this.executor.select<ReviewAnswerRow>(
      "SELECT review_id, field_key, value FROM review_answers WHERE review_id = ? ORDER BY field_key", [id],
    ) : [];
    const objects = await this.readObjectLinks(id);
    return { ...toReview(rows[0], links.map((link) => link.domain_id), answers),
      ...(this.objectLinks ? { goalIds: objects.goals.map(link => link.goal_id), issueIds: objects.issues.map(link => link.issue_id) } : {}),
    };
  }

  private async readObjectLinks(id?: string) {
    const where = id ? " WHERE review_id = ?" : "";
    const values = id ? [id] : [];
    const [goals, issues] = this.objectLinks ? await Promise.all([
      this.executor.select<{ review_id: string; goal_id: string }>(`SELECT review_id, goal_id FROM review_goal_links${where} ORDER BY review_id, goal_id`, values),
      this.executor.select<{ review_id: string; issue_id: string }>(`SELECT review_id, issue_id FROM review_issue_links${where} ORDER BY review_id, issue_id`, values),
    ]) : [[], []];
    return { goals, issues };
  }

  private objectLinkStatements(review: Review) {
    if (!this.objectLinks) return [];
    return (["goal", "issue"] as const).flatMap(type => {
      const ids = type === "goal" ? review.goalIds : review.issueIds;
      if (ids === undefined) return [];
      return [
        { statement: `DELETE FROM review_${type}_links WHERE review_id = ?`, bindValues: [review.id] },
        ...ids.map(id => ({ statement: `INSERT INTO review_${type}_links (review_id, ${type}_id) VALUES (?, ?)`, bindValues: [review.id, id] })),
      ];
    });
  }

  async create(review: Review): Promise<void> {
    const storage = this.storage(review);
    await this.executor.executeTransaction([
      { statement: `INSERT INTO reviews (
        id, title, reflection, insight, next_focus, domain_id, reviewed_on,
        created_at, updated_at${this.structuredReviews ? ", review_type, period_start, period_end, review_status, review_mode, template_snapshot" : ""}
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?${this.structuredReviews ? ", ?, ?, ?, ?, ?, ?" : ""})`, bindValues: [
        review.id,
        review.title,
        review.reflection,
        review.insight,
        review.nextFocus,
        review.domainId,
        review.reviewedOn,
        review.createdAt,
        review.updatedAt,
        ...(this.structuredReviews ? Object.values(storage.columns) : []),
      ] },
      ...storage.answers.map(answer => ({
        statement: "INSERT INTO review_answers (review_id, field_key, value) VALUES (?, ?, ?)",
        bindValues: [answer.review_id, answer.field_key, answer.value],
      })),
      ...this.objectLinkStatements(review),
      ...review.domainIds.map((domainId) => ({
        statement: "INSERT INTO review_domain_links (review_id, domain_id) VALUES (?, ?)",
        bindValues: [review.id, domainId],
      })),
    ]);
  }

  async update(review: Review): Promise<void> {
    const storage = this.storage(review);
    const result = await this.executor.executeTransaction([
      { statement: `UPDATE reviews
       SET title = ?, reflection = ?, insight = ?, next_focus = ?, domain_id = ?,
           reviewed_on = ?, updated_at = ?${this.structuredReviews ? ", review_type = ?, period_start = ?, period_end = ?, review_status = ?, review_mode = ?, template_snapshot = ?" : ""}
       WHERE id = ?`, bindValues: [
        review.title,
        review.reflection,
        review.insight,
        review.nextFocus,
        review.domainId,
        review.reviewedOn,
        review.updatedAt,
        ...(this.structuredReviews ? Object.values(storage.columns) : []),
        review.id,
      ], requireAffectedRows: true },
      ...(this.structuredReviews ? [{ statement: "DELETE FROM review_answers WHERE review_id = ?", bindValues: [review.id] }] : []),
      ...storage.answers.map(answer => ({
        statement: "INSERT INTO review_answers (review_id, field_key, value) VALUES (?, ?, ?)",
        bindValues: [answer.review_id, answer.field_key, answer.value],
      })),
      { statement: "DELETE FROM review_domain_links WHERE review_id = ?", bindValues: [review.id] },
      ...this.objectLinkStatements(review),
      ...review.domainIds.map((domainId) => ({
        statement: "INSERT INTO review_domain_links (review_id, domain_id) VALUES (?, ?)",
        bindValues: [review.id, domainId],
      })),
    ]);
    if (!result) throw new Error("回顾已不存在，请重新读取后再试。");
  }
}

function toReview(row: ReviewRow, linkedIds: readonly string[], answers: readonly ReviewAnswerRow[]): Review {
  const domainIds = row.domain_id
    ? [row.domain_id, ...linkedIds.filter((id) => id !== row.domain_id)]
    : [...linkedIds];
  return {
    id: row.id,
    title: row.title,
    reflection: row.reflection,
    insight: row.insight,
    nextFocus: row.next_focus,
    domainId: domainIds[0] ?? null,
    domainIds,
    reviewedOn: row.reviewed_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.review_type !== undefined ? { structure: decodeReviewStructure(row.id, row as ReviewStructureColumns, answers) } : {}),
  };
}
