import { reviewTypeLabels } from "../../domain/reviews/ReviewStructure";
import { goalStatusLabels } from "../../domain/planning/Goal";
import { goalHorizonLabels } from "../../domain/planning/GoalHorizon";
import { goalPriorityLabels } from "../../domain/planning/GoalPriority";
import { visibleGoalRelations } from "../../domain/planning/GoalRelation";
import { goalProgressModeLabels } from "../../domain/progress/GoalProgressMode";
import { progressItemLabels } from "../../domain/progress/GoalProgressItem";
import { calculateExportGoalProgress, type ExportGoalProgress } from "../../domain/export/GoalExportProgress";
import { actionDetailFields } from "../../domain/planning/ActionDetails";
import { navigationLabels } from "../../domain/life/LifeNavigation";
import type { LifeNavigationService } from "../life/LifeNavigationService";
import type { IdentityRoleService } from "../life/IdentityRoleService";
import {
  exportPrivacyTypes, privacyLevels, type ExportRecord, type PrivacyLevel, type PrivacyRecordType,
  type ExportPrivacyRecordType,
} from "../../domain/export/ContextExport";
import { planReasonLabels } from "../../domain/planning/ActionPlanChange";
import { inboxTargetLabels, suggestInboxTarget } from "../../domain/inbox/InboxItem";
import type { PrivacyRepository } from "../../repositories/export/PrivacyRepository";
import type { ActionService } from "../planning/ActionService";
import type { GoalService } from "../planning/GoalService";
import type { GoalProgressItemService } from "../planning/GoalProgressItemService";
import { systemClock, type Clock } from "../../shared/clock";
import type { LifeDomainService } from "../life/LifeDomainService";
import type { DomainMetricService } from "../life/DomainMetricService";
import type { ReviewService } from "../reviews/ReviewService";
import type { InboxService } from "../inbox/InboxService";
import type { IssueService } from "../issues/IssueService";
import type { DecisionService } from "../decisions/DecisionService";
import type { HabitService } from "../habits/HabitService";
import { localDate } from "../../domain/habits/Habit";

import type { LifeRecordsService } from "../records/LifeRecordsService";

import type { ResourceNeedRepository } from "../../repositories/resources/ResourceNeedRepository";
import { resourceKindLabels } from "../../domain/resources/Resources";

type Field = ExportRecord["fields"][number];

export class ContextExportService {
  constructor(
    private readonly privacy: PrivacyRepository,
    private readonly domains: LifeDomainService,
    private readonly goals: GoalService,
    private readonly actions: ActionService,
    private readonly reviews: ReviewService,
    private readonly inbox: InboxService,
    private readonly issues: IssueService,
    private readonly decisions: DecisionService,
    private readonly metrics: DomainMetricService,
    private readonly navigation: LifeNavigationService,
    private readonly people?: LifeRecordsService,
    private readonly resources?: ResourceNeedRepository,
    private readonly roles?: IdentityRoleService,
    private readonly habits?: HabitService,
    private readonly progressItems?: GoalProgressItemService,
    private readonly clock: Clock = systemClock,
  ) {}

  async setPrivacy(type: ExportPrivacyRecordType, id: string, level: PrivacyLevel): Promise<void> {
    if (!exportPrivacyTypes.includes(type) || !privacyLevels.includes(level)) {
      throw new Error("隐私级别或对象类型无效。");
    }
    if (type === "role") {
      if (!this.roles) throw new Error("身份角色暂不可用，请重新打开后再试。");
      await this.roles.setPrivacy(id, level);
      return;
    }
    if (!(await this.privacy.set(type, id, level))) {
      throw new Error("记录已不存在，请重新读取后再试。");
    }
  }

