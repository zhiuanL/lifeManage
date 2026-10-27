import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { ReviewField } from "../domain/reviews/ReviewStructure";

interface Props { fields: ReviewField[]; disabled: boolean; onChange(fields: ReviewField[]): void }
export function ReviewTemplateEditor({ fields, disabled, onChange }: Props) {
  function update(index: number, value: Partial<ReviewField>) {
    onChange(fields.map((field, i) => i === index ? { ...field, ...value } : field));
  }
  function move(index: number, offset: number) {
    const next = [...fields];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  }
  return <fieldset className="review-edit-fields" disabled={disabled}>
    <legend>复盘字段</legend>
    {fields.map((field, index) => <div key={field.key} className="review-template-field">
      <div className="section-heading">
        <label className="form-field"><span>字段 {index + 1} 名称</span>
          <input value={field.label} maxLength={80} onChange={event => update(index, { label: event.target.value })} /></label>
        <div className="template-actions">
          <button type="button" className="icon-button" title="上移" aria-label={"上移字段 " + (index + 1)} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
          <button type="button" className="icon-button" title="下移" aria-label={"下移字段 " + (index + 1)} disabled={index === fields.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
          <button type="button" className="icon-button" title="删除字段" aria-label={"删除字段 " + (index + 1)} disabled={fields.length === 1} onClick={() => onChange(fields.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
        </div>
      </div>
      <label className="form-field"><span>字段 {index + 1} 默认内容</span>
        <textarea rows={2} maxLength={2000} value={field.defaultValue} onChange={event => update(index, { defaultValue: event.target.value })} /></label>
    </div>)}
    <button type="button" className="button-secondary" disabled={fields.length >= 32} onClick={() => {
      let index = 1;
      while (fields.some(field => field.key === "field_" + index)) index++;
      onChange([...fields, { key: "field_" + index, label: "新字段", defaultValue: "" }]);
    }}><Plus size={16} />添加字段</button>
  </fieldset>;
}

