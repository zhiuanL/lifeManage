import type { GoalProgressMode } from "../domain/progress/GoalProgressMode";
import type { ReactNode } from "react";

interface Props {
  value: GoalProgressMode;
  onChange(value: GoalProgressMode): void;
  disabled?: boolean;
  expanded?: boolean;
  habitEnabled?: boolean;
  onHabitEnabledChange?(enabled: boolean): void;
  children?: ReactNode;
}

export function GoalProgressModeEditor({ value, onChange, disabled, expanded, habitEnabled, onHabitEnabledChange, children }: Props) {
  return <details className="goal-initial-progress" open={expanded || undefined}
    onInvalidCapture={(event) => { event.currentTarget.open = true; }}>
    <summary>进度设置</summary>
    <label className="form-field"><span>进度方式</span>
      <select disabled={disabled} value={habitEnabled ? "habit" : value === "automatic" ? "automatic" : "exploration"}
        onChange={(event) => {
          onHabitEnabledChange?.(event.target.value === "habit");
          onChange(event.target.value === "habit" ? "automatic" : event.target.value as GoalProgressMode);
        }}>
        <option value="automatic">自动计算</option>
        {onHabitEnabledChange ? <option value="habit">习惯型</option> : null}
        <option value="exploration">探索型</option>
      </select>
    </label>
    {habitEnabled ? children : null}
    {value !== "automatic" ? <label className="issue-domain-option">
      <input type="checkbox" disabled={disabled} checked={value === "exploration_percent"}
        onChange={(event) => onChange(event.target.checked ? "exploration_percent" : "exploration")} />
      <span>显示进度百分比</span>
    </label> : null}
  </details>;
}
