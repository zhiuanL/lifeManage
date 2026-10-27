import { buildReviewFactDraft, type ReviewFactDraft } from "../../domain/reviews/ReviewFactDraft";
import type { ReviewPeriod } from "../../domain/reviews/ReviewStructure";
import type { ReviewService } from "./ReviewService";
import type { GoalService } from "../planning/GoalService";
import type { ActionService } from "../planning/ActionService";
import type { GoalProgressItemService } from "../planning/GoalProgressItemService";
import type { IssueService } from "../issues/IssueService";
import type { DomainMetricService } from "../life/DomainMetricService";
import type { HabitService } from "../habits/HabitService";
import type { Clock } from "../../shared/clock";

import type { LifeRecordsService } from "../records/LifeRecordsService";
import type { DecisionService } from "../decisions/DecisionService";
import type { LifeNavigationService } from "../life/LifeNavigationService";
import type { ResourceNeedRepository } from "../../repositories/resources/ResourceNeedRepository";

export class ReviewFactService {
  constructor(
    private readonly reviews: ReviewService, private readonly goals: GoalService,
    private readonly actions: ActionService, private readonly items: GoalProgressItemService,
    private readonly issues: IssueService, private readonly metrics: DomainMetricService,
    private readonly habits: HabitService, private readonly clock: Clock,
    private readonly lifeRecords?: LifeRecordsService, private readonly decisions?: DecisionService,
    private readonly navigation?: LifeNavigationService, private readonly needs?: ResourceNeedRepository,
  ) {}
  async generate(period: ReviewPeriod, domainIds: readonly string[], excludeReviewId?: string): Promise<ReviewFactDraft> {
    const [reviews, goals, actions, items, issues, metrics, records, habits, logs, changes] = await Promise.all([
      this.reviews.list(), this.goals.list(), this.actions.list(), this.items.list(), this.issues.list(),
      this.metrics.listDefinitions(), this.metrics.listRecords(), this.habits.list(), this.habits.listLogs(), this.actions.listPlanChanges(),
    ]);
    const strategic = period.type === "quarterly" || period.type === "annual";
    const [events, skills, decisions, navigation, needs] = strategic ? await Promise.all([
      period.type === "annual" ? this.lifeRecords?.listEvents() ?? [] : [],
      period.type === "annual" ? this.lifeRecords?.listSkills() ?? [] : [],
      this.decisions?.list() ?? [], this.navigation?.list() ?? [],
      period.type === "quarterly" ? this.needs?.list() ?? [] : [],
    ]) : [[], [], [], [], []];
    const now = this.clock.now();
    const observedOn = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
    return buildReviewFactDraft(period, { reviews, goals, actions, items, issues, metrics, records, habits, logs, changes, observedOn, events, skills, decisions, navigation, needs }, domainIds, excludeReviewId);
  }
}
