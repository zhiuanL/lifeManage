import { Plus, Trash2 } from "lucide-react";
import { progressItemKinds, progressItemLabels, type ProgressItemKind } from
  "../domain/progress/GoalProgressItem";
import type { EditableProgressItem } from "../services/planning/GoalProgressItemService";

export function ProgressItemsEditor({ items, onChange, disabled = false }: {
  items: readonly EditableProgressItem[];
  onChange(items: EditableProgressItem[]): void;
  disabled?: boolean;
}) {
  const update = (index: number, patch: Partial<EditableProgressItem>) =>
    onChange(items.map((item, i) => i === index ? { ...item, ...patch } : item));

  return <>
    <div className="progress-items-editor">
      {items.map((item, index) => <fieldset className="progress-item-editor"
        key={item.id ?? `new-${index}`} disabled={disabled}>
        <legend>进度项 {index + 1}</legend>
        <button type="button" className="icon-button progress-remove" title="移除进度项"
          aria-label={`移除进度项 ${index + 1}`}
          onClick={() => onChange(items.filter((_, i) => i !== index))}>
          <Trash2 size={16} aria-hidden="true" />
        </button>
        <div className="planning-form-grid">
          <label className="form-field"><span>类型</span>
            <select value={item.kind} onChange={(event) =>
              update(index, { kind: event.target.value as ProgressItemKind })}>
              {progressItemKinds.map((kind) =>
                <option key={kind} value={kind}>{progressItemLabels[kind]}</option>)}
            </select>
          </label>
          <label className="form-field"><span>名称</span>
            <input required maxLength={80} value={item.title}
              onChange={(event) => update(index, { title: event.target.value })} />
          </label>
        </div>
        <div className="progress-item-numbers">
          <label className="form-field"><span>当前值</span>
            <input type="number" min="0" max="1000000000" step="any" required
              value={Number.isFinite(item.currentValue) ? item.currentValue : ""}
              onChange={(event) => update(index, { currentValue: event.target.valueAsNumber })} />
          </label>
          <label className="form-field"><span>目标值</span>
            <input type="number" min="0.000001" max="1000000000" step="any" required
              value={Number.isFinite(item.targetValue) ? item.targetValue : ""}
              onChange={(event) => update(index, { targetValue: event.target.valueAsNumber })} />
          </label>
          <label className="form-field"><span>权重</span>
            <input type="number" min="0.000001" max="100" step="any" required
              value={Number.isFinite(item.weight) ? item.weight : ""}
              onChange={(event) => update(index, { weight: event.target.valueAsNumber })} />
          </label>
        </div>
      </fieldset>)}
    </div>
    <button className="button-secondary" type="button" disabled={disabled || items.length >= 30}
      onClick={() => onChange([...items, {
        kind: "key_result", title: "", targetValue: 1, currentValue: 0, weight: 1,
      }])}>
      <Plus size={16} aria-hidden="true" />添加进度项
    </button>
  </>;
}
