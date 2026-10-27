import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import { LandscapePage } from "../pages/LandscapePage";

const SetupPage = lazy(() => import("../pages/SetupPage").then(
  ({ SetupPage }) => ({ default: SetupPage })));
const SettingsPage = lazy(() => import("../pages/SettingsPage").then(
  ({ SettingsPage }) => ({ default: SettingsPage })));
const IdentityRolesPage = lazy(() => import("../pages/IdentityRolesPage").then(
  ({ IdentityRolesPage }) => ({ default: IdentityRolesPage })));
const CalendarPage = lazy(() => import("../pages/CalendarPage").then(
  ({ CalendarPage }) => ({ default: CalendarPage })));
const DomainContextPage = lazy(() => import("../pages/DomainContextPage").then(
  ({ DomainContextPage }) => ({ default: DomainContextPage })));
const GoalDetailPage = lazy(() => import("../pages/GoalDetailPage").then(
  ({ GoalDetailPage }) => ({ default: GoalDetailPage })));
const GoalsPage = lazy(() => import("../pages/GoalsPage").then(
  ({ GoalsPage }) => ({ default: GoalsPage })));
const AttentionPage = lazy(() => import("../pages/AttentionPage").then(
  ({ AttentionPage }) => ({ default: AttentionPage })));
const AnalyticsPage = lazy(() => import("../pages/AnalyticsPage").then(
  ({ AnalyticsPage }) => ({ default: AnalyticsPage })));
const ReviewsPage = lazy(() => import("../pages/ReviewsPage").then(
  ({ ReviewsPage }) => ({ default: ReviewsPage })));
const InboxPage = lazy(() => import("../pages/InboxPage").then(
  ({ InboxPage }) => ({ default: InboxPage })));
const IssuesPage = lazy(() => import("../pages/IssuesPage").then(
  ({ IssuesPage }) => ({ default: IssuesPage })));
const DecisionsPage = lazy(() => import("../pages/DecisionsPage").then(
  ({ DecisionsPage }) => ({ default: DecisionsPage })));
const LifeNavigationPage = lazy(() => import("../pages/LifeNavigationPage").then(
  ({ LifeNavigationPage }) => ({ default: LifeNavigationPage })));
const MorePage = lazy(() => import("../pages/MorePage").then(
  ({ MorePage }) => ({ default: MorePage })));
const ContextExportPage = lazy(() => import("../pages/ContextExportPage").then(
  ({ ContextExportPage }) => ({ default: ContextExportPage })));
const SearchPage = lazy(() => import("../pages/SearchPage").then(
  ({ SearchPage }) => ({ default: SearchPage })));
const VersionHistoryPage = lazy(() => import("../pages/VersionHistoryPage").then(
  ({ VersionHistoryPage }) => ({ default: VersionHistoryPage })));
const TemplatesPage = lazy(() => import("../pages/TemplatesPage").then(
  ({ TemplatesPage }) => ({ default: TemplatesPage })));
const BackupPage = lazy(() => import("../pages/BackupPage").then(
  ({ BackupPage }) => ({ default: BackupPage })));
const HabitsPage = lazy(() => import("../pages/HabitsPage").then(
  ({ HabitsPage }) => ({ default: HabitsPage })));
const PeoplePage = lazy(() => import("../pages/LifeRecordsPages").then(
  ({ PeoplePage }) => ({ default: PeoplePage })));
const TimelinePage = lazy(() => import("../pages/LifeRecordsPages").then(
  ({ TimelinePage }) => ({ default: TimelinePage })));
const SkillsPage = lazy(() => import("../pages/LifeRecordsPages").then(
  ({ SkillsPage }) => ({ default: SkillsPage })));
const ResourcesPage = lazy(() => import("../pages/ResourcesPage").then(
  ({ ResourcesPage }) => ({ default: ResourcesPage })));
const SystemAssessmentPage = lazy(() => import("../pages/SystemAssessmentPage").then(
  ({ SystemAssessmentPage }) => ({ default: SystemAssessmentPage })));
const DataQualityPage = lazy(() => import("../pages/DataQualityPage").then(
  ({ DataQualityPage }) => ({ default: DataQualityPage })));
const MetricsPage = lazy(() => import("../pages/MetricsPage").then(
  ({ MetricsPage }) => ({ default: MetricsPage })));

export function AppRouter() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<LandscapePage />} />
        <Route path="domains/:domainId" element={<DomainContextPage />} />
        <Route path="goals" element={<GoalsPage />} />
        <Route path="goals/:goalId" element={<GoalDetailPage />} />
        <Route path="reviews" element={<ReviewsPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="issues" element={<IssuesPage />} />
        <Route path="decisions" element={<DecisionsPage />} />
        <Route path="attention" element={<AttentionPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="export" element={<ContextExportPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="history" element={<VersionHistoryPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="backup" element={<BackupPage />} />
        <Route path="habits" element={<HabitsPage />} />
        <Route path="people" element={<PeoplePage />} />
        <Route path="timeline" element={<TimelinePage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="resources" element={<ResourcesPage />} />
        <Route path="assessment" element={<SystemAssessmentPage />} />
        <Route path="data-quality" element={<DataQualityPage />} />
        <Route path="metrics" element={<MetricsPage />} />
        <Route path="navigation" element={<LifeNavigationPage />} />
        <Route path="setup" element={<SetupPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="roles" element={<IdentityRolesPage />} />
        <Route path="more" element={<MorePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
