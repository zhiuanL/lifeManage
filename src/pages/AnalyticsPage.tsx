import { ArrowUpRight, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import type { AnalyticsData, AnalyticsRecord, AnalyticsWeeks } from "../domain/analytics/Analytics";
import { buildDomainMetricTrends } from "../domain/analytics/DomainMetricTrend";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { MetricDefinition, MetricRecord } from "../domain/life/DomainMetric";
import { actionFeedbackFields } from "../domain/planning/ActionDetails";
import type { HabitAnalyticsFact } from "../domain/analytics/SupportingAnalyticsFacts";
import { reviewTypeLabels } from "../domain/reviews/ReviewStructure";
import { DomainComparisonView } from "../components/analytics/DomainComparisonView";
import { MetricTrendView } from "../components/analytics/MetricTrendView";

const issueStateLabels = { open: "待处理", watching: "观察中", resolved: "已解决" };

type PageState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: AnalyticsData; domains: readonly LifeDomain[];
      definitions: readonly MetricDefinition[]; records: readonly MetricRecord[] };

const weekChoices: readonly AnalyticsWeeks[] = [4, 8, 12];

export function AnalyticsPage() {
  const { analyticsService, lifeDomainService, domainMetricService } = useLifeOS();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const mounted = useRef(false);
  const requests = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requests.current += 1; };
  }, []);

  const load = useCallback(async (): Promise<PageState> => {
    try {
      const [data, domains, definitions, records] = await Promise.all([
        analyticsService.loadData(), lifeDomainService.list(),
        domainMetricService.listDefinitions(), domainMetricService.listRecords(),
      ]);
      return { kind: "ready", data, domains, definitions, records };
    } catch {
      return { kind: "error", message: "分析数据读取失败，请重试。" };
    }
  }, [analyticsService, lifeDomainService, domainMetricService]);

  const [result, setResult] = useState<{ source: typeof load; state: PageState } | null>(null);
  const state: PageState = result?.source === load ? result.state : { kind: "loading" };

  useEffect(() => {
    const request = ++requests.current;
    void load().then((next) => {
      if (mounted.current && request === requests.current) setResult({ source: load, state: next });
    });
    return () => { requests.current += 1; };
  }, [load]);

  const reload = () => {
    if (!mounted.current) return;
    const request = ++requests.current;
    setResult({ source: load, state: { kind: "loading" } });
    void load().then((next) => {
      if (mounted.current && request === requests.current) setResult({ source: load, state: next });
    });
  };

  function updateParams(next: URLSearchParams, replace = false) {
    navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, { replace });
  }

  function changeFilter(key: "domain" | "goal" | "weeks", value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "domain") next.delete("goal");
    updateParams(next);
  }

  function changeMode(compare: boolean) {
    if (compare === (params.get("view") === "compare")) return;
    const next = new URLSearchParams(params);
    next.delete("goal");
    next.delete("compareDomain");
    if (compare) {
      next.set("view", "compare");
      const current = params.get("domain");
      if (current) next.append("compareDomain", current);
      next.delete("domain");
    } else {
      next.delete("view");
    }
    updateParams(next);
  }

  if (state.kind === "loading") {
    return <div className="context-loading" aria-live="polite">正在整理已有记录</div>;
  }
  if (state.kind === "error") {
    return <section className="not-found-page">
      <p className="eyebrow">读取失败</p>
      <h1>暂时无法打开分析</h1>
      <p className="page-intro">{state.message}</p>
      <button className="button-secondary" type="button" onClick={reload}>重试</button>
    </section>;
  }

  const { data, domains } = state;
  const comparing = params.get("view") === "compare";
  const comparedIds = [...new Set(params.getAll("compareDomain"))];
  const invalidComparedIds = comparedIds.filter(id => !domains.some(domain => domain.id === id));
  const requestedDomainId = params.get("domain");
  const domainId = domains.some((domain) => domain.id === requestedDomainId)
    ? requestedDomainId : null;
  const availableGoals = data.goals.filter((goal) => comparing
    ? goal.domainIds.some(id => comparedIds.includes(id))
    : !domainId || goal.domainIds.includes(domainId));
  const requestedGoalId = params.get("goal");
  const goalId = availableGoals.some((goal) => goal.id === requestedGoalId)
    ? requestedGoalId : null;
  const invalidDomain = !comparing && requestedDomainId !== null && domainId === null;
  const invalidGoal = requestedGoalId !== null && goalId === null;
  if (invalidDomain || invalidGoal || (comparing && invalidComparedIds.length)) {
    return <section className="not-found-page">
      <p className="eyebrow">筛选已失效</p>
      <h1>无法按当前条件分析</h1>
      <p className="page-intro">
        {invalidDomain || (comparing && invalidComparedIds.length)
          ? "链接中的生活领域已不存在或未指定。"
          : "链接中的目标已不存在，或不属于当前领域。"}
        清除失效筛选后可重新查看记录。
      </p>
      <button className="button-secondary" type="button" onClick={() => {
        const next = new URLSearchParams(params);
        if (invalidDomain) next.delete("domain");
        if (comparing && invalidComparedIds.length) {
          next.delete("compareDomain");
          comparedIds.filter(id => !invalidComparedIds.includes(id))
            .forEach(id => next.append("compareDomain", id));
        }
        if (invalidGoal) next.delete("goal");
        updateParams(next, true);
      }}>清除失效筛选</button>
    </section>;
  }
  const requestedWeeks = Number(params.get("weeks"));
  const weeks = weekChoices.find((choice) => choice === requestedWeeks) ?? 8;
  const heading = <section className="planning-heading analytics-heading">
    <div><p className="eyebrow">记录中的变化</p><h1>分析</h1></div>
    <button className="icon-button" type="button" title="重新读取" aria-label="重新读取分析"
      onClick={reload}><RotateCw aria-hidden="true" size={18} /></button>
  </section>;
  const modeControl = <div className="analytics-modes" role="group" aria-label="分析视图">
    <button type="button" aria-pressed={!comparing} onClick={() => changeMode(false)}>记录分析</button>
    <button type="button" aria-pressed={comparing} onClick={() => changeMode(true)}>多领域对比</button>
  </div>;
  if (comparing) {
    const comparisons = analyticsService.compare(data, { domainIds: comparedIds, goalId, weeks });
    return <>
      {heading}
      <section className="analytics-workspace" aria-label="多领域对比">
        {modeControl}
        <div className="attention-filters">
          <label className="attention-control"><span>关联目标</span>
            <select value={goalId ?? ""} onChange={event => changeFilter("goal", event.target.value)}>
              <option value="">全部目标</option>
              {availableGoals.map(goal => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
            </select>
          </label>
          <label className="attention-control"><span>观察周期</span>
            <select value={weeks} onChange={event => changeFilter("weeks", event.target.value)}>
              {weekChoices.map(count => <option key={count} value={count}>最近 {count} 周</option>)}
            </select>
          </label>
        </div>
        <fieldset className="analytics-domain-choices">
          <legend>对比领域</legend>
          {domains.map(domain => <label key={domain.id}>
            <input type="checkbox" checked={comparedIds.includes(domain.id)} onChange={event => {
              const next = new URLSearchParams(params);
              const selected = event.target.checked ? [...comparedIds, domain.id]
                : comparedIds.filter(id => id !== domain.id);
              next.delete("compareDomain");
              selected.forEach(id => next.append("compareDomain", id));
              if (goalId && !data.goals.find(goal => goal.id === goalId)?.domainIds.some(id => selected.includes(id))) {
                next.delete("goal");
              }
              updateParams(next);
            }} />
            <span>{domain.name}</span>
          </label>)}
        </fieldset>
        {comparedIds.length < 2
          ? <p className="context-summary-empty">{domains.length < 2
            ? "至少需要两个生活领域才能对比。" : "尚未选择两个对比领域。"}</p>
          : <DomainComparisonView comparisons={comparisons} domains={domains}
            definitions={state.definitions} records={state.records} goalId={goalId}
            goalDomainIds={data.goals.find(goal => goal.id === goalId)?.domainIds ?? null} />}
      </section>
    </>;
  }
  const snapshot = analyticsService.summarize(data, { domainId, goalId, weeks });
  const totals = snapshot.weeks.reduce((result, week) => ({
    planned: result.planned + week.planned.length,
    completed: result.completed + week.completed.length,
    goals: result.goals + week.goalsCompleted.length,
    reviews: result.reviews + week.reviews.length,
  }), { planned: 0, completed: 0, goals: 0, reviews: 0 });
  const max = Math.max(1, ...snapshot.weeks.flatMap((week) => [
    week.planned.length, week.completed.length,
  ]));
  const hasHistory = totals.planned + totals.completed + totals.goals + totals.reviews > 0;
  const dueTotal = snapshot.weeks.reduce((sum, week) => sum + week.due.length, 0);
  const onTimeTotal = snapshot.weeks.reduce((sum, week) => sum + week.onTime.length, 0);
  const trends = buildDomainMetricTrends(state.definitions, state.records, domainId, goalId,
    snapshot.weeks[0].start, snapshot.weeks[snapshot.weeks.length - 1].end);

  return (
    <>
      {heading}

      <section className="analytics-workspace" aria-label="记录分析">
        {modeControl}
        <div className="attention-filters">
          <label className="attention-control">
            <span>生活领域</span>
            <select value={domainId ?? ""} onChange={(event) => changeFilter("domain", event.target.value)}>
              <option value="">全部领域</option>
              {domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.name}</option>)}
            </select>
          </label>
          <label className="attention-control">
            <span>关联目标</span>
            <select value={goalId ?? ""} onChange={(event) => changeFilter("goal", event.target.value)}>
              <option value="">全部目标</option>
              {availableGoals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
            </select>
          </label>
          <label className="attention-control">
            <span>观察周期</span>
            <select value={weeks} onChange={(event) => changeFilter("weeks", event.target.value)}>
              {weekChoices.map((count) => <option key={count} value={count}>最近 {count} 周</option>)}
            </select>
          </label>
        </div>

        <section className="analytics-section" aria-labelledby="analytics-actions-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">按周 · 截至今天</p>
              <h2 id="analytics-actions-heading">行动的排期与完成</h2>
            </div>
          </div>
          <p className="analytics-note">
            排期取行动<strong>当前</strong>安排的日期；完成取实际标记完成的日期。
            这两列不是同一批行动的完成率。下面的对照只使用完成瞬间记录的安排；
            迁移前已完成行动不补造历史，完成时未安排日期的行动不参与对照。
            领域与目标按行动当前关联筛选。
            目标仅统计当前仍为已完成且留有完成时间的记录。
          </p>
          {hasHistory ? (
            <>
              <div className="analytics-legend" aria-hidden="true">
                <span className="analytics-key planned" />当前排期
                <span className="analytics-key completed" />实际完成
              </div>
              <div className="analytics-chart-scroll">
                <div className="analytics-chart" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(68px, 1fr))` }}
                  role="img" aria-label={`最近 ${weeks} 周行动的当前排期和实际完成数量，详细数字见下方记录`}>
                  {snapshot.weeks.map((week) => <div className="analytics-column" key={week.start}>
                    <div className="analytics-bars" aria-hidden="true">
                      <span className="analytics-bar planned" style={{ height: `${week.planned.length / max * 100}%` }} />
                      <span className="analytics-bar completed" style={{ height: `${week.completed.length / max * 100}%` }} />
                    </div>
                    <span className="analytics-week-label">{week.start.slice(5)}</span>
                  </div>)}
                </div>
              </div>
              <div className="analytics-table-scroll">
                <table className="analytics-table">
                  <thead><tr><th scope="col">周起始</th><th scope="col">当前排期</th>
                    <th scope="col">实际完成</th><th scope="col">完成目标</th>
                    <th scope="col">回顾</th><th scope="col">来源</th></tr></thead>
                  <tbody>
                    {snapshot.weeks.map((week) => {
                      const groups = [
                        { label: "当前排期", records: week.planned },
                        { label: "实际完成", records: week.completed },
                        { label: "完成目标", records: week.goalsCompleted },
                        { label: "回顾", records: week.reviews },
                      ];
                      const count = groups.reduce((sum, group) => sum + group.records.length, 0);
                      return <tr key={week.start}>
                        <th scope="row">{week.start} 至 {week.end}</th>
                        <td>{week.planned.length}</td><td>{week.completed.length}</td>
                        <td>{week.goalsCompleted.length}</td>
                        <td>{week.reviews.length}</td>
                        <td>{count ? <details className="analytics-evidence">
                          <summary>查看记录</summary>
                          {groups.filter((group) => group.records.length).map((group) =>
                            <div key={group.label}>
                              <span>{group.label}</span>
                              <RecordLinks records={group.records} />
                            </div>)}
                        </details> : <span className="analytics-dash">-</span>}</td>
                      </tr>;
                    })}
                  </tbody>
                  <tfoot><tr><th scope="row">合计</th><td>{totals.planned}</td>
                    <td>{totals.completed}</td><td>{totals.goals}</td>
                    <td>{totals.reviews}</td><td /></tr></tfoot>
                </table>
              </div>
            </>
          ) : (
            <div className="planning-empty">
              <p>这段时间还没有可按日期汇总的记录，留白也没关系。</p>
              <Link className="button-secondary" to="/goals">查看目标与行动</Link>
            </div>
          )}
        </section>

        <section className="analytics-section" aria-labelledby="analytics-due-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">有历史依据 · 截至昨天</p>
              <h2 id="analytics-due-heading">行动到期完成率</h2>
            </div>
          </div>
          <p className="analytics-note">
            分母是到期日结束时仍有效的行动安排，分子是其中当天结束前已完成的安排；
            同一行动多次到期可分别计数。未完成时在到期当天改期或取消不计入旧日期，
            次日再改期不会抹去旧结果。完成后改期保留原安排、不新增安排，撤回完成和再次完成
            均按到期日当天的状态判断。今天尚未结束，不参与计算。
            只统计开始记录状态快照后新建的行动；更早的行动缺少完整历史，不补算。
            领域与目标按当前关联筛选。
          </p>
          {dueTotal ? <div className="analytics-table-scroll">
            <table className="analytics-table">
              <thead><tr><th scope="col">周起始</th><th scope="col">到期安排</th>
                <th scope="col">按期完成</th><th scope="col">完成率</th>
                <th scope="col">来源</th></tr></thead>
              <tbody>{snapshot.weeks.map((week) => {
                const onTimeIds = new Set(week.onTime.map((record) => record.id));
                return <tr key={week.start}>
                  <th scope="row">{week.start}</th>
                  <td>{week.due.length}</td><td>{week.onTime.length}</td>
                  <td>{week.due.length ? `${Math.round(week.onTime.length / week.due.length * 100)}%` : "-"}</td>
                  <td>{week.due.length ? <details className="analytics-evidence">
                    <summary>查看记录</summary>
                    {week.onTime.length ? <div><span>按期完成</span>
                      <RecordLinks records={week.onTime} /></div> : null}
                    {week.due.length > week.onTime.length ? <div><span>未按期完成</span>
                      <RecordLinks records={week.due.filter((record) => !onTimeIds.has(record.id))} />
                    </div> : null}
                  </details> : <span className="analytics-dash">-</span>}</td>
                </tr>;
              })}</tbody>
              <tfoot><tr><th scope="row">合计</th><td>{dueTotal}</td>
                <td>{onTimeTotal}</td><td>{Math.round(onTimeTotal / dueTotal * 100)}%</td><td /></tr></tfoot>
            </table>
          </div> : <p className="context-summary-empty">
            这段时间没有可核验的到期安排，暂不显示完成率。
          </p>}
        </section>

        <section className="analytics-section" aria-labelledby="analytics-plan-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">有来源的计划与实际</p>
              <h2 id="analytics-plan-heading">行动排期变化</h2>
            </div>
          </div>
          {snapshot.changes.length || snapshot.comparisons.length ? <>
            {snapshot.planReasons.length ? <details className="analytics-evidence">
              <summary>按调整原因汇总</summary>
              <ul>{snapshot.planReasons.map(group => <li key={group.reason}>
                <span>{group.reason} · {group.records.length} 次调整</span>
                <RecordLinks records={group.records} />
              </li>)}</ul>
            </details> : null}
            {snapshot.changes.length ? <>
              <h3 className="analytics-subheading">已记录的调整 · {snapshot.changes.length}</h3>
              <div className="analytics-table-scroll">
                <table className="analytics-table">
                  <thead><tr><th scope="col">调整日期</th><th scope="col">行动</th>
                    <th scope="col">原安排</th><th scope="col">新安排</th>
                    <th scope="col">原因</th></tr></thead>
                  <tbody>{snapshot.changes.map((change) => <tr key={change.id}>
                    <td>{change.date}</td>
                    <td><Link to={change.to}>{change.title}<ArrowUpRight aria-hidden="true" size={14} /></Link></td>
                    <td>{change.beforeDate ?? "未安排"}</td>
                    <td>{change.afterDate ?? "取消安排"}</td>
                    <td>{change.reason}{change.note ? ` · ${change.note}` : ""}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </> : null}
            {snapshot.comparisons.length ? <>
              <h3 className="analytics-subheading">完成时的安排与实际 · {snapshot.comparisons.length}</h3>
              <div className="analytics-table-scroll">
                <table className="analytics-table">
                  <thead><tr><th scope="col">行动</th><th scope="col">完成时的安排</th>
                    <th scope="col">实际完成</th><th scope="col">相差天数</th></tr></thead>
                  <tbody>{snapshot.comparisons.map((item) => <tr key={item.id}>
                    <td><Link to={item.to}>{item.title}<ArrowUpRight aria-hidden="true" size={14} /></Link></td>
                    <td>{item.plannedDate}</td><td>{item.actualDate}</td>
                    <td>{item.differenceDays === 0 ? "当天" :
                      item.differenceDays > 0 ? `晚 ${item.differenceDays} 天` :
                        `早 ${-item.differenceDays} 天`}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </> : null}
          </> : <p className="context-summary-empty">
            这段时间还没有可对照的排期记录。旧行动的原计划未知，不据此判断是否按期。
          </p>}
        </section>

        <section className="analytics-section" aria-labelledby="analytics-feedback-heading">
          <div className="section-heading">
            <div><p className="eyebrow">当前反馈 · 按更新日期筛选</p>
              <h2 id="analytics-feedback-heading">行动反馈与投入</h2></div>
            <span className="section-count">{snapshot.feedback.length}</span>
          </div>
          <p className="analytics-note">
            使用当前保存的反馈，按行动最近更新日期和当前关联筛选；更新日期不代表反馈发生日期。
            时间合计不是周期工时，未填写的时间不补零，重复编辑不增加次数；旧反馈仍可从行动历史追溯。
          </p>
          <p className="analytics-feedback-total">
            已填写投入：{snapshot.feedbackMinutes === null ? "未记录" : `${snapshot.feedbackMinutes} 分钟`}
            <span> · {snapshot.feedbackMinutesCount} 项行动</span>
          </p>
          {snapshot.incompleteReasons.length ? <details className="analytics-evidence">
            <summary>未完成原因原文 · {snapshot.incompleteReasons.length} 组</summary>
            <ul>{snapshot.incompleteReasons.map(group => <li key={group.reason}>
              <p className="analytics-feedback-text">{group.reason} · {group.records.length} 项行动</p>
              <RecordLinks records={group.records} />
            </li>)}</ul>
          </details> : null}
          {snapshot.feedback.length ? <ul className="analytics-feedback-list">
            {snapshot.feedback.map(item => <li key={item.id}>
              <Link to={item.to}>{item.title}<ArrowUpRight aria-hidden="true" size={15} /></Link>
              <p className="analytics-note">更新 {item.date} · {item.status === "completed" ? "已完成" : "未完成"}
                {item.completedOn ? ` · 完成 ${item.completedOn}` : ""}
                {item.details.actualMinutes != null ? ` · 投入 ${item.details.actualMinutes} 分钟` : ""}</p>
              <details className="analytics-evidence"><summary>查看当前反馈</summary>
                <dl>{actionFeedbackFields.filter(([key]) => item.details[key]?.trim()).map(([key, label]) =>
                  <div key={key}><dt>{label}</dt><dd>{item.details[key]}</dd></div>)}</dl>
              </details>
            </li>)}
          </ul> : <p className="context-summary-empty">当前范围没有已填写反馈的行动。</p>}
        </section>

        <section className="analytics-section" aria-labelledby="analytics-metrics-heading">
          <div className="section-heading">
            <div><p className="eyebrow">按记录日期 · 单项观察</p>
              <h2 id="analytics-metrics-heading">领域指标趋势</h2></div>
            <Link className="button-secondary" to="/metrics">状态指标</Link>
          </div>
          <p className="analytics-note">
            每个指标单独展示原始数值与单位；没有记录的日期不补值，不计算领域总分。
            指标关联的是领域，不属于目标。
          </p>
          {goalId ? <p className="context-summary-empty">当前选择了目标；领域指标不归属于目标。</p> :
            trends.some((trend) => trend.records.length) ?
              <div className="metric-trends">{trends.filter((trend) => trend.records.length)
                .map((trend) => <MetricTrendView key={trend.definition.id} trend={trend}
                  domainId={domainId} start={snapshot.weeks[0].start}
                  end={snapshot.weeks[snapshot.weeks.length - 1].end} />)}</div> :
              <p className="context-summary-empty">当前范围还没有指标记录。</p>}
        </section>

        <section className="analytics-section" aria-labelledby="analytics-habits-heading">
          <div className="section-heading">
            <div><p className="eyebrow">实际打卡 · 有记录的完整周</p>
              <h2 id="analytics-habits-heading">习惯记录</h2></div>
            <span className="section-count">{snapshot.habits.length}</span>
          </div>
          <p className="analytics-note">
            比例按当前每周期望次数计算，只纳入有打卡记录的完整周；没有记录的周不补零，
            已记录未完成的周可为零。部分起始周和未结束的本周不参与比例，归档习惯保留记录。
            习惯按自身领域筛选，目标仅包含显式关联的习惯，不按同一领域推断归属。
          </p>
          {snapshot.habits.length ? <ul className="analytics-feedback-list">
            {snapshot.habits.map(fact => <HabitAnalyticsView key={fact.habit.id} fact={fact} />)}
          </ul> : <p className="context-summary-empty">当前范围没有可统计的习惯。</p>}
        </section>

        <section className="analytics-section" aria-labelledby="analytics-reviews-heading">
          <div className="section-heading">
            <div><p className="eyebrow">按回顾日期 · 当前完成状态</p>
              <h2 id="analytics-reviews-heading">复盘记录</h2></div>
          </div>
          <p className="analytics-note">
            按回顾日期计数，不把日、周、月复盘折算为同一种完成率；旧版回顾不推断周期或完成状态。
            目标筛选只计显式关联目标的复盘；领域按复盘自身关联筛选。
          </p>
          {snapshot.reviewGroups.some(group => group.drafts.length + group.completed.length + group.unclassified.length > 0)
            ? <div className="analytics-table-scroll"><table className="analytics-table">
              <thead><tr><th scope="col">类型</th><th scope="col">草稿</th><th scope="col">已完成</th>
                <th scope="col">旧版未分类</th><th scope="col">来源</th></tr></thead>
              <tbody>{snapshot.reviewGroups.map(group => {
                const count = group.drafts.length + group.completed.length + group.unclassified.length;
                return <tr key={group.type}>
                  <th scope="row">{group.type === "unclassified" ? "旧版回顾" : reviewTypeLabels[group.type]}</th>
                  <td>{group.type === "unclassified" ? "-" : group.drafts.length}</td>
                  <td>{group.type === "unclassified" ? "-" : group.completed.length}</td>
                  <td>{group.unclassified.length}</td>
                  <td>{count ? <details className="analytics-evidence"><summary>查看复盘来源 · {count}</summary>
                    {group.drafts.length ? <div><span>草稿</span><RecordLinks records={group.drafts} /></div> : null}
                    {group.completed.length ? <div><span>已完成</span><RecordLinks records={group.completed} /></div> : null}
                    {group.unclassified.length ? <RecordLinks records={group.unclassified} /> : null}
                  </details> : "-"}</td>
                </tr>;
              })}</tbody>
            </table></div>
            : <p className="context-summary-empty">这段时间没有当前范围内的复盘记录。</p>}
        </section>

        <section className="analytics-section" aria-labelledby="analytics-issues-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">当前状态 · 不按周追溯</p>
              <h2 id="analytics-issues-heading">尚未解决的问题</h2>
            </div>
            <span className="section-count">{snapshot.openIssues.length}</span>
          </div>
          <p className="analytics-note">
            状态使用当前保存值，出现次数是截至目前的累计，不是观察周期内次数；
            只按首次发现日期统计本周期新发现的问题，不推断解决日期或历史状态变化。
          </p>
          <div className="analytics-fact-counts">
            {snapshot.issueStates.map(group => <span key={group.status}>
              {issueStateLabels[group.status]} <strong>{group.issues.length}</strong>
            </span>)}
            <span>本周期首次发现 <strong>{snapshot.firstSeenIssues.length}</strong></span>
          </div>
          {snapshot.firstSeenIssues.length ? <details className="analytics-evidence">
            <summary>本周期首次发现的问题</summary>
            <RecordLinks records={snapshot.firstSeenIssues.map(issue => ({
              id: issue.id, title: issue.title, date: issue.firstSeen,
              to: `/issues#issue-${encodeURIComponent(issue.id)}`,
            }))} />
          </details> : null}
          {snapshot.issueStates.find(group => group.status === "resolved")?.issues.length ? <details className="analytics-evidence">
            <summary>当前已解决的问题</summary>
            <RecordLinks records={snapshot.issueStates.find(group => group.status === "resolved")!.issues.map(issue => ({
              id: issue.id, title: issue.title, date: issue.firstSeen,
              to: `/issues#issue-${encodeURIComponent(issue.id)}`,
            }))} />
          </details> : null}
          {snapshot.openIssues.length ? <ul className="analytics-issues">
            {snapshot.openIssues.map((issue) => <li key={issue.id}>
              <Link to={`/issues#issue-${encodeURIComponent(issue.id)}`}>
                {issue.title}<ArrowUpRight aria-hidden="true" size={15} />
              </Link>
              <span>首次记录 {issue.firstSeen} · 已记出现 {issue.occurrenceCount} 次</span>
            </li>)}
          </ul> : <p className="context-summary-empty">当前范围内没有尚未解决的问题。</p>}
        </section>
      </section>
    </>
  );
}

