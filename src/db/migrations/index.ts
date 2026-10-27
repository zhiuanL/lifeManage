import { m0FoundationMigration } from "./0001-m0-foundation";
import { m1LifeDomainsMigration } from "./0002-m1-life-domains";
import { m2PlanningMigration } from "./0003-m2-planning";
import { m3ReviewsMigration } from "./0004-m3-reviews";
import { m4InboxMigration } from "./0005-m4-inbox";
import { m4IssuesMigration } from "./0006-m4-issues";
import { m4DecisionsMigration } from "./0007-m4-decisions";
import { m5PrivacyMigration } from "./0008-m5-privacy";
import { m5ActionPlansMigration } from "./0009-m5-action-plans";
import { m5ActionCompletionsMigration } from "./0010-m5-action-completions";
import { m5ActionStatesMigration } from "./0011-m5-action-states";
import { m5DomainMetricsMigration } from "./0012-m5-domain-metrics";
import { m5MetricPrivacyMigration } from "./0013-m5-metric-privacy";
import { m6ObjectVersionsMigration } from "./0014-m6-object-versions";
import { m6TemplatesMigration } from "./0015-m6-templates";
import { m6HabitTemplatesMigration } from "./0016-m6-habit-templates";
import { m7HabitsMigration } from "./0017-m7-habits";
import { m7LifeRecordsMigration } from "./0018-m7-life-records";
import { m7ResourceAssessmentsMigration } from "./0019-m7-resource-assessments";
import { v1LifeDomainContextMigration } from "./0020-v1-life-domain-context";
import { v1GoalDomainLinksMigration } from "./0021-v1-goal-domain-links";
import { v1ActionDomainLinksMigration } from "./0022-v1-action-domain-links";
import { v1ReviewDomainLinksMigration } from "./0023-v1-review-domain-links";
import { v1GoalHierarchyMigration } from "./0024-v1-goal-hierarchy";
import { v1GoalProgressItemsMigration } from "./0025-v1-goal-progress-items";
import { v1GoalLifecycleMigration } from "./0026-v1-goal-lifecycle";
import { v1ExplorationProgressMigration } from "./0027-v1-exploration-progress";
import { v1HabitGoalProgressMigration } from "./0028-v1-habit-goal-progress";
import { v1ContributionWeightsMigration } from "./0029-v1-contribution-weights";
import { v1GoalPriorityMigration } from "./0030-v1-goal-priority";
import { v1GoalRelationsMigration } from "./0031-v1-goal-relations";
import { v1LifeNavigationMigration } from "./0032-v1-life-navigation";
import { v1GoalDirectionMigration } from "./0033-v1-goal-direction";
import { v1NavigationHistoryMigration } from "./0034-v1-navigation-history";
import { v1NavigationPrivacyMigration } from "./0035-v1-navigation-privacy";
import { v1DecisionNavigationMigration } from "./0036-v1-decision-navigation";
import { v1DecisionPeopleMigration } from "./0037-v1-decision-people";
import { v1DecisionResourcesMigration } from "./0038-v1-decision-resources";
import { v1ResourceOwnershipMigration } from "./0039-v1-resource-ownership";
import { v1ResourcePrivacyMigration } from "./0040-v1-resource-privacy";
import { v1ActionHistoryMigration } from "./0042-v1-action-history";
import { v1ReviewStructureMigration } from "./0043-v1-review-structure";
import type { Migration } from "./types";
import { v1ActionDetailsMigration } from "./0041-v1-action-details";

import { v1ReviewObjectLinksMigration } from "./0044-v1-review-object-links";
import { v1IdentityRolesMigration } from "./0045-v1-identity-roles";
import { v1InboxRecordTargetsMigration } from "./0046-v1-inbox-record-targets";
import { v1DomainTemplatesMigration } from "./0047-v1-domain-templates";
import { v1DomainHistoryMigration } from "./0048-v1-domain-history";
import { v1PersonDatesMigration } from "./0049-v1-person-dates";
import { v1PersonRelationshipHistoryMigration } from "./0050-v1-person-relationship-history";
import { v1DomainSatisfactionMigration } from "./0051-v1-domain-satisfaction";
import { v1LandscapeContextMigration } from "./0052-v1-landscape-context";

export const migrations: readonly Migration[] = [
  m0FoundationMigration,
  m1LifeDomainsMigration,
  m2PlanningMigration,
  m3ReviewsMigration,
  m4InboxMigration,
  m4IssuesMigration,
  m4DecisionsMigration,
  m5PrivacyMigration,
  m5ActionPlansMigration,
  m5ActionCompletionsMigration,
  m5ActionStatesMigration,
  m5DomainMetricsMigration,
  m5MetricPrivacyMigration,
  m6ObjectVersionsMigration,
  m6TemplatesMigration,
  m6HabitTemplatesMigration,
  m7HabitsMigration,
  m7LifeRecordsMigration,
  m7ResourceAssessmentsMigration,
  v1LifeDomainContextMigration,
  v1GoalDomainLinksMigration,
  v1ActionDomainLinksMigration,
  v1ReviewDomainLinksMigration,
  v1GoalHierarchyMigration,
  v1GoalProgressItemsMigration,
  v1GoalLifecycleMigration,
  v1ExplorationProgressMigration,
  v1HabitGoalProgressMigration,
  v1ContributionWeightsMigration,
  v1GoalPriorityMigration,
  v1GoalRelationsMigration,
  v1LifeNavigationMigration,
  v1GoalDirectionMigration,
  v1NavigationHistoryMigration,
  v1NavigationPrivacyMigration,
  v1DecisionNavigationMigration,
  v1DecisionPeopleMigration,
  v1DecisionResourcesMigration,
  v1ResourceOwnershipMigration,
  v1ResourcePrivacyMigration,
  v1ActionDetailsMigration,
  v1ActionHistoryMigration,
  v1ReviewStructureMigration,
  v1ReviewObjectLinksMigration,
  v1IdentityRolesMigration,
  v1InboxRecordTargetsMigration,
  v1DomainTemplatesMigration,
  v1DomainHistoryMigration,
  v1PersonDatesMigration,
  v1PersonRelationshipHistoryMigration,
  v1DomainSatisfactionMigration,
  v1LandscapeContextMigration,
];
