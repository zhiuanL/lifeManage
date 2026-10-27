import type { InboxItem, InboxStatus, InboxTarget } from "../../domain/inbox/InboxItem";

export interface InboxRepository {
  list(): Promise<readonly InboxItem[]>;
  findById(id: string): Promise<InboxItem | null>;
  create(item: InboxItem): Promise<void>;
  changeStatus(id: string, from: InboxStatus, to: InboxStatus, updatedAt: string): Promise<boolean>;
  reserve(id: string, target: InboxTarget, targetId: string, updatedAt: string): Promise<boolean>;
  finish(id: string, target: InboxTarget, targetId: string, updatedAt: string): Promise<boolean>;
}
