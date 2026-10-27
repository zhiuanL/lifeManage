import { GoalValidationError, type Goal } from "./Goal";

export const goalRelationTypes = ["support", "depend", "conflict", "related"] as const;
export type GoalRelationType = (typeof goalRelationTypes)[number];
export interface GoalRelation { targetGoalId: string; type: GoalRelationType }
export const goalRelationLabels: Record<GoalRelationType, string> = {
  support: "支持", depend: "依赖", conflict: "冲突", related: "相关",
};
export function isSymmetricRelation(type: GoalRelationType): boolean {
  return type === "conflict" || type === "related";
}
export function relationKey(source: string, target: string, type: GoalRelationType): string {
  const pair = isSymmetricRelation(type) ? [source, target].sort() : [source, target];
  return JSON.stringify([...pair, type]);
}
export function validateGoalRelations(id: string, relations: readonly GoalRelation[], goals: readonly Goal[]): GoalRelation[] {
  const byId = new Map(goals.map((goal) => [goal.id, goal]));
  const seen = new Set<string>();
  return relations.map((relation) => {
    if (!goalRelationTypes.includes(relation.type) || typeof relation.targetGoalId !== "string") {
      throw new GoalValidationError("请选择有效的目标关系。");
    }
    const targetGoalId = relation.targetGoalId.trim();
    if (targetGoalId === id) throw new GoalValidationError("目标不能关联自己。");
    const target = byId.get(targetGoalId);
    if (!target) throw new GoalValidationError("关联目标已不存在，请重新选择。");
    const key = relationKey(id, targetGoalId, relation.type);
    if (seen.has(key) || (isSymmetricRelation(relation.type) &&
      target.relations?.some((item) => item.targetGoalId === id && item.type === relation.type))) {
      throw new GoalValidationError("这个目标关系已存在。");
    }
    seen.add(key);
    return { targetGoalId, type: relation.type };
  });
}
export function visibleGoalRelations(goal: Goal, goals: readonly Goal[]) {
  const outgoing = (goal.relations ?? []).map((relation) => ({
    goalId: relation.targetGoalId, label: goalRelationLabels[relation.type], type: relation.type,
  }));
  const incoming = goals.flatMap((source) => (source.relations ?? [])
    .filter((relation) => relation.targetGoalId === goal.id)
    .map((relation) => ({ goalId: source.id, type: relation.type,
      label: relation.type === "support" ? "被支持" : relation.type === "depend" ? "被依赖" : goalRelationLabels[relation.type],
    })));
  return [...outgoing, ...incoming];
}
