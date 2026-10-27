import { Link } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { useLifeOS } from "../app/LifeOSContext";
import { useTimelineRead } from "../components/useTimelineRead";

export function PersonRelationshipTimeline({ domainId, personId }: { domainId: string; personId: string }) {
  const { personRelationshipTimelineService } = useLifeOS();
  const { state, reload } = useTimelineRead(personRelationshipTimelineService);
  const entries = state.kind === "ready" ? state.entries.filter(entry =>
    (!personId || entry.personId === personId) && (!domainId || entry.domainIds.includes(domainId))) : [];
  return <section className="record-timeline" id="person-relationships" aria-label="关系变化">
    <header className="section-heading"><h2>关系变化</h2>
      <button type="button" className="icon-button" title="重新读取关系历史"
        aria-label="重新读取关系历史" disabled={state.kind === "loading"} onClick={reload}>
        <RotateCcw size={16} aria-hidden="true" />
      </button>
    </header>
    {state.kind === "loading" ? <p aria-live="polite">正在读取关系历史</p> : null}
    {state.kind === "error" ? <>
      <p role="alert" className="form-error">关系历史读取失败，请重试。</p>
      <button type="button" className="button-secondary" onClick={reload}>重试关系历史</button>
    </> : null}
    {state.kind === "ready" ? entries.length ? <ol>{entries.map(entry =>
      <li key={entry.id} id={entry.id}>
        <time dateTime={entry.changedAt}>{entry.changedAt.slice(0, 10)}</time><span>关系变化</span>
        <Link to={`/people#person-${encodeURIComponent(entry.personId)}`}>{entry.title}</Link>
        <span className="goal-timeline-detail">{entry.detail}</span>
        <details className="domain-history-detail">
          <summary>变更前后</summary>
          <dl>{(["relationshipType", "state"] as const).map(field =>
            entry.change.before[field] !== entry.change.after[field] ? <div key={field}>
              <dt>{field === "state" ? "关系状态" : "关系类型"}</dt><dd>
                <p><span>变更前：</span>{entry.change.before[field] || "未填写"}</p>
                <p><span>变更后：</span>{entry.change.after[field] || "未填写"}</p>
              </dd>
            </div> : null)}</dl>
        </details>
      </li>)}</ol> : <p className="context-summary-empty">当前范围内暂无已记录的关系变化。</p> : null}
  </section>;
}
