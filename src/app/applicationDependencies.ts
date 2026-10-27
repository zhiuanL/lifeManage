import { isTauri } from "@tauri-apps/api/core";
import { MigrationRunner } from "../db/MigrationRunner";
import { migrations } from "../db/migrations";
import type { StorageEnvironment } from "../domain/system/storage-status";
import { MemorySqliteExecutor } from "../repositories/memory/MemorySqliteExecutor";
import { SqliteLifeDomainRepository } from "../repositories/sqlite/SqliteLifeDomainRepository";
import { SqliteDomainMetricRepository } from "../repositories/sqlite/SqliteDomainMetricRepository";
import { SqliteHabitRepository } from "../repositories/sqlite/SqliteHabitRepository";
import { SqliteLifeRecordsRepository } from "../repositories/sqlite/SqliteLifeRecordsRepository";
import { SqliteActionRepository } from "../repositories/sqlite/SqliteActionRepository";
import { SqliteGoalRepository } from "../repositories/sqlite/SqliteGoalRepository";
import { SqliteGoalProgressItemRepository } from "../repositories/sqlite/SqliteGoalProgressItemRepository";
import { SqliteInboxRepository } from "../repositories/sqlite/SqliteInboxRepository";
import { SqliteIssueRepository } from "../repositories/sqlite/SqliteIssueRepository";
import { SqliteDecisionRepository } from "../repositories/sqlite/SqliteDecisionRepository";
import { SqliteReviewRepository } from "../repositories/sqlite/SqliteReviewRepository";
import { SqliteSystemRepository } from "../repositories/sqlite/SqliteSystemRepository";
import { SqlitePrivacyRepository } from "../repositories/sqlite/SqlitePrivacyRepository";
import { TauriSqliteExecutor } from "../repositories/sqlite/TauriSqliteExecutor";
import { LifeDomainService } from "../services/life/LifeDomainService";
import { LandscapeFactService } from "../services/life/LandscapeFactService";
import { LandscapeContextService } from "../services/life/LandscapeContextService";
import { SqliteLandscapeContextRepository } from "../repositories/sqlite/SqliteLandscapeContextRepository";
import { DomainMetricService } from "../services/life/DomainMetricService";
import { HabitService } from "../services/habits/HabitService";
import { LifeRecordsService } from "../services/records/LifeRecordsService";
import { SqliteResourceNeedRepository } from "../repositories/sqlite/SqliteResourceNeedRepository";
import { ResourceService } from "../services/resources/ResourceService";
import { SystemAssessmentService } from "../services/assessments/SystemAssessmentService";
import { AttentionService } from "../services/attention/AttentionService";
import { AnalyticsService } from "../services/analytics/AnalyticsService";
import { InboxService } from "../services/inbox/InboxService";
import { IssueService } from "../services/issues/IssueService";
import { DecisionService } from "../services/decisions/DecisionService";
import { ActionService } from "../services/planning/ActionService";
import { GoalService } from "../services/planning/GoalService";
import { GoalProgressItemService } from "../services/planning/GoalProgressItemService";
import { ReviewFactService } from "../services/reviews/ReviewFactService";
import { ReviewService } from "../services/reviews/ReviewService";
import { BootstrapApplicationService } from "../services/system/BootstrapApplicationService";
import { DataQualityService } from "../services/system/DataQualityService";
import { SetupProgressService } from "../services/system/SetupProgressService";
import { ModulePreferenceService } from "../services/system/ModulePreferenceService";
import { NavigationPreferenceService } from "../services/system/NavigationPreferenceService";
import { LandscapePreferenceService } from "../services/system/LandscapePreferenceService";
import { ThemePreferenceService } from "../services/system/ThemePreferenceService";
import { ContextExportService } from "../services/export/ContextExportService";
import { SearchService } from "../services/search/SearchService";
import { VersionHistoryService } from "../services/history/VersionHistoryService";
import { GoalTimelineService } from "../services/history/GoalTimelineService";
import { SqliteGoalHistoryRepository } from "../repositories/sqlite/SqliteGoalHistoryRepository";
import { SqliteDomainHistoryRepository } from "../repositories/sqlite/SqliteDomainHistoryRepository";
import { DomainTimelineService } from "../services/history/DomainTimelineService";
import { SqlitePersonRelationshipHistoryRepository } from "../repositories/sqlite/SqlitePersonRelationshipHistoryRepository";
import { SqliteObjectVersionRepository } from "../repositories/sqlite/SqliteObjectVersionRepository";
import { SqliteTemplateRepository } from "../repositories/sqlite/SqliteTemplateRepository";
import { SqliteSystemAssessmentRepository } from "../repositories/sqlite/SqliteSystemAssessmentRepository";
import { PersonRelationshipTimelineService } from "../services/history/PersonRelationshipTimelineService";
import { TemplateService } from "../services/templates/TemplateService";
import { BackupService } from "../services/backup/BackupService";
import { systemClock } from "../shared/clock";
import { browserIdGenerator } from "../shared/id";

