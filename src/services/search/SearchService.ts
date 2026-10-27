import type { SearchEntry } from "../../domain/search/Search";
import { navigationLabels } from "../../domain/life/LifeNavigation";
import type { LifeNavigationService } from "../life/LifeNavigationService";
import type { IdentityRoleService } from "../life/IdentityRoleService";
import type { LifeDomainService } from "../life/LifeDomainService";
import type { DomainMetricService } from "../life/DomainMetricService";
import type { GoalService } from "../planning/GoalService";
import type { ActionService } from "../planning/ActionService";
import type { ReviewService } from "../reviews/ReviewService";
import type { IssueService } from "../issues/IssueService";
import type { DecisionService } from "../decisions/DecisionService";
import type { InboxService } from "../inbox/InboxService";
import type { HabitService } from "../habits/HabitService";
import type { LifeRecordsService } from "../records/LifeRecordsService";

export class SearchService {
  constructor(
    private readonly domains: LifeDomainService,
    private readonly metrics: DomainMetricService,
    private readonly goals: GoalService,
    private readonly actions: ActionService,
    private readonly reviews: ReviewService,
    private readonly issues: IssueService,
    private readonly decisions: DecisionService,
    private readonly inbox: InboxService,
    private readonly habits?: HabitService,
    private readonly records?: LifeRecordsService,
    private readonly navigation?: LifeNavigationService,
    private readonly roles?: IdentityRoleService,
  ) {}

