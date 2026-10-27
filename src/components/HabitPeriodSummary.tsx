import { useState } from "react";
import type { Habit, HabitLog } from "../domain/habits/Habit";
import { calculateHabitPeriodProgress } from "../domain/habits/HabitPeriodProgress";

export function HabitPeriodSummary({ habit, logs, today }: {
  habit: Habit; logs: readonly HabitLog[]; today: string;
}) {
  const [startOn, setStartOn] = useState(habit.startOn);
  const [endOn, setEndOn] = useState(today);
  let result;
  let error = "";
  try { result = calculateHabitPeriodProgress(habit, logs, startOn, endOn, today); }
  catch (reason) { error = reason instanceof Error ? reason.message : "无法计算周期进度。"; }
  return <details className="habit-details">
    <summary>周期统计</summary>
    <div className="habit-log-fields">
      <label className="form-field"><span>周期开始</span>
        <input type="date" value={startOn} onChange={(event) => setStartOn(event.target.value)} /></label>
      <label className="form-field"><span>周期结束</span>
        <input type="date" value={endOn} onChange={(event) => setEndOn(event.target.value)} /></label>
    </div>
    {error ? <p role="alert" className="form-error">{error}</p> : result ?
      <div className="habit-summary" aria-live="polite">
        <span>已记录完整周 <strong>{result.recordedWeeks}</strong></span>
        <span>完成次数 <strong>{result.completed}/{result.expected}</strong></span>
        <span>周期完成率 <strong>{result.percent === null ? "暂无" : `${result.percent}%`}</strong></span>
      </div> : null}
  </details>;
}