import { LifeNavigationService } from "../services/life/LifeNavigationService";
import { SqliteLifeNavigationRepository } from "../repositories/sqlite/SqliteLifeNavigationRepository";
import { IdentityRoleService } from "../services/life/IdentityRoleService";
import { SqliteIdentityRoleRepository } from "../repositories/sqlite/SqliteIdentityRoleRepository";

let previewExecutor: MemorySqliteExecutor | undefined;

export interface ApplicationDependencies {
  environment: StorageEnvironment;
  bootstrapApplicationService: BootstrapApplicationService;
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
  themePreferenceService: ThemePreferenceService;
  landscapePreferenceService: LandscapePreferenceService;
  modulePreferenceService: ModulePreferenceService;
  navigationPreferenceService: NavigationPreferenceService;
  setupProgressService: SetupProgressService;
}

export function createApplicationDependencies(): ApplicationDependencies {
  const environment: StorageEnvironment = isTauri() ? "desktop" : "browser-preview";
  const executor =
    environment === "desktop"
      ? new TauriSqliteExecutor()
      : (previewExecutor ??= new MemorySqliteExecutor());
  const migrationRunner = new MigrationRunner(executor, migrations, systemClock);
  const systemRepository = new SqliteSystemRepository(executor, systemClock);
  const lifeDomainRepository = new SqliteLifeDomainRepository(executor);
  const domainMetricRepository = new SqliteDomainMetricRepository(executor);
  const habitRepository = new SqliteHabitRepository(executor);
  const habitService = new HabitService(
    habitRepository, lifeDomainRepository, systemClock, browserIdGenerator,
  );
  const navigationRepository = new SqliteLifeNavigationRepository(executor);
  const lifeNavigationService = new LifeNavigationService(navigationRepository, systemClock, browserIdGenerator);
  const goalRepository = new SqliteGoalRepository(executor);
  const identityRoleService = new IdentityRoleService(new SqliteIdentityRoleRepository(executor),
    lifeDomainRepository, goalRepository, systemClock, browserIdGenerator);
  const actionRepository = new SqliteActionRepository(executor);
  const reviewRepository = new SqliteReviewRepository(executor, true, true);
  const inboxRepository = new SqliteInboxRepository(executor);
  const issueRepository = new SqliteIssueRepository(executor);
  const resourceNeedRepository = new SqliteResourceNeedRepository(executor);
  const decisionRepository = new SqliteDecisionRepository(executor);
  const lifeDomainService = new LifeDomainService(lifeDomainRepository, systemClock, browserIdGenerator);
  const domainMetricService = new DomainMetricService(
    domainMetricRepository, lifeDomainRepository, systemClock, browserIdGenerator,
  );
  const goalService = new GoalService(goalRepository, lifeDomainRepository, systemClock, browserIdGenerator, habitRepository, navigationRepository);
  const lifeRecordsRepository = new SqliteLifeRecordsRepository(executor);
  const lifeRecordsService = new LifeRecordsService(
    lifeRecordsRepository, lifeDomainRepository, goalRepository,
    systemClock, browserIdGenerator);
  const actionService = new ActionService(
    actionRepository, goalRepository, lifeDomainRepository, systemClock, browserIdGenerator,
  );
  const reviewService = new ReviewService(
    reviewRepository, lifeDomainRepository, systemClock, browserIdGenerator, goalRepository, issueRepository,
  );
  const issueService = new IssueService(
    issueRepository, lifeDomainRepository, goalRepository, systemClock, browserIdGenerator,
  );
  const decisionService = new DecisionService(
    decisionRepository, lifeDomainRepository, goalRepository, systemClock, browserIdGenerator, navigationRepository, lifeRecordsRepository, resourceNeedRepository,
  );
  const inboxService = new InboxService(
    inboxRepository, lifeDomainService, goalService, actionService,
    reviewService, issueService, decisionService, systemClock, browserIdGenerator, lifeRecordsService,
  );

  const goalProgressItemRepository = new SqliteGoalProgressItemRepository(executor);
  const goalProgressItemService = new GoalProgressItemService(
    goalProgressItemRepository, goalRepository, systemClock, browserIdGenerator,
  );
  const resourceService = new ResourceService(resourceNeedRepository, goalService, lifeRecordsService,
    systemClock, browserIdGenerator, decisionRepository);
  const attentionService = new AttentionService(
    goalService, actionService, issueService, systemRepository, systemClock, domainMetricService, habitService,
    resourceService, decisionService, reviewService, lifeRecordsService,
  );

  return {
    environment,
    bootstrapApplicationService: new BootstrapApplicationService(
      migrationRunner,
      systemRepository,
      systemClock,
      browserIdGenerator,
    ),
    lifeDomainService,
    landscapeContextService: new LandscapeContextService(new SqliteLandscapeContextRepository(executor), systemClock),
    landscapeFactService: new LandscapeFactService(lifeNavigationService, goalService, actionService,
      attentionService, domainMetricService, reviewService, systemClock),
    lifeNavigationService,
    identityRoleService,
    domainMetricService,
    habitService,
    lifeRecordsService,
    resourceService,
    systemAssessmentService: new SystemAssessmentService(new SqliteSystemAssessmentRepository(executor), systemClock, browserIdGenerator),
    dataQualityService: new DataQualityService(lifeDomainService, lifeNavigationService,
      goalService, actionService, goalProgressItemService, habitService, systemClock, {
        records: lifeRecordsService, roles: identityRoleService, metrics: domainMetricService,
        issues: issueService, decisions: decisionService, reviews: reviewService, resources: resourceService,
      }),
    goalService,
    goalProgressItemService,
    actionService,
    reviewService,
    reviewFactService: new ReviewFactService(reviewService, goalService, actionService, goalProgressItemService,
      issueService, domainMetricService, habitService, systemClock,
      lifeRecordsService, decisionService, lifeNavigationService, resourceNeedRepository),
    issueService,
    decisionService,
    attentionService,
    analyticsService: new AnalyticsService(
      goalService, actionService, reviewService, issueService, systemClock, habitService,
    ),
    inboxService,
    contextExportService: new ContextExportService(
      new SqlitePrivacyRepository(executor), lifeDomainService, goalService, actionService,
      reviewService, inboxService, issueService, decisionService, domainMetricService, lifeNavigationService,
      lifeRecordsService, resourceNeedRepository, identityRoleService, habitService, goalProgressItemService, systemClock,
    ),
    searchService: new SearchService(
      lifeDomainService, domainMetricService, goalService, actionService,
      reviewService, issueService, decisionService, inboxService, habitService, lifeRecordsService, lifeNavigationService, identityRoleService,
    ),
    versionHistoryService: new VersionHistoryService(new SqliteObjectVersionRepository(executor), identityRoleService),
    goalTimelineService: new GoalTimelineService(new SqliteGoalHistoryRepository(executor),
      goalRepository, goalProgressItemRepository),
    domainTimelineService: new DomainTimelineService(new SqliteDomainHistoryRepository(executor)),
    personRelationshipTimelineService: new PersonRelationshipTimelineService(
      new SqlitePersonRelationshipHistoryRepository(executor)),
    templateService: new TemplateService(new SqliteTemplateRepository(executor), systemClock, browserIdGenerator, systemRepository),
    backupService: new BackupService(),
    themePreferenceService: new ThemePreferenceService(systemRepository),
    landscapePreferenceService: new LandscapePreferenceService(systemRepository),
    modulePreferenceService: new ModulePreferenceService(systemRepository),
    navigationPreferenceService: new NavigationPreferenceService(systemRepository),
    setupProgressService: new SetupProgressService(systemRepository),
  };
}
