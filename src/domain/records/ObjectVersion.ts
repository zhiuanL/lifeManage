export const versionTypes = ["goal", "review", "issue", "decision", "navigation", "action", "role"] as const;
export type VersionType = (typeof versionTypes)[number];
export const versionLabels: Record<VersionType, string> = {
  action: "行动反馈", goal: "目标", review: "回顾", issue: "问题", decision: "决策", navigation: "人生导航", role: "身份角色",
};

export interface ObjectVersion {
  id: number;
  type: VersionType;
  objectId: string;
  changedAt: string;
  snapshot: Record<string, unknown>;
}