  async list(): Promise<readonly SearchEntry[]> {
    const [domains, metrics, goals, actions, reviews, issues, decisions, inbox, habits,
      people, events, skills, navigation, roles] =
      await Promise.all([
        this.domains.list(), this.metrics.listDefinitions(), this.goals.list(),
        this.actions.list(), this.reviews.list(), this.issues.list(),
        this.decisions.list(), this.inbox.list(),
        this.habits?.list() ?? Promise.resolve([]),
        this.records?.listPeople() ?? Promise.resolve([]),
        this.records?.listEvents() ?? Promise.resolve([]),
        this.records?.listSkills() ?? Promise.resolve([]),
        this.navigation?.list() ?? Promise.resolve([]),
        this.roles?.list() ?? Promise.resolve([]),
      ]);
    const goalDomains = new Map(goals.map((goal) => [goal.id, goal.domainIds]));
    const linked = (domainId: string | null, goalId: string | null) => [
      ...new Set([domainId, ...(goalId ? goalDomains.get(goalId) ?? [] : [])].filter(
        (id): id is string => Boolean(id),
      )),
    ];
    return [
      ...roles.map((item): SearchEntry => ({
        type: "role", id: item.id, title: item.name, content: item.description,
        date: item.createdAt.slice(0, 10),
        status: item.archivedAt ? "archived" : item.active ? "active" : "inactive",
        domainIds: item.domainIds, href: `/roles#role-${encodeURIComponent(item.id)}`,
      })),
      ...navigation.map((item): SearchEntry => ({
        type: "navigation", id: item.id, title: item.title,
        content: `${navigationLabels[item.kind]} ${item.description}`,
        date: item.createdAt.slice(0, 10), status: item.archivedAt ? "archived" : "active",
        domainIds: [], href: `/navigation#navigation-${encodeURIComponent(item.id)}`,
      })),
      ...domains.map((item): SearchEntry => ({
        type: "domain", id: item.id, title: item.name,
        content: `${item.description} ${item.focus} ${item.currentState} ${item.longTermExpectation}`,
        date: item.createdAt.slice(0, 10), status: item.status,
        domainIds: [item.id], href: `/domains/${encodeURIComponent(item.id)}`,
      })),
      ...metrics.map((item): SearchEntry => ({
        type: "metric", id: item.id, title: item.name, content: item.unit,
        date: item.createdAt.slice(0, 10), status: item.archived ? "archived" : "active",
        domainIds: item.domainIds,
        href: `/metrics#metric-${encodeURIComponent(item.id)}`,
      })),
      ...goals.map((item): SearchEntry => ({
        type: "goal", id: item.id, title: item.title,
        content: `${item.description} ${item.statusReason ?? ""}`,
        date: item.createdAt.slice(0, 10), status: item.status,
        domainIds: item.domainIds, href: `/goals#goal-${encodeURIComponent(item.id)}`,
      })),
      ...actions.map((item): SearchEntry => ({
        type: "action", id: item.id, title: item.title, content: item.notes,
        date: item.createdAt.slice(0, 10), status: item.status,
        domainIds: [...new Set([...item.domainIds, ...linked(null, item.goalId)])],
        href: `/goals#action-${encodeURIComponent(item.id)}`,
      })),
      ...reviews.map((item): SearchEntry => ({
        type: "review", id: item.id, title: item.title,
        content: `${item.reflection} ${item.insight} ${item.nextFocus}`,
        date: item.reviewedOn, status: "", domainIds: item.domainIds,
        href: `/reviews#review-${encodeURIComponent(item.id)}`,
      })),
      ...issues.map((item): SearchEntry => ({
        type: "issue", id: item.id, title: item.title,
        content: `${item.description} ${item.causeHypothesis} ${item.attempts} ${item.followUp}`,
        date: item.firstSeen, status: item.status,
        domainIds: [...new Set([...item.domainIds, ...linked(null, item.goalId)])],
        href: `/issues#issue-${encodeURIComponent(item.id)}`,
      })),
      ...decisions.map((item): SearchEntry => ({
        type: "decision", id: item.id, title: item.title,
        content: `${item.background} ${item.options} ${item.choice} ${item.rationale} ${item.reflection}`,
        date: item.decidedOn, status: item.status,
        domainIds: [...new Set([...item.domainIds, ...linked(null, item.goalId)])],
        href: `/decisions#decision-${encodeURIComponent(item.id)}`,
      })),
      ...inbox.map((item): SearchEntry => ({
        type: "inbox", id: item.id, title: item.content, content: "",
        date: item.createdAt.slice(0, 10), status: item.status, domainIds: [],
        href: `/inbox#inbox-${encodeURIComponent(item.id)}`,
      })),
      ...habits.map((item): SearchEntry => ({
        type: "habit", id: item.id, title: item.title,
        content: `${item.intention} ${item.stableContext} ${item.triggerCondition} ${item.obstacle} ${item.adjustment}`,
        date: item.startOn, status: item.archived ? "archived" : "active",
        domainIds: item.domainIds, href: `/habits#habit-${encodeURIComponent(item.id)}`,
      })),
      ...people.map((item): SearchEntry => ({
        type: "person", id: item.id, title: item.name,
        content: `${item.relationshipType} ${item.state} ${item.sharedExperiences} ${item.notes} ${
          item.importantDate ?? ""} ${(item.dates ?? []).map(date => `${date.label} ${date.date}`).join(" ")}`,
        date: item.lastContact ?? item.createdAt.slice(0, 10),
        status: item.archived ? "archived" : "active", domainIds: item.domainIds,
        href: `/people#person-${encodeURIComponent(item.id)}`,
      })),
      ...events.map((item): SearchEntry => ({
        type: "event", id: item.id, title: item.title, content: item.description,
        date: item.happenedOn, status: item.archived ? "archived" : "active",
        domainIds: [...new Set([...item.domainIds, ...linked(null, item.goalId)])],
        href: `/timeline#event-${encodeURIComponent(item.id)}`,
      })),
      ...skills.map((item): SearchEntry => ({
        type: "skill", id: item.id, title: item.name,
        content: `${item.learningPath} ${item.practice} ${item.reflection}`,
        date: item.createdAt.slice(0, 10), status: item.archived ? "archived" : "active",
        domainIds: [...new Set([...item.domainIds, ...linked(null, item.goalId)])],
        href: `/skills#skill-${encodeURIComponent(item.id)}`,
      })),
    ];
  }
}
