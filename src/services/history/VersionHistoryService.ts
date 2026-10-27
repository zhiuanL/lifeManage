import { normalizeReviewStructure, type ReviewStructure } from "../../domain/reviews/ReviewStructure";
import { versionTypes, type ObjectVersion, type VersionType } from "../../domain/records/ObjectVersion";
import type { ObjectVersionRepository } from "../../repositories/history/ObjectVersionRepository";
import type { IdentityRoleService } from "../life/IdentityRoleService";

export { versionTypes, versionLabels, type ObjectVersion, type VersionType } from "../../domain/records/ObjectVersion";

export class VersionHistoryService {
  constructor(private readonly repo: ObjectVersionRepository, private readonly roles?: IdentityRoleService) {}

  async list(type: VersionType, id: string): Promise<readonly ObjectVersion[]> {
    if (!versionTypes.includes(type) || !id) throw new Error("请选择有效的记录。");
    if (type === "role") {
      if (!this.roles) throw new Error("身份角色历史暂不可用。");
      return (await this.roles.listHistory(id)).map(item => ({
        id: item.version, type, objectId: item.roleId, changedAt: item.changedAt, snapshot: item.snapshot,
      }));
    }
    return this.repo.list(type, id);
  }
}

export function reviewHistoryStructure(snapshot: Record<string, unknown>): ReviewStructure | null {
  const columns = ["review_type", "period_start", "period_end", "review_status", "review_mode", "template_snapshot"];
  if (columns.every(key => snapshot[key] === undefined) && snapshot.answers === undefined) return null;
  if (columns.every(key => snapshot[key] === null) && Array.isArray(snapshot.answers) && !snapshot.answers.length) return null;
  if (columns.some(key => typeof snapshot[key] !== "string")) throw new Error("复盘历史元数据不完整。");
  if (!Array.isArray(snapshot.answers)) throw new Error("复盘历史答案缺失。");
  const answers: Record<string, string> = Object.create(null);
  for (const item of snapshot.answers) {
    if (!item || typeof item !== "object" || typeof item.field_key !== "string" ||
        typeof item.value !== "string" || Object.prototype.hasOwnProperty.call(answers, item.field_key)) {
      throw new Error("复盘历史答案无效。");
    }
    answers[item.field_key] = item.value;
  }
  const structure = normalizeReviewStructure({
    type: snapshot.review_type, start: snapshot.period_start, end: snapshot.period_end,
    status: snapshot.review_status, mode: snapshot.review_mode,
    template: JSON.parse(String(snapshot.template_snapshot)), answers,
  });
  if (structure.template.fields.some(field => !Object.prototype.hasOwnProperty.call(answers, field.key))) {
    throw new Error("复盘历史答案缺失。");
  }
  return structure;
}
