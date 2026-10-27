import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { DomainMetricTrend } from "../../domain/analytics/DomainMetricTrend";

export function MetricTrendView({ trend, domainId, start, end, compact = false }: {
  trend: DomainMetricTrend; domainId: string | null; start: string; end: string; compact?: boolean;
}) {
  const { definition, records } = trend;
  if (!records.length) return null;
  const values = records.map(record => record.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = (max - min || Math.max(Math.abs(max), 1)) * 0.12;
  const lower = min - padding;
  const upper = max + padding;
  const y = (value: number) => 118 - (value - lower) / (upper - lower) * 100;
  const ticks = [...new Set([
    ...(min === max ? [lower, min, upper] : [min, max]),
    ...(lower <= 0 && upper >= 0 ? [0] : []),
  ])].sort((a, b) => b - a);
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const duration = Math.max(1, Date.parse(`${end}T00:00:00Z`) - startTime);
  const left = compact ? 16 : 160;
  const points = records.map(record => ({
    record,
    x: left + (Date.parse(`${record.recordedOn}T00:00:00Z`) - startTime) / duration * (704 - left),
    y: y(record.value),
  }));
  return <div className={`metric-trend${compact ? " metric-trend-compact" : ""}`}>
    <div className="metric-trend-heading">
      {compact ? <span>近 30 天</span> :
        <h3>{definition.name} <span>({definition.unit}){definition.archived ? " · 已归档" : ""}</span></h3>}
      <strong>{records[records.length - 1].value} {definition.unit}</strong>
    </div>
    <div className="metric-trend-scroll" tabIndex={0} role="region" aria-label={`${definition.name}趋势图`}>
    <svg className="metric-trend-chart" viewBox="0 0 720 144" role="img"
      aria-label={`${definition.name}：${records.map(record =>
        `${record.recordedOn} ${record.value} ${definition.unit}`).join("，")}${compact ? "" : `；刻度 ${ticks.join("、")} ${definition.unit}`}`}>
      {!compact ? ticks.map((value) => <g key={value}>
        <line className={value === 0 ? "metric-trend-grid metric-trend-zero" : "metric-trend-grid"}
          x1="160" x2="704" y1={y(value)} y2={y(value)} />
        <text className="metric-trend-tick" x="144" y={y(value) + 4} textAnchor="end">
          {value}<title>{value} {definition.unit}</title>
        </text>
      </g>) : null}
      {points.length > 1 ? <polyline className="metric-trend-line" fill="none"
        points={points.map(point => `${point.x},${point.y}`).join(" ")} /> : null}
      {points.map(point => <circle key={point.record.id} className="metric-trend-point"
        cx={point.x} cy={point.y} r="4"><title>
          {point.record.recordedOn}：{point.record.value} {definition.unit}
        </title></circle>)}
      <text className="metric-trend-tick" x={left} y="140">{start}</text>
      <text className="metric-trend-tick" x="704" y="140" textAnchor="end">{end}</text>
    </svg></div>
    <details className="analytics-evidence">
      <summary>查看来源 ({records.length})</summary>
      <ul>{records.map(record => {
        const targetDomain = domainId && definition.domainIds.includes(domainId) ? domainId : null;
        return <li key={record.id}>
          <Link to={`${targetDomain ? `/domains/${encodeURIComponent(targetDomain)}` : "/metrics"}#metric-record-${encodeURIComponent(record.id)}`}>
            {record.recordedOn} · {record.value} {definition.unit}
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
          {record.note ? <span>{record.note}</span> : null}
        </li>;
      })}</ul>
    </details>
  </div>;
}
