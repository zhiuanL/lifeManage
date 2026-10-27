import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { AnalyticsRecord } from "../../domain/analytics/Analytics";
import type { DomainAnalyticsComparison } from "../../domain/analytics/AnalyticsComparison";
import { buildDomainMetricTrends } from "../../domain/analytics/DomainMetricTrend";
import type { MetricDefinition, MetricRecord } from "../../domain/life/DomainMetric";
import type { LifeDomain } from "../../domain/life/LifeDomain";
import { MetricTrendView } from "./MetricTrendView";

export function DomainComparisonView({ comparisons, domains, definitions, records, goalId, goalDomainIds }: {
  comparisons: readonly DomainAnalyticsComparison[];
  domains: readonly LifeDomain[];
  definitions: readonly MetricDefinition[];
  records: readonly MetricRecord[];
  goalId: string | null;
  goalDomainIds: readonly string[] | null;
}) {
  if (!comparisons.length) return null;
  const range = comparisons[0].snapshot.weeks;
  const start = range[0].start, end = range[range.length - 1].end;
  const name = (id: string) => domains.find(domain => domain.id === id)!.name;
  const inGoal = (id: string) => !goalId || Boolean(goalDomainIds?.includes(id));
  const trends = buildDomainMetricTrends(definitions, records, null, goalId, start, end)
    .filter(trend => trend.definition.domainIds.some(id => comparisons.some(row => row.domainId === id)));
  return <>
    <section className="analytics-section" aria-labelledby="comparison-summary-heading">
      <div className="section-heading"><div>
        <p className="eyebrow">{start} 至 {end}</p>
        <h2 id="comparison-summary-heading">同周期领域记录</h2>
      </div></div>
      <p className="analytics-note">
        领域按当前明确关联筛选，共享对象可出现在多个领域，不将领域列相加为全局总数。
        排期取当前安排，完成取实际完成日期，两者不是同一批行动的完成率；
        到期比例只纳入有状态历史且截至昨天已到期的有效安排，未知历史不补算。
        习惯只计实际打卡，问题为当前未解决状态。
      </p>
      <div className="analytics-table-scroll"><table className="analytics-table analytics-comparison-table">
        <caption className="sr-only">同一观察周期的领域事实，不含跨领域合计</caption>
        <thead><tr><th scope="col">生活领域</th><th scope="col">当前排期</th>
          <th scope="col">实际完成</th><th scope="col">完成目标</th><th scope="col">复盘记录</th>
          <th scope="col">实际打卡</th><th scope="col">尚未解决</th><th scope="col">到期完成</th></tr></thead>
        <tbody>{comparisons.map(({ domainId, snapshot }) => {
          const count = (key: "planned" | "completed" | "goalsCompleted" | "reviews" | "due" | "onTime") =>
            snapshot.weeks.reduce((sum, week) => sum + week[key].length, 0);
          const due = count("due"), onTime = count("onTime");
          return <tr key={domainId}>
            <th scope="row"><Link to={`/domains/${encodeURIComponent(domainId)}`}>{name(domainId)}
              <ArrowUpRight aria-hidden="true" size={14} /></Link></th>
            {!inGoal(domainId) ? <td colSpan={7}>目标未关联该领域</td> : <>
              <td>{count("planned")}</td><td>{count("completed")}</td><td>{count("goalsCompleted")}</td>
              <td>{count("reviews")}</td>
              <td>{snapshot.habits.reduce((sum, habit) => sum + habit.records.length, 0)}</td>
              <td>{snapshot.openIssues.length}</td>
              <td>{due ? `${onTime}/${due} · ${Math.round(onTime / due * 100)}%` : "无可核验安排"}</td>
            </>}
          </tr>;
        })}</tbody>
      </table></div>
    </section>

    <section className="analytics-section" aria-labelledby="comparison-weeks-heading">
      <div className="section-heading"><h2 id="comparison-weeks-heading">按周对照与来源</h2></div>
      <div className="analytics-table-scroll"><table className="analytics-table analytics-comparison-table">
        <thead><tr><th scope="col">周起始</th>
          {comparisons.map(row => <th scope="col" key={row.domainId}>{name(row.domainId)}</th>)}</tr></thead>
        <tbody>{range.map((week, index) => <tr key={week.start}>
          <th scope="row">{week.start} 至 {week.end}</th>
          {comparisons.map(({ domainId, snapshot }) => {
            if (!inGoal(domainId)) return <td key={domainId}>目标未关联该领域</td>;
            const current = snapshot.weeks[index];
            const groups = [
              { label: "当前排期", records: current.planned },
              { label: "实际完成", records: current.completed },
              { label: "完成目标", records: current.goalsCompleted },
              { label: "复盘", records: current.reviews },
              { label: "到期安排", records: current.due },
              { label: "按期完成", records: current.onTime },
            ];
            return <td key={domainId}>
              <span>排期 {current.planned.length} · 完成 {current.completed.length}</span>
              {groups.some(group => group.records.length) ? <details className="analytics-evidence">
                <summary>查看记录</summary>
                {groups.filter(group => group.records.length).map(group =>
                  <div key={group.label}><span>{group.label} · {group.records.length}</span>
                    <ComparisonRecordLinks records={group.records} /></div>)}
              </details> : null}
            </td>;
          })}
        </tr>)}</tbody>
      </table></div>
      {comparisons.filter(row => inGoal(row.domainId)).map(({ domainId, snapshot }) => <details className="analytics-evidence comparison-supporting"
        key={domainId}>
        <summary>{name(domainId)} · 习惯与问题来源</summary>
        {snapshot.habits.some(fact => fact.records.length) ? snapshot.habits.filter(fact => fact.records.length)
          .map(fact => <div key={fact.habit.id}>
            <Link to={`/habits#habit-${encodeURIComponent(fact.habit.id)}`}>{fact.habit.title}</Link>
            <ComparisonRecordLinks records={fact.records.map(record => ({
              id: record.id, title: record.completed ? "已完成" : "未完成", date: record.recordedOn,
              to: `/habits#habit-log-${encodeURIComponent(record.id)}`,
            }))} />
          </div>) : <p className="context-summary-empty">当前周期没有实际打卡。</p>}
        {snapshot.openIssues.length ? <ComparisonRecordLinks records={snapshot.openIssues.map(issue => ({
          id: issue.id, title: issue.title, date: issue.firstSeen,
          to: `/issues#issue-${encodeURIComponent(issue.id)}`,
        }))} /> : <p className="context-summary-empty">当前没有尚未解决的问题。</p>}
      </details>)}
    </section>

    <section className="analytics-section" aria-labelledby="comparison-metrics-heading">
      <div className="section-heading"><h2 id="comparison-metrics-heading">同期状态指标</h2>
        <Link className="button-secondary" to="/metrics">状态指标</Link></div>
      <p className="analytics-note">各指标保留原始数值与单位，缺失日期不补值，共享指标只展示一次。
        不同指标不折算总分，也不据同期变化推断因果。</p>
      {goalId ? <p className="context-summary-empty">当前选择了目标；领域指标不归属于目标。</p>
        : trends.length ? <div className="metric-trends">{trends.map(trend => <div key={trend.definition.id}>
          <p className="analytics-note">{trend.definition.domainIds.filter(id =>
            comparisons.some(row => row.domainId === id)).map(name).join(" / ")}</p>
          {trend.records.length ? <MetricTrendView trend={trend} domainId={null} start={start} end={end} />
            : <p className="context-summary-empty">{trend.definition.name}（{trend.definition.unit}）· 本周期未记录</p>}
        </div>)}</div> : <p className="context-summary-empty">所选领域尚未关联指标。</p>}
    </section>
  </>;
}

function ComparisonRecordLinks({ records }: { records: readonly AnalyticsRecord[] }) {
  return <ul>{records.map(record => <li key={record.id}>
    <Link to={record.to}>{record.title}<ArrowUpRight aria-hidden="true" size={14} /></Link>
    <time dateTime={record.date}>{record.date}</time>
  </li>)}</ul>;
}
