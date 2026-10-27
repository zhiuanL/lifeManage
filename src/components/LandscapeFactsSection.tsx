import { ArrowUpRight, RotateCcw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { LandscapePreference } from "../domain/life/LandscapePreference";
import { goalPriorityLabels } from "../domain/planning/GoalPriority";
import { reviewTypeLabels } from "../domain/reviews/ReviewStructure";
import { reviewCreatePath } from "../domain/reviews/ReviewCreateContext";
import { defaultModulePreference, isModulePathEnabled } from "../domain/system/ModulePreference";
import type { LandscapeFacts, LandscapeFactOptions } from "../services/life/LandscapeFactService";
import type { LandscapeFactService } from "../services/life/LandscapeFactService";

type FactState = { source: LandscapeFactService; key: string; kind: "ready"; facts: LandscapeFacts } |
  { source: LandscapeFactService; key: string; kind: "error" };

export function LandscapeFactsSection({ domains, preference, children }: {
  domains: readonly LifeDomain[]; preference: LandscapePreference; children?: ReactNode;
}) {
  const { landscapeFactService, modulePreference } = useLifeOS();
  const modules = modulePreference ?? defaultModulePreference();
  const enabled = (path: string) => isModulePathEnabled(path, modules);
  const options: LandscapeFactOptions = {
    domainIds: domains.map(domain => domain.id),
    navigation: enabled("/navigation"), goals: enabled("/goals"),
    attention: enabled("/attention"), trends: enabled("/analytics"),
    reviews: preference.showReviews && enabled("/reviews"),
  };
  const optionsKey = JSON.stringify(options);
  const [retry, setRetry] = useState(0);
  const key = `${optionsKey}:${retry}`;
  const [state, setState] = useState<FactState | null>(null);
  useEffect(() => {
    let current = true;
    void landscapeFactService.getSnapshot(JSON.parse(optionsKey) as LandscapeFactOptions)
      .then(facts => { if (current) setState({ source: landscapeFactService, key, kind: "ready", facts }); })
      .catch(() => { if (current) setState({ source: landscapeFactService, key, kind: "error" }); });
    return () => { current = false; };
  }, [landscapeFactService, optionsKey, key]);
  const current = state?.source === landscapeFactService && state.key === key ? state : null;

  return <>
    <div className="landscape-facts">
    {current?.kind === "ready" ? <FactBand title="当前周期">
      <p className="landscape-period"><time dateTime={current.facts.today}>{current.facts.today}</time>
        <span>{Number(current.facts.today.slice(5, 7))} 月 · 第 {Math.ceil(Number(current.facts.today.slice(5, 7)) / 3)} 季度</span></p>
      <p className="landscape-note">本周 {current.facts.week.start} 至 {current.facts.week.end}</p>
    </FactBand> : null}
    {preference.showFocus ? <FactBand title="正在关注">
      {domains.some(domain => domain.focus) ? <ul className="landscape-fact-list">
        {domains.filter(domain => domain.focus).slice(0, 3).map(domain =>
          <FactRow key={domain.id} to={`/domains/${encodeURIComponent(domain.id)}`} title={domain.focus}>
            {domain.name}
          </FactRow>)}
      </ul> : <p className="landscape-note">还没有写下当下的关注。</p>}
    </FactBand> : null}
    </div>
    {children}
    <div className="landscape-facts">
    {!current ? <p role="status" className="landscape-note">正在读取近期记录…</p> :
      current.kind === "error" ? <div className="landscape-facts-error" role="alert">
        <p>近期记录读取失败，生活领域仍可打开。</p>
        <button type="button" className="button-secondary" onClick={() => setRetry(value => value + 1)}>
          <RotateCcw aria-hidden="true" size={15} />重新读取
        </button>
      </div> : <>
        {options.navigation || options.goals ? <FactBand title="方向与近期行动">
          {options.navigation ? <FactGroup title="愿景与长期方向" empty="还没有写下愿景与长期方向。">
            {current.facts.directions.map(direction =>
              <FactRow key={direction.id} title={direction.title}
                to={`/navigation#navigation-${encodeURIComponent(direction.id)}`} />)}
          </FactGroup> : null}
          {options.goals ? <>
            <FactGroup title="进行中的目标" empty="目前没有进行中的目标。">
              {current.facts.goals.map(goal => <FactRow key={goal.id} title={goal.title}
                to={`/goals/${encodeURIComponent(goal.id)}`}>{goalPriorityLabels[goal.priority ?? "medium"]}优先级</FactRow>)}
            </FactGroup>
            <FactGroup title="近四周行动" empty="近四周没有行动完成或排期记录。">
              {current.facts.actions.map(({ action, date }) => <FactRow key={action.id} title={action.title}
                to={`/goals?actionStatus=all#action-${encodeURIComponent(action.id)}`}>
                {date} · {action.status === "completed" ? "已完成" : "已安排"}
              </FactRow>)}
            </FactGroup>
          </> : null}
        </FactBand> : null}
        {options.attention ? <FactBand title="值得留意">
          <FactGroup empty="当前没有规则关注提示。">
            {current.facts.attention.map(signal => <FactRow key={signal.id} title={signal.title}
              to={signal.domainIds.find(id => options.domainIds.includes(id))
                ? `/attention?domain=${encodeURIComponent(signal.domainIds.find(id => options.domainIds.includes(id))!)}`
                : "/attention"}>{signal.summary}</FactRow>)}
          </FactGroup>
        </FactBand> : null}
        {options.trends ? <FactBand title="最近趋势">
          <FactGroup empty="近四周没有指标记录。">
            {current.facts.metrics.map(fact => <FactRow key={fact.definition.id}
              title={`${fact.definition.name} · ${fact.latest.value} ${fact.definition.unit}`}
              to={fact.domainId
                ? `/domains/${encodeURIComponent(fact.domainId)}#metric-record-${encodeURIComponent(fact.latest.id)}`
                : `/metrics#metric-record-${encodeURIComponent(fact.latest.id)}`}>
              {fact.previous
                ? `${fact.previous.recordedOn}：${fact.previous.value} → ${fact.latest.recordedOn}：${fact.latest.value} ${fact.definition.unit}`
                : `${fact.latest.recordedOn} · 仅一条记录，暂无对比`}
            </FactRow>)}
          </FactGroup>
        </FactBand> : null}
        {options.reviews ? <FactBand title="回顾与校准">
          <FactGroup title="最近回顾" empty="还没有已完成的复盘或回顾。">
            {current.facts.latestReview ? <FactRow title={current.facts.latestReview.title}
              to={`/reviews#review-${encodeURIComponent(current.facts.latestReview.id)}`}>
              {current.facts.latestReview.reviewedOn} · {current.facts.latestReview.structure
                ? reviewTypeLabels[current.facts.latestReview.structure.type] : "回顾"}
            </FactRow> : null}
          </FactGroup>
          <h3>本周校准</h3>
          <p className="landscape-note">本周周期结束于 {current.facts.week.end}</p>
          <SourceLink to={current.facts.weeklyReview
            ? `/reviews?cycle=weekly#review-${encodeURIComponent(current.facts.weeklyReview.id)}`
            : reviewCreatePath({ type: "weekly", anchor: current.facts.today, domainIds: [] })}>
            {current.facts.weeklyReview
              ? current.facts.weeklyReview.structure?.status === "draft" ? "继续本周复盘" : "查看本周复盘"
              : "开始本周复盘"}
          </SourceLink>
          <SourceLink to="/reviews">查看复盘</SourceLink>
        </FactBand> : null}
      </>}
    </div>
  </>;
}

function FactBand({ title, children }: { title: string; children: ReactNode }) {
  return <section className="landscape-fact-band" aria-label={title}><h2>{title}</h2>{children}</section>;
}

function FactGroup({ title, empty, children }: { title?: string; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <div className="landscape-fact-group">{title ? <h3>{title}</h3> : null}
    {hasChildren ? <ul className="landscape-fact-list">{children}</ul> : <p className="landscape-note">{empty}</p>}
  </div>;
}

function FactRow({ to, title, children }: { to: string; title: string; children?: ReactNode }) {
  return <li><SourceLink to={to}>{title}</SourceLink>
    {children ? <p className="landscape-fact-detail">{children}</p> : null}</li>;
}

function SourceLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="landscape-fact-link" to={to}><span>{children}</span>
    <ArrowUpRight aria-hidden="true" size={15} /></Link>;
}
