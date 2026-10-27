import { IssueValidationError, normalizeIssueDraft, type Issue, type IssueDraft } from "../../domain/issues/Issue";
import type { IssueRepository } from "../../repositories/issues/IssueRepository";
import type { LifeDomainRepository } from "../../repositories/life/LifeDomainRepository";
import type { GoalRepository } from "../../repositories/planning/GoalRepository";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";

export class IssueRecurrenceRecordedError extends Error {
  constructor() {
    super("已记录再次出现，但无法读取最新问题。请重试读取，不要重复记录。");
  }
}

export class IssueService {
  constructor(
    private readonly repository: IssueRepository,
    private readonly domains: LifeDomainRepository,
    private readonly goals: GoalRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  list(): Promise<readonly Issue[]> {
    return this.repository.list();
  }

  findById(id: string): Promise<Issue | null> {
    return this.repository.findById(id);
  }

  async create(draft: IssueDraft): Promise<Issue> {
    return this.createWithId(this.ids.next(), draft);
  }

  async createWithId(id: string, draft: IssueDraft): Promise<Issue> {
    const normalized = normalizeIssueDraft(draft);
    await this.validateLinks(normalized);
    const timestamp = this.clock.now().toISOString();
    const issue: Issue = { ...normalized, id, createdAt: timestamp, updatedAt: timestamp };
    await this.repository.create(issue);
    return issue;
  }

  async update(id: string, draft: IssueDraft): Promise<Issue> {
    const previous = await this.repository.findById(id);
    if (!previous) throw new IssueValidationError("这个问题已经不存在了。");
    const normalized = normalizeIssueDraft(draft);
    await this.validateLinks(normalized);
    const issue: Issue = { ...previous, ...normalized, updatedAt: this.clock.now().toISOString() };
    await this.repository.update(issue);
    return issue;
  }

  async recordRecurrence(id: string): Promise<Issue> {
    const updated = await this.repository.recordRecurrence(id, this.clock.now().toISOString());
    if (!updated) throw new IssueValidationError("问题已变化或出现次数已达上限，请刷新后重试。");
    try {
      const issue = await this.repository.findById(id);
      if (!issue) throw new IssueRecurrenceRecordedError();
      return issue;
    } catch {
      throw new IssueRecurrenceRecordedError();
    }
  }

  private async validateLinks(draft: IssueDraft): Promise<void> {
    for (const id of draft.domainIds) {
      if (!(await this.domains.findById(id))) {
        throw new IssueValidationError("关联的生活领域已经不存在了。");
      }
    }
    if (draft.goalId && !(await this.goals.findById(draft.goalId))) {
      throw new IssueValidationError("关联的目标已经不存在了。");
    }
  }
}
