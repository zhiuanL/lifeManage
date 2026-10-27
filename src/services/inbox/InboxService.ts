import {
  validateInboxContent,
  InboxValidationError,
  type InboxItem,
  type InboxSource,
  type InboxTarget,
} from "../../domain/inbox/InboxItem";
import { normalizeIssueDraft, type IssueDraft } from "../../domain/issues/Issue";
import { normalizeDecisionDraft, type DecisionDraft } from "../../domain/decisions/Decision";
import { normalizeActionDraft, type ActionDraft } from "../../domain/planning/Action";
import { normalizeGoalDraft, type GoalDraft } from "../../domain/planning/Goal";
import { normalizeReviewDraft, type ReviewDraft } from "../../domain/reviews/Review";
import { normalizeEvent, normalizePerson, type LifeEventDraft, type PersonDraft } from "../../domain/records/LifeRecords";
import type { InboxRepository } from "../../repositories/inbox/InboxRepository";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";
import type { LifeDomainService } from "../life/LifeDomainService";
import type { IssueService } from "../issues/IssueService";
import type { DecisionService } from "../decisions/DecisionService";
import type { ActionService } from "../planning/ActionService";
import type { GoalService } from "../planning/GoalService";
import type { ReviewService } from "../reviews/ReviewService";
import type { LifeRecordsService } from "../records/LifeRecordsService";
import { suggestInboxObjects, type InboxObjectSuggestion } from "../../domain/inbox/InboxSuggestions";
import { goalStatusLabels } from "../../domain/planning/Goal";

export type InboxConversion =
  | { type: "goal"; draft: GoalDraft }
  | { type: "action"; draft: ActionDraft }
  | { type: "review"; draft: ReviewDraft }
  | { type: "issue"; draft: IssueDraft }
  | { type: "decision"; draft: DecisionDraft }
  | { type: "event"; draft: LifeEventDraft }
  | { type: "person"; draft: PersonDraft };

export class InboxService {
  constructor(
    private readonly repository: InboxRepository,
    private readonly domains: LifeDomainService,
    private readonly goals: GoalService,
    private readonly actions: ActionService,
    private readonly reviews: ReviewService,
    private readonly issues: IssueService,
    private readonly decisions: DecisionService,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly records: LifeRecordsService,
  ) {}

  list(): Promise<readonly InboxItem[]> {
    return this.repository.list();
  }

  async suggestObjects(content: string): Promise<readonly InboxObjectSuggestion[]> {
    validateInboxContent(content);
    const [domains, goals, actions, reviews, issues, decisions, people, events] = await Promise.all([
      this.domains.list(), this.goals.list(), this.actions.list(), this.reviews.list(),
      this.issues.list(), this.decisions.list(), this.records.listPeople(), this.records.listEvents(),
    ]);
    return suggestInboxObjects(content, [
      ...domains.map(item => ({ type: "domain" as const, id: item.id, name: item.name,
        state: item.status === "archived" ? "已归档" : item.status === "paused" ? "暂停" : "" })),
      ...goals.map(item => ({ type: "goal" as const, id: item.id, name: item.title,
        state: goalStatusLabels[item.status] })),
      ...actions.map(item => ({ type: "action" as const, id: item.id, name: item.title,
        state: item.status === "completed" ? "已完成" : "待完成" })),
      ...reviews.map(item => ({ type: "review" as const, id: item.id, name: item.title,
        state: item.structure?.status === "draft" ? "草稿" : "" })),
      ...issues.map(item => ({ type: "issue" as const, id: item.id, name: item.title,
        state: item.status === "resolved" ? "已解决" : item.status === "watching" ? "观察中" : "待处理" })),
      ...decisions.map(item => ({ type: "decision" as const, id: item.id, name: item.title,
        state: item.status === "decided" ? "已决定" : "考虑中" })),
      ...people.map(item => ({ type: "person" as const, id: item.id, name: item.name,
        state: item.archived ? "已归档" : "" })),
      ...events.map(item => ({ type: "event" as const, id: item.id, name: item.title,
        state: item.archived ? "已归档" : "" })),
    ]);
  }

