import type { AttentionSignal } from "../../domain/attention/Attention";
import type { MetricDefinition, MetricRecord } from "../../domain/life/DomainMetric";
import type { LifeNavigation } from "../../domain/life/LifeNavigation";
import type { Action } from "../../domain/planning/Action";
import type { Goal } from "../../domain/planning/Goal";
import type { Review } from "../../domain/reviews/Review";
import { reviewPeriod, type ReviewPeriod } from "../../domain/reviews/ReviewStructure";
import type { Clock } from "../../shared/clock";
import type { AttentionService } from "../attention/AttentionService";
import type { ActionService } from "../planning/ActionService";
import type { GoalService } from "../planning/GoalService";
import type { ReviewService } from "../reviews/ReviewService";
import type { DomainMetricService } from "./DomainMetricService";
import type { LifeNavigationService } from "./LifeNavigationService";

export interface LandscapeFactOptions {
  domainIds: readonly string[];
  navigation: boolean;
  goals: boolean;
  attention: boolean;
  trends: boolean;
  reviews: boolean;
}

export interface LandscapeMetricFact {
  definition: MetricDefinition;
  latest: MetricRecord;
  previous: MetricRecord | null;
  domainId: string | null;
}

export interface LandscapeFacts {
  today: string;
  week: ReviewPeriod;
  recentStart: string;
  directions: readonly LifeNavigation[];
  goals: readonly Goal[];
  actions: readonly { action: Action; date: string }[];
  attention: readonly AttentionSignal[];
  metrics: readonly LandscapeMetricFact[];
  latestReview: Review | null;
  weeklyReview: Review | null;
}

export class LandscapeFactService {
  constructor(
    private readonly navigation: Pick<LifeNavigationService, "list">,
    private readonly goals: Pick<GoalService, "list">,
    private readonly actions: Pick<ActionService, "list">,
    private readonly attention: Pick<AttentionService, "getSnapshot">,
    private readonly metrics: Pick<DomainMetricService, "listDefinitions" | "listRecords">,
    private readonly reviews: Pick<ReviewService, "list">,
    private readonly clock: Clock,
  ) {}

  async getSnapshot(options: LandscapeFactOptions): Promise<LandscapeFacts> {
    const now = this.clock.now();
    const today = localDate(now);
    const start = new Date(`${today}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 27);
    const recentStart = start.toISOString().slice(0, 10);
    const week = reviewPeriod("weekly", today);
    const visible = new Set(options.domainIds);
    const inScope = (ids: readonly string[]) => !ids.length || ids.some(id => visible.has(id));
    const [navigation, goals, actions, attention, definitions, records, reviews] = await Promise.all([
      options.navigation ? this.navigation.list() : [],
      options.goals ? this.goals.list() : [],
      options.goals ? this.actions.list() : [],
      options.attention ? this.attention.getSnapshot().then(snapshot => snapshot.signals) : [],
      options.trends ? this.metrics.listDefinitions() : [],
      options.trends ? this.metrics.listRecords() : [],
      options.reviews ? this.reviews.list() : [],
    ]);
    const goalsById = new Map(goals.map(goal => [goal.id, goal]));
    const recentActions = actions.flatMap(action => {
      const inherited = action.goalId ? goalsById.get(action.goalId)?.domainIds ?? [] : [];
      if (!inScope([...action.domainIds, ...inherited])) return [];
      const date = action.status === "completed"
        ? action.completedAt ? localDate(new Date(action.completedAt)) : null
        : action.scheduledFor;
      if (!date || date < recentStart || date > today ||
        (action.completedAt && Date.parse(action.completedAt) > now.getTime())) return [];
      return [{ action, date }];
    }).sort((a, b) => b.date.localeCompare(a.date) || a.action.id.localeCompare(b.action.id)).slice(0, 3);

    const metricFacts: LandscapeMetricFact[] = [];
    for (const definition of definitions) {
      if (definition.archived || !inScope(definition.domainIds)) continue;
      const available = records.filter(record => record.metricId === definition.id &&
        record.recordedOn >= recentStart && record.recordedOn <= today)
        .sort((a, b) => b.recordedOn.localeCompare(a.recordedOn) || a.id.localeCompare(b.id));
      if (!available.length) continue;
      metricFacts.push({
        definition, latest: available[0], previous: available[1] ?? null,
        domainId: definition.domainIds.find(id => visible.has(id)) ?? null,
      });
    }
    metricFacts.sort((a, b) => b.latest.recordedOn.localeCompare(a.latest.recordedOn) ||
      a.definition.id.localeCompare(b.definition.id));
    const availableReviews = reviews.filter(review => review.reviewedOn <= today && inScope(review.domainIds))
      .sort((a, b) => b.reviewedOn.localeCompare(a.reviewedOn) ||
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    const priority = { high: 0, medium: 1, low: 2 };
    return {
      today, week, recentStart,
      directions: navigation.filter(record => record.kind === "vision" && !record.archivedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).slice(0, 2),
      goals: goals.filter(goal => goal.status === "active" && inScope(goal.domainIds))
        .sort((a, b) => priority[a.priority ?? "medium"] - priority[b.priority ?? "medium"] ||
          a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)).slice(0, 3),
      actions: recentActions,
      attention: attention.filter(signal => inScope(signal.domainIds)).slice(0, 2),
      metrics: metricFacts.slice(0, 3),
      latestReview: availableReviews.find(review => !review.structure || review.structure.status === "completed") ?? null,
      weeklyReview: availableReviews.find(review => review.structure?.type === "weekly" &&
        review.structure.start === week.start && review.structure.end === week.end) ?? null,
    };
  }
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