function HabitAnalyticsView({ fact }: { fact: HabitAnalyticsFact }) {
  const { habit, records, progress } = fact;
  return <li>
    <Link to={`/habits#habit-${encodeURIComponent(habit.id)}`}>
      {habit.title}<ArrowUpRight aria-hidden="true" size={15} />
    </Link>
    <p className="analytics-note">当前每周 {habit.weeklyTarget} 次{habit.archived ? " · 已归档" : ""}
      {habit.stableContext ? ` · 稳定情境：${habit.stableContext}` : ""}</p>
    <div className="analytics-fact-counts">
      <span>已记录 <strong>{records.length} 天</strong></span>
      <span>记录为完成 <strong>{records.filter(record => record.completed).length} 天</strong></span>
      <span>有记录的完整周 <strong>{progress.recordedWeeks}</strong></span>
      <span>按期望次数 <strong>{progress.percent === null ? "未知" : `${progress.percent}%`}</strong>
        {progress.expected ? `（${progress.completed}/${progress.expected}）` : ""}</span>
    </div>
    <details className="analytics-evidence">
      <summary>按周与打卡来源</summary>
      <div className="analytics-table-scroll"><table className="analytics-table">
        <thead><tr><th scope="col">周起始</th><th scope="col">已记录</th><th scope="col">完成天数</th>
          <th scope="col">按期望次数</th><th scope="col">来源</th></tr></thead>
        <tbody>{fact.weeks.map(week => <tr key={week.start}>
          <th scope="row">{week.start} 至 {week.end}</th>
          <td>{week.records.length}</td><td>{week.completedDays}</td>
          <td>{week.progress.percent === null ? "不计算" : `${week.progress.percent}%`}</td>
          <td>{week.records.length ? <ul>{week.records.map(record => <li key={record.id}>
            <Link to={`/habits#habit-log-${encodeURIComponent(record.id)}`}>
              {record.recordedOn} · {record.completed ? "已完成" : "未完成"}
              <ArrowUpRight aria-hidden="true" size={14} />
            </Link>
            {record.obstacle ? <span className="analytics-feedback-text">阻碍：{record.obstacle}</span> : null}
            {record.adjustment ? <span className="analytics-feedback-text">调整：{record.adjustment}</span> : null}
          </li>)}</ul> : "未记录"}</td>
        </tr>)}</tbody>
      </table></div>
    </details>
  </li>;
}

function RecordLinks({ records }: { records: readonly AnalyticsRecord[] }) {
  return <ul>
    {records.map((record) => <li key={record.id}>
      <Link to={record.to}>{record.title}<ArrowUpRight aria-hidden="true" size={14} /></Link>
      <time dateTime={record.date}>{record.date}</time>
    </li>)}
  </ul>;
}