  async capture(content: string, source: InboxSource = "inbox"): Promise<InboxItem> {
    validateInboxContent(content);
    const timestamp = this.clock.now().toISOString();
    const item: InboxItem = {
      id: this.idGenerator.next(),
      content,
      source,
      status: "unprocessed",
      targetType: null,
      targetId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.repository.create(item);
    return item;
  }

  async archive(id: string): Promise<void> {
    if (!(await this.repository.changeStatus(id, "unprocessed", "archived", this.clock.now().toISOString()))) {
      throw new InboxValidationError("这条记录已变化，请刷新收集箱后重试。");
    }
  }

  async restore(id: string): Promise<void> {
    if (!(await this.repository.changeStatus(id, "archived", "unprocessed", this.clock.now().toISOString()))) {
      throw new InboxValidationError("这条记录已变化，请刷新收集箱后重试。");
    }
  }

  async hasReservedTarget(id: string): Promise<boolean> {
    const item = await this.repository.findById(id);
    if (item?.status !== "processing" || !item.targetType || item.targetId !== `inbox-${id}`) {
      throw new InboxValidationError("这条记录已变化，请刷新收集箱后重试。");
    }
    return this.targetExists(item.targetType, item.targetId);
  }

  async finishProcessing(id: string): Promise<InboxItem> {
    const item = await this.repository.findById(id);
    if (item?.status === "organized") {
      return item;
    }
    if (item?.status !== "processing" || !item.targetType || item.targetId !== `inbox-${id}`) {
      throw new InboxValidationError("这条记录已变化，请刷新收集箱后重试。");
    }
    if (!(await this.targetExists(item.targetType, item.targetId))) {
      throw new InboxValidationError("正式记录尚未创建，请确认整理内容后重试。");
    }
    return this.finishReserved(id, item.targetType, item.targetId);
  }

  async convert(id: string, conversion: InboxConversion): Promise<InboxItem> {
    const item = await this.repository.findById(id);
    if (!item) {
      throw new InboxValidationError("这条收集记录已不存在。");
    }
    if (item.status === "organized" && item.targetType === conversion.type) {
      return item;
    }
    if (item.status === "archived" || item.status === "organized") {
      throw new InboxValidationError("这条记录已处理，请刷新收集箱后重试。");
    }
    if (item.status === "processing" && item.targetType !== conversion.type) {
      throw new InboxValidationError("这条记录正在转入另一个模块，请先完成原来的整理。");
    }

    const targetId = `inbox-${id}`;
    if (item.status === "processing" && item.targetId !== targetId) {
      throw new InboxValidationError("整理关联不一致，请检查本地数据。");
    }
    if (item.status === "unprocessed" && await this.targetExists(conversion.type, targetId)) {
      throw new InboxValidationError("整理目标标识已被占用，请检查本地数据。");
    }
    // Validate before reserving; the reservation survives partial writes so it can be retried.
    if (item.status === "unprocessed" || !(await this.targetExists(conversion.type, targetId))) {
      await this.validateConversion(conversion);
    }
    if (item.status === "unprocessed") {
      const reserved = await this.repository.reserve(
        id, conversion.type, targetId, this.clock.now().toISOString(),
      );
      if (!reserved) {
        const current = await this.repository.findById(id);
        if (current?.status === "organized" && current.targetType === conversion.type) {
          return current;
        }
        if (current?.status !== "processing" || current.targetType !== conversion.type ||
            current.targetId !== targetId) {
          throw new InboxValidationError("这条记录已变化，请刷新收集箱后重试。");
        }
      }
    }

    const targetExists = await this.targetExists(conversion.type, targetId);
    if (!targetExists) {
      try {
        await this.createTarget(targetId, conversion);
      } catch (error) {
        // A concurrent conversion can win the insert with the same reserved id.
        if (!(await this.targetExists(conversion.type, targetId))) {
          throw error;
        }
      }
    }
    return this.finishReserved(id, conversion.type, targetId);
  }

  private async finishReserved(id: string, type: InboxTarget, targetId: string): Promise<InboxItem> {
    if (!(await this.repository.finish(id, type, targetId, this.clock.now().toISOString()))) {
      const current = await this.repository.findById(id);
      if (current?.status === "organized" && current.targetType === type &&
          current.targetId === targetId) {
        return current;
      }
      throw new InboxValidationError("正式记录已保存，但收集箱未完成标记。请重试这条记录以继续整理。");
    }
    const completed = await this.repository.findById(id);
    if (!completed) {
      throw new InboxValidationError("整理已保存，但无法重新读取收集记录。");
    }
    return completed;
  }

  private async validateConversion(conversion: InboxConversion): Promise<void> {
    // Only pure input rules are translated; repository failures remain storage failures.
    const normalize = () => {
      try {
        return conversion.type === "goal" ? normalizeGoalDraft(conversion.draft)
          : conversion.type === "action" ? normalizeActionDraft(conversion.draft)
            : conversion.type === "review" ? normalizeReviewDraft(conversion.draft)
              : conversion.type === "issue" ? normalizeIssueDraft(conversion.draft)
                : conversion.type === "decision" ? normalizeDecisionDraft(conversion.draft)
                  : conversion.type === "event" ? normalizeEvent(conversion.draft)
                    : normalizePerson(conversion.draft);
      } catch (reason) {
        throw new InboxValidationError(reason instanceof Error ? reason.message : "请检查整理内容后重试。");
      }
    };
    const draft = normalize();
    if ("domainId" in draft && draft.domainId && !(await this.domains.findById(draft.domainId))) {
      throw new InboxValidationError("关联的生活领域已经不存在了。");
    }
    if ("domainIds" in draft && draft.domainIds) {
      for (const domainId of draft.domainIds) {
        if (!(await this.domains.findById(domainId))) {
          throw new InboxValidationError("关联的生活领域已经不存在了。");
        }
      }
    }
    if (conversion.type === "action" && conversion.draft.goalId &&
        !(await this.goals.findById(conversion.draft.goalId))) {
      throw new InboxValidationError("关联的目标已经不存在了。");
    }
    if ((conversion.type === "issue" || conversion.type === "decision" || conversion.type === "event") && conversion.draft.goalId &&
        !(await this.goals.findById(conversion.draft.goalId))) {
      throw new InboxValidationError("关联的目标已经不存在了。");
    }
    if (conversion.type === "event") {
      const personId = conversion.draft.personId;
      if (personId && !(await this.records.listPeople()).some(person => person.id === personId)) {
        throw new InboxValidationError("关联的人物已经不存在了。");
      }
    }
  }

  private async targetExists(type: InboxTarget, id: string): Promise<boolean> {
    switch (type) {
      case "goal": return Boolean(await this.goals.findById(id));
      case "action": return Boolean(await this.actions.findById(id));
      case "review": return Boolean(await this.reviews.findById(id));
      case "issue": return Boolean(await this.issues.findById(id));
      case "decision": return Boolean(await this.decisions.findById(id));
      case "event": return (await this.records.listEvents()).some(event => event.id === id);
      case "person": return (await this.records.listPeople()).some(person => person.id === id);
    }
  }

  private async createTarget(id: string, conversion: InboxConversion): Promise<void> {
    switch (conversion.type) {
      case "goal":
        await this.goals.createWithId(id, conversion.draft);
        break;
      case "action":
        await this.actions.createWithId(id, conversion.draft);
        break;
      case "review":
        await this.reviews.createWithId(id, conversion.draft);
        break;
      case "issue":
        await this.issues.createWithId(id, conversion.draft);
        break;
      case "decision":
        await this.decisions.createWithId(id, conversion.draft);
        break;
      case "event":
        await this.records.createEventWithId(id, conversion.draft);
        break;
      case "person":
        await this.records.createPersonWithId(id, conversion.draft);
        break;
    }
  }
}
