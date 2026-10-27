import type { Issue } from "../../domain/issues/Issue";

export interface IssueRepository {
  list(): Promise<readonly Issue[]>;
  findById(id: string): Promise<Issue | null>;
  create(issue: Issue): Promise<void>;
  update(issue: Issue): Promise<void>;
  recordRecurrence(id: string, updatedAt: string): Promise<boolean>;
}
