import {
  defaultAttentionSettings,
  attentionRuleKinds,
  findAttentionSignals,
  validateAttentionSettings,
  type AttentionSettings,
  type AttentionSignal,
} from "../../domain/attention/Attention";
import type { SystemRepository } from "../../repositories/system/SystemRepository";
import type { Clock } from "../../shared/clock";
import type { IssueService } from "../issues/IssueService";
import type { DomainMetricService } from "../life/DomainMetricService";
import type { ActionService } from "../planning/ActionService";
import type { GoalService } from "../planning/GoalService";
import type { HabitService } from "../habits/HabitService";
import type { ResourceService } from "../resources/ResourceService";
import type { DecisionService } from "../decisions/DecisionService";
import type { ReviewService } from "../reviews/ReviewService";
import type { LifeRecordsService } from "../records/LifeRecordsService";

const settingsKey = "m5_attention_settings";

export class AttentionService {
  constructor(
    private readonly goals: GoalService,
    private readonly actions: ActionService,
    private readonly issues: IssueService,
    private readonly system: SystemRepository,
    private readonly clock: Clock,
    private readonly metrics: DomainMetricService,
    private readonly habits: Pick<HabitService, "list" | "listLogs">,
    private readonly resources: Pick<ResourceService, "list">,
    private readonly decisions: Pick<DecisionService, "list">,
    private readonly reviews: Pick<ReviewService, "list">,
    private readonly events: Pick<LifeRecordsService, "listEvents">,
  ) {}

  async getSettings(): Promise<AttentionSettings> {
    const saved = await this.system.getMetadata(settingsKey);
    if (!saved) return { ...defaultAttentionSettings };
    let hasRulePreferences = false;
    try {
      const settings: unknown = JSON.parse(saved);
      if (!settings || typeof settings !== "object") return { ...defaultAttentionSettings };
      const candidate = { ...defaultAttentionSettings, ...settings } as AttentionSettings;
      hasRulePreferences = candidate.rules !== undefined || candidate.incompleteReasons !== undefined ||
        candidate.habitDropPoints !== undefined || candidate.resourceIdleWeeks !== undefined ||
        candidate.resourceNodeScope !== undefined || candidate.reviewWaitDays !== undefined ||
        candidate.reviewDraftTypes !== undefined || candidate.reviewSchedule !== undefined ||
        candidate.recentEventDays !== undefined;
      validateAttentionSettings(candidate);
      return {
        idleWeeks: candidate.idleWeeks, issueOccurrences: candidate.issueOccurrences,
        planAdjustments: candidate.planAdjustments, metricDrops: candidate.metricDrops,
        ...(candidate.incompleteReasons === undefined ? {} : { incompleteReasons: candidate.incompleteReasons }),
        ...(candidate.habitDropPoints === undefined ? {} : { habitDropPoints: candidate.habitDropPoints }),
        ...(candidate.resourceIdleWeeks === undefined ? {} : { resourceIdleWeeks: candidate.resourceIdleWeeks }),
        ...(candidate.resourceNodeScope === undefined ? {} : { resourceNodeScope: candidate.resourceNodeScope }),
        ...(candidate.reviewWaitDays === undefined ? {} : { reviewWaitDays: candidate.reviewWaitDays }),
        ...(candidate.reviewDraftTypes === undefined ? {} : { reviewDraftTypes: [...candidate.reviewDraftTypes] }),
        ...(candidate.recentEventDays === undefined ? {} : { recentEventDays: candidate.recentEventDays }),
        ...(candidate.reviewSchedule === undefined ? {} : { reviewSchedule: {
          startOn: candidate.reviewSchedule.startOn, types: [...candidate.reviewSchedule.types],
          waitDays: candidate.reviewSchedule.waitDays,
        } }),
        ...(candidate.rules === undefined ? {} : { rules: Object.fromEntries(
          attentionRuleKinds.filter(kind => candidate.rules?.[kind] !== undefined).map(kind => {
            const rule = candidate.rules![kind]!;
            return [kind, { enabled: rule.enabled, scope: rule.scope, domainIds: [...rule.domainIds] }];
          }),
        ) }),
      };
    } catch {
      if (hasRulePreferences) throw new Error("提醒规则配置损坏，请检查备份或恢复有效配置。");
      return { ...defaultAttentionSettings };
    }
  }

  async setSettings(settings: AttentionSettings): Promise<void> {
    validateAttentionSettings(settings);
    await this.system.setMetadata(settingsKey, JSON.stringify(settings));
  }

  async getSnapshot(): Promise<{ settings: AttentionSettings; signals: AttentionSignal[] }> {
    const [settings, goals, actions, issues, planChanges, definitions, records, habits, habitLogs, needs, decisions, reviews, events] = await Promise.all([
      this.getSettings(), this.goals.list(), this.actions.list(), this.issues.list(),
      this.actions.listPlanChanges(), this.metrics.listDefinitions(), this.metrics.listRecords(),
      this.habits.list(), this.habits.listLogs(),
      this.resources.list().catch(() => { throw new Error("资源需求读取失败，请重新查看。"); }),
      this.decisions.list().catch(() => { throw new Error("决策记录读取失败，请重新查看。"); }),
      this.reviews.list().catch(() => { throw new Error("复盘记录读取失败，请重新查看。"); }),
      this.events.listEvents().catch(() => { throw new Error("重要事件读取失败，请重新查看。"); }),
    ]);
    return {
      settings,
      signals: findAttentionSignals(
        goals, actions, issues, settings, this.clock.now(), planChanges, definitions, records, habits, habitLogs,
        needs, decisions, reviews, events,
      ),
    };
  }
}
