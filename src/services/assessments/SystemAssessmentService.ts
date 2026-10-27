import { normalizeAssessment, type AssessmentDraft, type SystemAssessment
} from "../../domain/assessments/SystemAssessment";
import type { SystemAssessmentRepository } from "../../repositories/assessments/SystemAssessmentRepository";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";

export class SystemAssessmentService {
  constructor(private readonly repo: SystemAssessmentRepository, private readonly clock: Clock,
    private readonly ids: IdGenerator) {}
  async list(): Promise<readonly SystemAssessment[]> {
    return this.repo.list();
  }
  async save(draft: AssessmentDraft): Promise<SystemAssessment> {
    const normalized = normalizeAssessment(draft);
    const existing = (await this.list()).find((item) =>
      item.periodKind === normalized.periodKind && item.periodStart === normalized.periodStart);
    const now = this.clock.now().toISOString();
    const assessment = { ...normalized, id: existing?.id ?? this.ids.next(),
      createdAt: existing?.createdAt ?? now, updatedAt: now };
    if (!(await this.repo.save(assessment, !existing))) throw new Error("评估保存失败，请重试。");
    return assessment;
  }
}
