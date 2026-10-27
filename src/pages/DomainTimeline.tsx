import { Link } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { useLifeOS } from "../app/LifeOSContext";
import { domainHistoryFields, domainHistoryStatusLabels } from "../domain/life/DomainHistory";
import { useTimelineRead } from "../components/useTimelineRead";
const labels = ["名称", "说明", "当下关注", "色彩", "图标", "当前状态", "长期期待", "领域状态"];
const colors: Record<string, string> = { ocean: "海蓝", fern: "草绿", coral: "珊瑚", gold: "金黄", violet: "紫罗兰" };
const icons: Record<string, string> = { heart: "健康", briefcase: "工作", users: "关系", wallet: "财务",
  sprout: "成长", home: "生活", "book-open": "学习", sparkles: "灵感" };
function display(field: string, value: string) {
  return (field === "status" ? domainHistoryStatusLabels[value]
    : field === "color_key" ? colors[value] : field === "icon_key" ? icons[value] : value) || "未填写";
}

export function DomainTimeline({ domainId }: { domainId: string }) {
  const { domainTimelineService } = useLifeOS();
  const { state, reload } = useTimelineRead(domainTimelineService);
  const entries = state.kind === "ready" ? state.entries.filter(entry =>
    !domainId || entry.domainId === domainId) : [];
  return <section className="record-timeline" aria-label="领域变化">
    <header className="section-heading"><h2>领域变化</h2>
      <button type="button" className="icon-button" title="重新读取领域历史"
        aria-label="重新读取领域历史" disabled={state.kind === "loading"} onClick={reload}>
        <RotateCcw size={16} aria-hidden="true" />
      </button>
    </header>
    {state.kind === "loading" ? <p aria-live="polite">正在读取领域历史</p> : null}
    {state.kind === "error" ? <>
      <p role="alert" className="form-error">领域历史读取失败，请重试。</p>
      <button type="button" className="button-secondary" onClick={reload}>重试领域历史</button>
    </> : null}
    {state.kind === "ready" ? entries.length ? <ol>{entries.map(entry =>
      <li key={entry.id} id={entry.id}>
        <time dateTime={entry.changedAt}>{entry.changedAt.slice(0, 10)}</time><span>领域变化</span>
        <Link to={`/domains/${encodeURIComponent(entry.domainId)}`}>{entry.title}</Link>
        <span className="goal-timeline-detail">{entry.detail}</span>
        <details className="domain-history-detail">
          <summary>变更前后</summary>
          <dl>{domainHistoryFields.map((field, index) =>
            entry.change.before[field] !== entry.change.after[field] ? <div key={field}>
              <dt>{labels[index]}</dt><dd>
                <p><span>变更前：</span>{display(field, entry.change.before[field])}</p>
                <p><span>变更后：</span>{display(field, entry.change.after[field])}</p>
              </dd>
            </div> : null)}</dl>
        </details>
      </li>)}</ol> : <p className="context-summary-empty">当前范围内暂无已记录的领域变化。</p> : null}
  </section>;
}
