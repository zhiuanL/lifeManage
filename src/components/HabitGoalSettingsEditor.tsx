import { Plus, Trash2 } from "lucide-react";
import { localDate, type Habit } from "../domain/habits/Habit";
import type { HabitGoalProgressSetting } from "../domain/progress/HabitGoalProgress";

interface Props {
  settings: readonly HabitGoalProgressSetting[];
  habits: readonly Habit[];
  onChange(settings: HabitGoalProgressSetting[]): void;
  disabled?: boolean;
}

export function HabitGoalSettingsEditor({ settings, habits, onChange, disabled }: Props) {
  const available = habits.filter((habit) => !habit.archived &&
    !settings.some((setting) => setting.habitId === habit.id));
  const update = (index: number, changes: Partial<HabitGoalProgressSetting>) =>
    onChange(settings.map((setting, position) => position === index ? { ...setting, ...changes } : setting));
  return <div className="habit-goal-settings">
    {settings.map((setting, index) => <fieldset key={index} className="habit-goal-setting" disabled={disabled}>
      <legend>关联习惯 {index + 1}</legend>
      <div className="habit-goal-setting-heading">
        <label className="form-field"><span>习惯</span>
          <select required value={setting.habitId} onChange={(event) => update(index, { habitId: event.target.value })}>
            {!setting.habitId ? <option value="">请选择习惯</option> : null}
            {setting.habitId && !habits.some((habit) => habit.id === setting.habitId)
              ? <option value={setting.habitId}>习惯已不可用</option> : null}
            {habits.filter((habit) => habit.id === setting.habitId || (!habit.archived &&
              !settings.some((item) => item.habitId === habit.id))).map((habit) =>
              <option key={habit.id} value={habit.id}>{habit.title}{habit.archived ? "（已归档）" : ""}</option>)}
          </select>
        </label>
        <button className="icon-button" type="button" title="移除关联" aria-label={`移除关联习惯 ${index + 1}`}
          onClick={() => onChange(settings.filter((_, position) => position !== index))}>
          <Trash2 aria-hidden="true" size={17} />
        </button>
      </div>
      <div className="planning-form-grid">
        <label className="form-field"><span>统计开始</span>
          <input required type="date" value={setting.startOn} max={setting.endOn || undefined}
            onChange={(event) => update(index, { startOn: event.target.value })} />
        </label>
        <label className="form-field"><span>统计结束</span>
          <input required type="date" value={setting.endOn} min={setting.startOn || undefined}
            onChange={(event) => update(index, { endOn: event.target.value })} />
        </label>
        <label className="form-field"><span>每周期望次数</span>
          <input required type="number" min={1} max={7} step={1} value={Number.isFinite(setting.weeklyTarget) ? setting.weeklyTarget : ""}
            onChange={(event) => update(index, { weeklyTarget: event.target.valueAsNumber })} />
        </label>
        <label className="form-field"><span>权重</span>
          <input required type="number" min={0} max={100} step="any" value={Number.isFinite(setting.weight) ? setting.weight : ""}
            onChange={(event) => update(index, { weight: event.target.valueAsNumber })} />
        </label>
      </div>
    </fieldset>)}
    <button type="button" className="button-secondary" disabled={disabled || !available.length || settings.length >= 30}
      onClick={() => {
        const habit = available[0];
        if (habit) onChange([...settings, { habitId: habit.id, startOn: habit.startOn,
          endOn: localDate(new Date()), weeklyTarget: habit.weeklyTarget, weight: 1 }]);
      }}>
      <Plus aria-hidden="true" size={16} />关联习惯
    </button>
  </div>;
}
