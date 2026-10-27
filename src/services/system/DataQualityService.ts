import { localDate } from "../../domain/habits/Habit";
import { inspectDataQuality, type DataQualityReport } from "../../domain/system/DataQuality";
import { inspectLinkedRecordQuality } from "../../domain/system/LinkedRecordQuality";
import type { LifeDomainService } from "../life/LifeDomainService";
import type { LifeNavigationService } from "../life/LifeNavigationService";
import type { GoalService } from "../planning/GoalService";
import type { ActionService } from "../planning/ActionService";
import type { GoalProgressItemService } from "../planning/GoalProgressItemService";
import type { HabitService } from "../habits/HabitService";
import type { Clock } from "../../shared/clock";
import type { LifeRecordsService } from "../records/LifeRecordsService";
import type { IdentityRoleService } from "../life/IdentityRoleService";
import type { DomainMetricService } from "../life/DomainMetricService";
import type { IssueService } from "../issues/IssueService";
import type { DecisionService } from "../decisions/DecisionService";
import type { ReviewService } from "../reviews/ReviewService";
import type { ResourceService } from "../resources/ResourceService";

export interface LinkedQualitySources {
  records: Pick<LifeRecordsService, "listPeople" | "listSkills" | "listEvents">;
  roles: Pick<IdentityRoleService, "list">;
  metrics: Pick<DomainMetricService, "listDefinitions" | "listRecords">;
  issues: Pick<IssueService, "list">;
  decisions: Pick<DecisionService, "list">;
  reviews: Pick<ReviewService, "list">;
  resources: Pick<ResourceService, "list">;
}

export class DataQualityReadError extends Error {
  constructor(label: string) {
    super("无法读取" + label + "，数据质量检查未完成，请重试。");
    this.name = "DataQualityReadError";
  }
}

export class DataQualityService {
  constructor(
    private readonly domains: Pick<LifeDomainService, "list">,
    private readonly navigation: Pick<LifeNavigationService, "list">,
    private readonly goals: Pick<GoalService, "list">,
    private readonly actions: Pick<ActionService, "list">,
    private readonly items: Pick<GoalProgressItemService, "list">,
    private readonly habits: Pick<HabitService, "list" | "listLogs">,
    private readonly clock: Clock,
    private readonly linked: LinkedQualitySources,
  ) {}

  async inspect(): Promise<DataQualityReport> {
    const read = async <T>(label: string, load: () => Promise<T>): Promise<T> => {
      try { return await load(); }
      catch { throw new DataQualityReadError(label); }
    };
    const [domains, navigation, goals, actions, items, habits, logs,
      people, skills, events, roles, metrics, metricRecords, issues, decisions, reviews, resources] = await Promise.all([
      read("领域", () => this.domains.list()),
      read("人生导航", () => this.navigation.list()),
      read("目标", () => this.goals.list()),
      read("行动", () => this.actions.list()),
      read("目标进度项", () => this.items.list()),
      read("习惯", () => this.habits.list()),
      read("习惯打卡", () => this.habits.listLogs()),
      read("人物", () => this.linked.records.listPeople()),
      read("能力", () => this.linked.records.listSkills()),
      read("重要事件", () => this.linked.records.listEvents()),
      read("身份角色", () => this.linked.roles.list()),
      read("指标", () => this.linked.metrics.listDefinitions()),
      read("指标记录", () => this.linked.metrics.listRecords()),
      read("问题", () => this.linked.issues.list()),
      read("决策", () => this.linked.decisions.list()),
      read("复盘", () => this.linked.reviews.list()),
      read("资源需求", () => this.linked.resources.list()),
    ]);
    const now = this.clock.now();
    const core = { domains, navigation, goals, actions, items, habits, logs };
    return {
      checkedAt: now.toISOString(),
      counts: [
        { label: "领域", count: domains.length }, { label: "人生导航", count: navigation.length },
        { label: "目标", count: goals.length }, { label: "行动", count: actions.length },
        { label: "目标进度项", count: items.length }, { label: "习惯", count: habits.length },
        { label: "习惯打卡", count: logs.length },
        { label: "人物", count: people.length }, { label: "能力", count: skills.length },
        { label: "重要事件", count: events.length }, { label: "身份角色", count: roles.length },
        { label: "指标", count: metrics.length }, { label: "指标记录", count: metricRecords.length },
        { label: "问题", count: issues.length }, { label: "决策", count: decisions.length },
        { label: "复盘", count: reviews.length }, { label: "资源需求", count: resources.length },
      ],
      findings: [
        ...inspectDataQuality(core, localDate(now)),
        ...inspectLinkedRecordQuality(core, { people, skills, events, roles, metrics, metricRecords,
          issues, decisions, reviews, resources }),
      ],
    };
  }
}
