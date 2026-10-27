import type { Decision } from "../../domain/decisions/Decision";

export interface DecisionRepository {
  list(): Promise<readonly Decision[]>;
  findById(id: string): Promise<Decision | null>;
  create(decision: Decision): Promise<void>;
  update(decision: Decision): Promise<void>;
}
