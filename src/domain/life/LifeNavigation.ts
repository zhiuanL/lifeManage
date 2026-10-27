export const navigationKinds = ["mission", "value", "vision", "principle"] as const;
export type NavigationKind = (typeof navigationKinds)[number];
export const navigationLabels: Record<NavigationKind, string> = {
  mission: "使命", value: "核心价值观", vision: "愿景与长期方向", principle: "个人原则",
};
export interface LifeNavigation {
  id: string; kind: NavigationKind; title: string; description: string;
  archivedAt: string | null; createdAt: string; updatedAt: string;
}
export interface NavigationDraft { title: string; description: string }
export class NavigationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NavigationValidationError";
  }
}
export function normalizeNavigationDraft(draft: NavigationDraft): NavigationDraft {
  const title = draft.title.trim(), description = draft.description.trim();
  if (!title || title.length > 120) throw new NavigationValidationError("标题需为 1 至 120 个字。");
  if (description.length > 6000) throw new NavigationValidationError("内容不能超过 6000 个字。");
  return { title, description };
}
