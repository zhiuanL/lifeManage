import { Link } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { useLifeOS } from "../app/LifeOSContext";
import { useTimelineRead } from "../components/useTimelineRead";

export function GoalTimeline({ domainId }: { domainId: string }) {
  const { goalTimelineService } = useLifeOS();
  const { state, reload } = useTimelineRead(goalTimelineService);
  const entries = state.kind === "ready" ? state.entries.filter(entry =>
    !domainId || entry.domainIds.includes(domainId)) : [];
  return <section className="record-timeline" aria-label="目标调整与阶段成果">
    <header className="section-heading">
      <h2>目标调整与阶段成果</h2>
      <button type="button" className="icon-button" title="重新读取目标历史"
        aria-label="重新读取目标历史" disabled={state.kind === "loading"} onClick={reload}>
        <RotateCcw size={16} aria-hidden="true" />
      </button>
    </header>
    {state.kind === "loading" ? <p aria-live="polite">正在读取目标历史</p> : null}
    {state.kind === "error" ? <>
      <p role="alert" className="form-error">目标历史读取失败，请重试。</p>
      <button type="button" className="button-secondary" onClick={reload}>重试目标历史</button>
    </> : null}
    {state.kind === "ready" ? entries.length ? <ol>{entries.map(entry =>
      <li key={entry.id} id={entry.id}>
        <time dateTime={entry.changedAt}>{entry.changedAt.slice(0, 10)}</time>
        <span>{entry.label}</span>
        <Link to={`/goals#goal-${encodeURIComponent(entry.goalId)}`}>{entry.title}</Link>
        <span className="goal-timeline-detail">{entry.detail}</span>
        <Link to={`/history?type=goal&id=${encodeURIComponent(entry.goalId)}`}>版本历史</Link>
      </li>)}</ol> : <p className="context-summary-empty">当前范围内暂无已记录的目标调整或阶段成果。</p> : null}
  </section>;
}
