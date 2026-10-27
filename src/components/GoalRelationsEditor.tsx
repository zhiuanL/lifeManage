import { Plus, Trash2 } from "lucide-react";
import type { Goal } from "../domain/planning/Goal";
import { goalRelationTypes, goalRelationLabels, type GoalRelation, type GoalRelationType } from "../domain/planning/GoalRelation";

interface Props {
  goalId?: string; goals: readonly Goal[]; relations: readonly GoalRelation[]; disabled?: boolean;
  onChange(relations: GoalRelation[]): void;
}
export function GoalRelationsEditor({ goalId, goals, relations, disabled, onChange }: Props) {
  const options = goals.filter((goal) => goal.id !== goalId);
  return <details className="goal-initial-progress">
    <summary>目标关系{relations.length ? `（${relations.length}）` : ""}</summary>
    <div className="goal-relations-editor">
      {relations.map((relation, index) => <div className="goal-relation-row" key={index}>
        <label className="form-field"><span>关系类型 {index + 1}</span>
          <select disabled={disabled} value={relation.type} onChange={(event) => onChange(relations.map((item, i) =>
            i === index ? { ...item, type: event.target.value as GoalRelationType } : item))}>
            {goalRelationTypes.map((type) => <option key={type} value={type}>{goalRelationLabels[type]}</option>)}
          </select></label>
        <label className="form-field"><span>关联目标 {index + 1}</span>
          <select disabled={disabled} value={relation.targetGoalId} onChange={(event) => onChange(relations.map((item, i) =>
            i === index ? { ...item, targetGoalId: event.target.value } : item))}>
            {options.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
          </select></label>
        <button className="icon-button" type="button" disabled={disabled} title={`移除目标关系 ${index + 1}`}
          aria-label={`移除目标关系 ${index + 1}`} onClick={() => onChange(relations.filter((_, i) => i !== index))}>
          <Trash2 size={16} aria-hidden="true" /></button>
      </div>)}
      <button type="button" className="button-secondary" disabled={disabled || !options.length}
        onClick={() => onChange([...relations, { targetGoalId: options[0].id, type: "related" }])}>
        <Plus size={16} aria-hidden="true" />添加关系</button>
    </div>
  </details>;
}
