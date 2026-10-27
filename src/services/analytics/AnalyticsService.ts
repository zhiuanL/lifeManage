import { buildAnalytics, type AnalyticsData, type AnalyticsFilter, type AnalyticsSnapshot } from "../../domain/analytics/Analytics";
import { buildAnalyticsComparison, type DomainAnalyticsComparison } from "../../domain/analytics/AnalyticsComparison";
import type { Clock } from "../../shared/clock";
import type { IssueService } from "../issues/IssueService";
import type { ActionService } from "../planning/ActionService";
import type { GoalService } from "../planning/GoalService";
import type { ReviewService } from "../reviews/ReviewService";
import type { HabitService } from "../habits/HabitService";

export class AnalyticsService {
  constructor(
    private readonly goals: GoalService,
    private readonly actions: ActionService,
    private readonly reviews: ReviewService,
    private readonly issues: IssueService,
    private readonly clock: Clock,
    private readonly habits: HabitService,
  ) {}

  async loadData(): Promise<AnalyticsData> {
    const [goals, actions, reviews, issues, planChanges, completionPlans, stateEvents, habits, habitLogs] = await Promise.all([
      this.goals.list(), this.actions.list(), this.reviews.list(), this.issues.list(),
      this.actions.listPlanChanges(), this.actions.listCompletionPlans(),
      this.actions.listStateEvents(),
      this.habits.list(), this.habits.listLogs(),
    ]);
    return { goals, actions, reviews, issues, planChanges, completionPlans, stateEvents, habits, habitLogs };
  }

  summarize(data: AnalyticsData, filter: AnalyticsFilter): AnalyticsSnapshot {
    return buildAnalytics(data, filter, this.clock.now());
  }

  compare(data: AnalyticsData, filter: {
    domainIds: readonly string[]; goalId: string | null; weeks: AnalyticsFilter["weeks"];
  }): readonly DomainAnalyticsComparison[] {
    return buildAnalyticsComparison(data, filter, this.clock.now());
  }
}
