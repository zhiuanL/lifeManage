import { createContext, useContext } from "react";
import type { SetupProgressService } from "../services/system/SetupProgressService";
import type { ModulePreference } from "../domain/system/ModulePreference";
import type { NavigationPreference, NavigationPreferenceUpdate } from "../domain/system/NavigationPreference";
import type { LandscapePreferenceService } from "../services/system/LandscapePreferenceService";
import type { ThemeKey } from "../domain/life/ThemePreference";
import type { AttentionService } from "../services/attention/AttentionService";
import type { AnalyticsService } from "../services/analytics/AnalyticsService";
import type { ContextExportService } from "../services/export/ContextExportService";
import type { StorageEnvironment } from "../domain/system/storage-status";
import type { LifeNavigationService } from "../services/life/LifeNavigationService";
import type { IdentityRoleService } from "../services/life/IdentityRoleService";
import type { LifeDomainService } from "../services/life/LifeDomainService";
import type { LandscapeFactService } from "../services/life/LandscapeFactService";
import type { LandscapeContextService } from "../services/life/LandscapeContextService";
import type { DomainMetricService } from "../services/life/DomainMetricService";
import type { HabitService } from "../services/habits/HabitService";
import type { LifeRecordsService } from "../services/records/LifeRecordsService";
import type { ResourceService } from "../services/resources/ResourceService";
import type { SystemAssessmentService } from "../services/assessments/SystemAssessmentService";
import type { InboxService } from "../services/inbox/InboxService";
import type { IssueService } from "../services/issues/IssueService";
import type { DecisionService } from "../services/decisions/DecisionService";
import type { ActionService } from "../services/planning/ActionService";
import type { GoalService } from "../services/planning/GoalService";
import type { GoalProgressItemService } from "../services/planning/GoalProgressItemService";
import type { ReviewFactService } from "../services/reviews/ReviewFactService";
import type { ReviewService } from "../services/reviews/ReviewService";
import type { SearchService } from "../services/search/SearchService";
import type { VersionHistoryService } from "../services/history/VersionHistoryService";
import type { GoalTimelineService } from "../services/history/GoalTimelineService";
import type { DomainTimelineService } from "../services/history/DomainTimelineService";
import type { PersonRelationshipTimelineService } from "../services/history/PersonRelationshipTimelineService";
import type { TemplateService } from "../services/templates/TemplateService";
import type { BackupService } from "../services/backup/BackupService";
import type { DataQualityService } from "../services/system/DataQualityService";

export interface LifeOSContextValue {
  environment: StorageEnvironment;
  lifeDomainService: LifeDomainService;
  landscapeFactService: LandscapeFactService;
  landscapeContextService: LandscapeContextService;
  lifeNavigationService: LifeNavigationService;
  identityRoleService: IdentityRoleService;
  domainMetricService: DomainMetricService;
  habitService: HabitService;
  lifeRecordsService: LifeRecordsService;
  resourceService: ResourceService;
  systemAssessmentService: SystemAssessmentService;
  dataQualityService: DataQualityService;
  goalService: GoalService;
  goalProgressItemService: GoalProgressItemService;
  actionService: ActionService;
  reviewService: ReviewService;
  reviewFactService: ReviewFactService;
  inboxService: InboxService;
  issueService: IssueService;
  decisionService: DecisionService;
  attentionService: AttentionService;
  analyticsService: AnalyticsService;
  contextExportService: ContextExportService;
  searchService: SearchService;
  versionHistoryService: VersionHistoryService;
  goalTimelineService: GoalTimelineService;
  domainTimelineService: DomainTimelineService;
  personRelationshipTimelineService: PersonRelationshipTimelineService;
  templateService: TemplateService;
  backupService: BackupService;
  landscapePreferenceService: LandscapePreferenceService;
  setupProgressService?: SetupProgressService;
  modulePreference?: ModulePreference;
  setModulePreference?(preference: ModulePreference): Promise<void>;
  navigationPreference?: NavigationPreference;
  updateNavigationPreference?(change: NavigationPreferenceUpdate): Promise<void>;
  theme: ThemeKey;
  setTheme(theme: ThemeKey): Promise<void>;
}

export const LifeOSContext = createContext<LifeOSContextValue | null>(null);

export function useLifeOS(): LifeOSContextValue {
  const context = useContext(LifeOSContext);

  if (!context) {
    throw new Error("LifeOS provider is unavailable.");
  }

  return context;
}
