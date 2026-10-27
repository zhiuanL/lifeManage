import type { SystemAssessment } from "../../domain/assessments/SystemAssessment";

export interface SystemAssessmentRepository {
  list(): Promise<readonly SystemAssessment[]>;
  save(assessment: SystemAssessment, create: boolean): Promise<boolean>;
}
