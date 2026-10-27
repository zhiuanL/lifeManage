export const resourceKinds = ["time", "energy", "skill", "person", "finance", "tool"] as const;
export type ResourceKind = (typeof resourceKinds)[number];
export class ResourceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceValidationError";
  }
}
export const resourceKindLabels: Record<ResourceKind, string> = {
  time: "时间", energy: "精力", skill: "能力", person: "人物",
  finance: "财务", tool: "工具",
};
export interface ResourceNeedDraft {
  goalId: string | null;
  decisionId?: string | null;
  kind: ResourceKind;
  description: string;
  skillId: string | null;
  personId: string | null;
  met: boolean;
}
export interface ResourceNeed extends ResourceNeedDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
}
export function normalizeNeed(draft: ResourceNeedDraft): ResourceNeedDraft {
  const description = draft.description.trim();
  if (Boolean(draft.goalId) === Boolean(draft.decisionId) || !resourceKinds.includes(draft.kind) ||
      !description || description.length > 300) {
    throw new ResourceValidationError("请选择一个目标或决策与资源类型，并填写 1 至 300 字的需求。");
  }
  if ((draft.skillId && draft.kind !== "skill") || (draft.personId && draft.kind !== "person")) {
    throw new ResourceValidationError("资源引用与需求类型不匹配。");
  }
  return { ...draft, goalId: draft.goalId || null, decisionId: draft.decisionId || null, description, skillId: draft.skillId || null,
    personId: draft.personId || null };
}
