import {
  normalizeReviewDraft,
  ReviewValidationError,
  type Review,
  type ReviewDraft,
} from "../../domain/reviews/Review";
import type { LifeDomainRepository } from "../../repositories/life/LifeDomainRepository";
import type { ReviewRepository } from "../../repositories/reviews/ReviewRepository";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";

import type { GoalRepository } from "../../repositories/planning/GoalRepository";
import type { IssueRepository } from "../../repositories/issues/IssueRepository";

export class ReviewService {
  constructor(
    private readonly repository: ReviewRepository,
    private readonly lifeDomainRepository: LifeDomainRepository,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly goalRepository?: GoalRepository,
    private readonly issueRepository?: IssueRepository,
  ) {}

  list(): Promise<readonly Review[]> {
    return this.repository.list();
  }

  findById(id: string): Promise<Review | null> {
    return this.repository.findById(id);
  }

  async create(draft: ReviewDraft): Promise<Review> {
    return this.createWithId(this.idGenerator.next(), draft);
  }

  async createWithId(id: string, draft: ReviewDraft): Promise<Review> {
    const normalizedDraft = normalizeReviewDraft(draft);
    await this.assertDomainsExist(normalizedDraft.domainIds);
    await this.assertObjectsExist(normalizedDraft);
    const timestamp = this.clock.now().toISOString();
    const review: Review = {
      id,
      ...normalizedDraft,
      ...(this.goalRepository ? { goalIds: normalizedDraft.goalIds ?? [] } : {}),
      ...(this.issueRepository ? { issueIds: normalizedDraft.issueIds ?? [] } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.create(review);
    return review;
  }

  async update(id: string, draft: ReviewDraft): Promise<Review> {
    const existingReview = await this.repository.findById(id);

    if (!existingReview) {
      throw new ReviewValidationError("这次回顾已经不在这里了。");
    }

    const normalizedDraft = normalizeReviewDraft(draft);
    await this.assertDomainsExist(normalizedDraft.domainIds);
    await this.assertObjectsExist(normalizedDraft);
    const review: Review = {
      ...existingReview,
      ...normalizedDraft,
      updatedAt: this.clock.now().toISOString(),
    };

    await this.repository.update(review);
    return review;
  }

  private async assertObjectsExist(draft: ReviewDraft): Promise<void> {
    for (const id of draft.goalIds ?? []) {
      if (!this.goalRepository || !(await this.goalRepository.findById(id))) {
        throw new ReviewValidationError("关联的目标已不存在，请重新选择。");
      }
    }
    for (const id of draft.issueIds ?? []) {
      if (!this.issueRepository || !(await this.issueRepository.findById(id))) {
        throw new ReviewValidationError("关联的问题已不存在，请重新选择。");
      }
    }
  }

  private async assertDomainsExist(domainIds: readonly string[]): Promise<void> {
    for (const domainId of domainIds) {
      if (!(await this.lifeDomainRepository.findById(domainId))) {
        throw new ReviewValidationError("关联的生活领域已经不存在了。");
      }
    }
  }
}
