import { Plus, Trash2 } from "lucide-react";
import type { PersonDate } from "../domain/records/LifeRecords";

export function PersonDatesEditor({ dates, onChange }: {
  dates: readonly PersonDate[]; onChange(dates: PersonDate[]): void;
}) {
  const birthday = dates.find(date => date.kind === "birthday");
  const important = dates.map((date, index) => ({ date, index }))
    .filter(entry => entry.date.kind === "important");
  const change = (index: number, patch: Partial<PersonDate>) =>
    onChange(dates.map((date, position) => position === index ? { ...date, ...patch } : { ...date }));
  return <details className="habit-optional" open={dates.length > 0}>
    <summary>生日与其他重要日期</summary>
    <label className="form-field"><span>生日</span>
      <input type="date" value={birthday?.date ?? ""} onChange={event => {
        const other = dates.filter(date => date.kind !== "birthday").map(date => ({ ...date }));
        onChange(event.target.value
          ? [{ kind: "birthday", label: "生日", date: event.target.value }, ...other] : other);
      }} /></label>
    <div className="person-date-list">
      {important.map(({ date, index }, order) => <div className="person-date-row" key={index}>
        <label className="form-field"><span>日期名称 {order + 1}</span>
          <input required maxLength={80} value={date.label}
            onChange={event => change(index, { label: event.target.value })} /></label>
        <label className="form-field"><span>日期 {order + 1}</span>
          <input type="date" required value={date.date}
            onChange={event => change(index, { date: event.target.value })} /></label>
        <button type="button" className="icon-button" title={`删除日期 ${order + 1}`}
          aria-label={`删除日期 ${order + 1}`}
          onClick={() => onChange(dates.filter((_, position) => position !== index).map(date => ({ ...date })))}>
          <Trash2 size={16} aria-hidden="true" /></button>
      </div>)}
    </div>
    <button type="button" className="button-secondary" disabled={important.length >= 20}
      onClick={() => onChange([...dates.map(date => ({ ...date })),
        { kind: "important", label: "", date: "" }])}>
      <Plus size={16} aria-hidden="true" />添加日期</button>
  </details>;
}