  async loadRecords(): Promise<readonly ExportRecord[]> {
    const [domains, goals, actions, reviews, inbox, issues, decisions, levels, planChanges,
      metricDefinitions, metricRecords, navigation, resources, roles, habitFacts, lifeRecordFacts, progressItems,
      satisfactionLinks] = await Promise.all([
      this.domains.list(), this.goals.list(), this.actions.list(), this.reviews.list(),
      this.inbox.list(), this.issues.list(), this.decisions.list(), this.privacy.list(),
      this.actions.listPlanChanges(),
      this.metrics.listDefinitions(), this.metrics.listRecords(), this.navigation.list(), this.resources?.list() ?? [],
      this.roles?.list() ?? [],
      this.loadHabitFacts(),
      this.loadLifeRecordFacts(),
      this.loadProgressItems(),
      this.metrics.listSatisfactionLinks(),
    ]);
    const [habits, habitLogs] = habitFacts;
    const [people, skills, events] = lifeRecordFacts;
    const goalProgress = this.progressItems ? calculateExportGoalProgress(goals, actions, progressItems,
      localDate(this.clock.now()), this.habits ? { habits, logs: habitLogs } : undefined) : new Map<string, ExportGoalProgress>();
    const domainNames = new Map(domains.map((domain) => [domain.id, domain.name]));
    const navigationNames = new Map(navigation.map((record) => [record.id, record.title]));
    const peopleNames = new Map(people.map((record) => [record.id, record.name]));
    const skillNames = new Map(skills.map((record) => [record.id, record.name]));
    const issueNames = new Map(issues.map(issue => [issue.id, issue.title]));
    const goalNames = new Map(goals.map((goal) => [goal.id, goal.title]));
    const decisionNames = new Map(decisions.map((decision) => [decision.id, decision.title]));
    const goalDomains = new Map(goals.map((goal) => [goal.id, goal.domainIds]));
    const linkedDomains = (ids: readonly string[], goalId: string | null) => {
      const goalDomainIds = goalId ? goalDomains.get(goalId) ?? [] : [];
      return [...new Set([...ids, ...goalDomainIds])];
    };
    const levelFor = (type: PrivacyRecordType, id: string): PrivacyLevel =>
      levels.get(`${type}:${id}`) ?? "private";
    const actionsById = new Map(actions.map((action) => [action.id, action]));
    const metricsById = new Map(metricDefinitions.map((metric) => [metric.id, metric]));
    const habitsById = new Map(habits.map(habit => [habit.id, habit]));
    const domainLinks = (ids: readonly string[]) => ids.flatMap((id) => {
      const title = domainNames.get(id);
      return title ? [{ type: "domain" as const, id, title }] : [];
    });
    const metricDomainLinks = (metricId: string, ids: readonly string[]) => domainLinks(ids).map(link =>
      satisfactionLinks.some(item => item.domainId === link.id && item.metricId === metricId)
        ? { ...link, domainLabel: "满意度所属领域" as const } : link);
    const goalLinks = (id: string | null) => {
      const title = id ? goalNames.get(id) : null;
      return title && id ? [{ type: "goal" as const, id, title }] : [];
    };
    const field = (label: string, value: string | number | null): Field => ({
      label, value: value === null ? "" : String(value),
    });

    const resourceLinks = (ids: readonly string[]) => resources
      .filter((need) => ids.includes(need.id))
      .map((need) => ({ type: "resource" as const, id: need.id, title: need.description }));
    const habitGoalLinks = (habitId: string) => goals
      .filter(goal => goal.habitProgress?.some(setting => setting.habitId === habitId))
      .flatMap(goal => goalLinks(goal.id));
    const relationLabels = {
      支持: "支持目标", 被支持: "被支持目标", 依赖: "依赖目标", 被依赖: "被依赖目标",
      冲突: "冲突目标", 相关: "相关目标",
    } as const;

    return [
      ...events.map((record): ExportRecord => ({
        type: "event", id: record.id, title: record.title, date: record.happenedOn,
        privacy: levelFor("event", record.id), domainIds: record.domainIds, goalId: record.goalId,
        fields: [field("发生日期", record.happenedOn), field("事件说明", record.description),
          field("状态", record.archived ? "已归档" : "使用中"), field("记录更新时间", record.updatedAt)],
        links: [...domainLinks(record.domainIds), ...goalLinks(record.goalId),
          ...(record.personId && peopleNames.has(record.personId)
            ? [{ type: "person" as const, id: record.personId, title: peopleNames.get(record.personId)! }] : [])],
      })),
      ...habits.map((habit): ExportRecord => ({
        type: "habit", id: habit.id, title: habit.title,
        date: localDate(new Date(habit.updatedAt)), privacy: levelFor("habit", habit.id),
        domainIds: habit.domainIds, goalId: null,
        fields: [field("意图", habit.intention), field("当前每周期望次数", habit.weeklyTarget),
          field("开始日期", habit.startOn), field("稳定情境", habit.stableContext),
          field("触发条件", habit.triggerCondition), field("阻碍", habit.obstacle),
          field("调整", habit.adjustment), field("状态", habit.archived ? "已归档" : "使用中"),
          field("定义更新时间", habit.updatedAt)],
        links: [...domainLinks(habit.domainIds), ...habitGoalLinks(habit.id)],
      })),
      ...habitLogs.flatMap((log): ExportRecord[] => {
        const habit = habitsById.get(log.habitId);
        if (!habit) return [];
        return [{
          type: "habit-log", id: log.id, title: habit.title, date: log.recordedOn,
          privacy: levelFor("habit", habit.id), domainIds: habit.domainIds, goalId: null,
          fields: [field("打卡状态", log.completed ? "已完成" : "明确未完成"),
            field("阻碍", log.obstacle), field("调整", log.adjustment),
            field("记录更新时间", log.updatedAt)],
          links: [{ type: "habit", id: habit.id, title: habit.title },
            ...domainLinks(habit.domainIds), ...habitGoalLinks(habit.id)],
        }];
      }),
      ...roles.map((role): ExportRecord => ({
        type: "role", id: role.id, title: role.name, date: role.updatedAt.slice(0, 10),
        privacy: role.privacyLevel, domainIds: role.domainIds, goalId: null,
        fields: [field("说明", role.description),
          field("状态", role.archivedAt ? "已归档" : role.active ? "已启用" : "已停用")],
        links: [...domainLinks(role.domainIds), ...role.goalIds.flatMap(goalLinks)],
      })),
      ...skills.map((record): ExportRecord => ({
        type: "skill", id: record.id, title: record.name, date: record.updatedAt.slice(0, 10),
        privacy: levelFor("skill", record.id), domainIds: linkedDomains(record.domainIds, record.goalId),
        goalId: record.goalId, links: [...domainLinks(linkedDomains(record.domainIds, record.goalId)), ...goalLinks(record.goalId)],
        fields: [field("当前水平", record.currentLevel), field("目标水平", record.targetLevel),
          field("学习路径", record.learningPath), field("练习或成果", record.practice),
          field("复盘", record.reflection), field("状态", record.archived ? "已归档" : "使用中")],
      })),
      ...resources.flatMap((need): ExportRecord[] => {
        const owner = need.goalId ? goals.find((goal) => goal.id === need.goalId) :
          decisions.find((decision) => decision.id === need.decisionId);
        if (!owner) return [];
        return [{
          type: "resource", id: need.id, title: need.description, date: need.updatedAt.slice(0, 10),
          privacy: levelFor("resource", need.id),
          domainIds: owner.domainIds, goalId: need.goalId,
          fields: [field("资源类型", resourceKindLabels[need.kind]), field("需求说明", need.description),
            field("具备情况", need.met ? "已具备" : "待补齐")],
          links: [...goalLinks(need.goalId), ...(need.decisionId && decisionNames.has(need.decisionId)
            ? [{ type: "decision" as const, id: need.decisionId, title: decisionNames.get(need.decisionId)! }] : []),
            ...(need.personId && peopleNames.has(need.personId)
              ? [{ type: "person" as const, id: need.personId, title: peopleNames.get(need.personId)! }] : []),
            ...(need.skillId && skillNames.has(need.skillId)
              ? [{ type: "skill" as const, id: need.skillId, title: skillNames.get(need.skillId)! }] : [])],
        }];
      }),
      ...people.map((record): ExportRecord => ({
        type: "person", id: record.id, title: record.name, date: localDate(new Date(record.updatedAt)),
        privacy: levelFor("person", record.id), domainIds: record.domainIds, goalId: null,
        links: [...domainLinks(record.domainIds), ...events.filter(event => event.personId === record.id)
          .map(event => ({ type: "event" as const, id: event.id, title: event.title }))],
        fields: [field("关系类型", record.relationshipType), field("关系状态", record.state),
          field("重要日期", record.importantDate), field("最近联系日期", record.lastContact),
          ...(record.dates?.length ? [
            field("生日", record.dates.find(date => date.kind === "birthday")?.date ?? null),
            field("其他重要日期", record.dates.filter(date => date.kind === "important")
              .map(date => `${date.label}：${date.date}`).join("\n")),
          ] : []),
          field("共同经历", record.sharedExperiences), field("备注", record.notes),
          field("状态", record.archived ? "已归档" : "使用中"), field("记录更新时间", record.updatedAt)],
      })),
      ...navigation.map((record): ExportRecord => ({
        type: "navigation", id: record.id, title: record.title,
        date: record.updatedAt.slice(0, 10), privacy: levelFor("navigation", record.id),
        domainIds: [], goalId: null, links: [],
        fields: [field("导航类型", navigationLabels[record.kind]), field("内容", record.description),
          field("状态", record.archivedAt ? "已归档" : "使用中")],
      })),
      ...domains.map((domain): ExportRecord => ({
        type: "domain", id: domain.id, title: domain.name,
        date: domain.createdAt.slice(0, 10), privacy: levelFor("domain", domain.id),
        domainIds: [domain.id], goalId: null,
        links: satisfactionLinks.filter(item => item.domainId === domain.id).flatMap(item => {
          const metric = metricsById.get(item.metricId);
          return metric && metric.domainIds.includes(domain.id)
            ? [{ type: "metric" as const, id: metric.id, title: metric.name }] : [];
        }),
        fields: [field("领域说明", domain.description),
          field("当前状态", domain.currentState),
          field("长期期待", domain.longTermExpectation),
          field("当前关注", domain.focus),
          field("状态", { active: "启用", paused: "已暂停",
            archived: "已归档" }[domain.status])],
      })),
      ...metricDefinitions.map((metric): ExportRecord => ({
        type: "metric", id: metric.id, title: metric.name,
        date: metric.createdAt.slice(0, 10), privacy: levelFor("metric", metric.id),
        domainIds: metric.domainIds, goalId: null, links: metricDomainLinks(metric.id, metric.domainIds),
        fields: [field("计量单位", metric.unit),
          field("状态", metric.archived ? "已归档" : "使用中")],
      })),
      ...metricRecords.flatMap((record): ExportRecord[] => {
        const metric = metricsById.get(record.metricId);
        if (!metric) return [];
        return [{
          type: "metric-record", id: record.id, title: metric.name,
          date: record.recordedOn, privacy: levelFor("metric", metric.id),
          domainIds: metric.domainIds, goalId: null, links: metricDomainLinks(metric.id, metric.domainIds),
          fields: [field("数值", record.value), field("计量单位", metric.unit),
            field("记录说明", record.note)],
        }];
      }),
      ...goals.map((goal): ExportRecord => ({
        type: "goal", id: goal.id, title: goal.title,
        date: goal.completedAt?.slice(0, 10) ?? goal.createdAt.slice(0, 10),
        privacy: levelFor("goal", goal.id),
        domainIds: goal.domainIds, goalId: goal.id,
        goalProgress: goalProgress.get(goal.id),
        links: [...domainLinks(goal.domainIds),
          ...goalLinks(goal.parentId).map(link => ({ ...link, goalLabel: "上层目标" as const })),
          ...goals.filter(child => child.parentId === goal.id).flatMap(child =>
            goalLinks(child.id).map(link => ({ ...link, goalLabel: "下级目标" as const }))),
          ...visibleGoalRelations(goal, goals).flatMap(relation => goalLinks(relation.goalId)
            .map(link => ({ ...link, goalLabel: relationLabels[relation.label as keyof typeof relationLabels] }))),
          ...roles.filter(role => role.goalIds.includes(goal.id)).map(role =>
            ({ type: "role" as const, id: role.id, title: role.name })),
          ...resourceLinks(resources.filter((need) => need.goalId === goal.id).map((need) => need.id)), ...(goal.directionId && navigationNames.has(goal.directionId)
          ? [{ type: "navigation" as const, id: goal.directionId, title: navigationNames.get(goal.directionId)! }] : [])],
        fields: [field("说明", goal.description),
          field("状态", goalStatusLabels[goal.status]), field("状态原因", goal.statusReason ?? null),
          field("目标周期", goal.horizon ? goalHorizonLabels[goal.horizon] : null),
          field("优先级", goalPriorityLabels[goal.priority ?? "medium"]),
          field("进度方式", goalProgressModeLabels[goal.progressMode ?? "automatic"]),
          field("贡献权重", goal.progressWeight ?? 1),
          field("目标日期", goal.targetDate), field("完成日期", goal.completedAt?.slice(0, 10) ?? null),
          field("记录更新时间", goal.updatedAt ?? null)],
      })),
      ...progressItems.flatMap((item): ExportRecord[] => {
        const owner = goals.find(goal => goal.id === item.goalId);
        if (!owner) return [];
        return [{
          type: "progress-item", id: item.id, title: item.title, date: localDate(new Date(item.updatedAt)),
          privacy: levelFor("goal", owner.id), domainIds: owner.domainIds, goalId: owner.id,
          links: [...domainLinks(owner.domainIds), ...goalLinks(owner.id)],
          fields: [field("进度项类型", progressItemLabels[item.kind]), field("目标值", item.targetValue),
            field("当前值", item.currentValue), field("权重", item.weight), field("记录更新时间", item.updatedAt)],
        }];
      }),
      ...actions.map((action): ExportRecord => ({
        type: "action", id: action.id, title: action.title,
        date: action.completedAt?.slice(0, 10) ?? action.scheduledFor ??
          action.createdAt.slice(0, 10),
        privacy: levelFor("action", action.id),
        domainIds: linkedDomains(action.domainIds, action.goalId),
        goalId: action.goalId,
        links: [...domainLinks(linkedDomains(action.domainIds,
          action.goalId)),
          ...goalLinks(action.goalId)],
        fields: [field("备注", action.notes),
          field("状态", action.status === "completed" ? "已完成" : "未完成"),
          field("当前安排日期", action.scheduledFor),
          field("完成日期", action.completedAt?.slice(0, 10) ?? null),
          ...actionDetailFields.map(([key, label]) => field(label, action.details?.[key] ?? "")),
          field("投入时间（分钟）", action.details?.actualMinutes ?? null),
          field("贡献权重", action.progressWeight ?? 1)],
      })),
      ...planChanges.flatMap((change): ExportRecord[] => {
        if (change.reason === "initial") return [];
        const action = actionsById.get(change.actionId);
        const changedAt = new Date(change.changedAt);
        if (!action || Number.isNaN(changedAt.getTime())) return [];
        const date = `${changedAt.getFullYear()}-${String(changedAt.getMonth() + 1).padStart(2, "0")}-${String(changedAt.getDate()).padStart(2, "0")}`;
        const ids = linkedDomains(action.domainIds, action.goalId);
        return [{
          type: "plan-change", id: String(change.id), title: action.title, date,
          privacy: levelFor("action", action.id), domainIds: ids, goalId: action.goalId,
          links: [...domainLinks(ids), ...goalLinks(action.goalId)],
          fields: [field("原安排", change.beforeDate ?? "未安排"),
            field("新安排", change.afterDate ?? "取消安排"),
            field("调整原因", planReasonLabels[change.reason]),
            field("补充说明", change.note)],
        }];
      }),
      ...reviews.map((review): ExportRecord => ({
        type: "review", id: review.id, title: review.title, date: review.reviewedOn,
        privacy: levelFor("review", review.id),
        domainIds: review.domainIds, goalId: null,
        links: [...domainLinks(review.domainIds), ...(review.goalIds ?? []).flatMap(goalLinks),
          ...(review.issueIds ?? []).flatMap(id => issueNames.has(id)
            ? [{ type: "issue" as const, id, title: issueNames.get(id)! }] : [])],
        fields: [field("回看", review.reflection),
          field("发现", review.insight), field("下一处关注", review.nextFocus),
          ...(review.structure ? [
            field("复盘周期", reviewTypeLabels[review.structure.type]),
            field("周期开始", review.structure.start), field("周期结束", review.structure.end),
            field("复盘状态", review.structure.status === "completed" ? "已完成" : "草稿"),
            field("书写模式", review.structure.mode === "narrative" ? "叙事" : "结构化"),
            field("复盘模板", `${review.structure.template.name} · v${review.structure.template.version}`),
            field("复盘正文", review.structure.template.fields.map(item =>
              `${item.label}：${review.structure!.answers[item.key] || "未填写"}`).join("\n")),
          ] : []),
        ],
      })),
      ...inbox.map((item): ExportRecord => {
        const suggestion = suggestInboxTarget(item.content);
        return {
          type: "inbox", id: item.id, title: item.content, date: item.createdAt.slice(0, 10),
          privacy: levelFor("inbox", item.id),
          domainIds: [], goalId: null, links: [],
          fields: [field("状态", item.status === "unprocessed" ? "待整理" : "已处理"),
            field("规则建议分类", suggestion ? inboxTargetLabels[suggestion.type] : ""),
            field("建议依据", suggestion?.reason ?? "")],
        };
      }),
      ...issues.map((issue): ExportRecord => ({
        type: "issue", id: issue.id, title: issue.title, date: issue.firstSeen,
        privacy: levelFor("issue", issue.id),
        domainIds: linkedDomains(issue.domainIds, issue.goalId), goalId: issue.goalId,
        links: [...domainLinks(linkedDomains(issue.domainIds, issue.goalId)),
          ...goalLinks(issue.goalId)],
        fields: [field("描述", issue.description), field("已记出现次数", issue.occurrenceCount),
          field("原因假设", issue.causeHypothesis), field("已尝试", issue.attempts),
          field("后续回看", issue.followUp),
          field("状态", { open: "进行中", watching: "观察中", resolved: "已解决" }[issue.status])],
      })),
      ...decisions.map((decision): ExportRecord => ({
        type: "decision", id: decision.id, title: decision.title, date: decision.decidedOn,
        privacy: levelFor("decision", decision.id),
        domainIds: linkedDomains(decision.domainIds, decision.goalId), goalId: decision.goalId,
        links: [...domainLinks(linkedDomains(decision.domainIds, decision.goalId)),
          ...resourceLinks([...new Set([...(decision.resourceNeedIds ?? []),
            ...resources.filter((need) => need.decisionId === decision.id).map((need) => need.id)])]),
          ...(decision.personIds ?? []).flatMap((id) => peopleNames.has(id)
            ? [{ type: "person" as const, id, title: peopleNames.get(id)! }] : []),
          ...goalLinks(decision.goalId), ...(decision.navigationIds ?? []).flatMap((id) =>
            navigationNames.has(id) ? [{ type: "navigation" as const, id, title: navigationNames.get(id)! }] : [])],
        fields: [field("重要程度", decision.importance === "major" ? "重大" : "普通"),
          field("背景", decision.background), field("可选方案", decision.options),
          field("现实约束", decision.constraints), field("评价维度", decision.criteria),
          field("风险", decision.risks), field("机会成本", decision.opportunityCost),
          field("可逆性", { unknown: "尚未判断", reversible: "可以回退",
            difficult: "难以回退" }[decision.reversibility]),
          field("最终选择", decision.choice), field("选择理由", decision.rationale),
          field("执行条件", decision.executionConditions),
          field("后续结果", decision.outcome), field("复盘", decision.reflection)],
      })),
    ];
  }

  private async loadHabitFacts() {
    if (!this.habits) return [[], []] as const;
    try {
      return await Promise.all([this.habits.list(), this.habits.listLogs()]);
    } catch {
      throw new Error("无法读取习惯或打卡记录，请重新读取后再试。");
    }
  }

  private async loadLifeRecordFacts() {
    if (!this.people) return [[], [], []] as const;
    return Promise.all([
      this.people.listPeople().catch(() => { throw new Error("无法读取人物记录，请重新读取后再试。"); }),
      this.people.listSkills().catch(() => { throw new Error("无法读取能力记录，请重新读取后再试。"); }),
      this.people.listEvents().catch(() => { throw new Error("无法读取事件记录，请重新读取后再试。"); }),
    ]);
  }

  private async loadProgressItems() {
    if (!this.progressItems) return [];
    try {
      return await this.progressItems.list();
    } catch {
      throw new Error("无法读取目标进度项，请重新读取后再试。");
    }
  }
}
