import { ArrowLeft, Pencil } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { DomainEditorDialog } from "../components/DomainEditorDialog";
import { DomainIcon } from "../components/DomainIcon";
import { DomainMetricsSection } from "../components/DomainMetricsSection";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { Issue } from "../domain/issues/Issue";
import type { Decision } from "../domain/decisions/Decision";
import { isActionInDomain, type Action } from "../domain/planning/Action";
import type { Goal } from "../domain/planning/Goal";
import type { Review } from "../domain/reviews/Review";
import type { Habit } from "../domain/habits/Habit";
import type { Person, LifeEvent, Skill } from "../domain/records/LifeRecords";

import { defaultModulePreference, isModulePathEnabled } from "../domain/system/ModulePreference";

type PageState =
  | { kind: "loading" }
  | {
      kind: "ready";
      domain: LifeDomain;
      goals: readonly Goal[];
      actions: readonly Action[];
      reviews: readonly Review[];
      issues: readonly Issue[];
      decisions: readonly Decision[];
      habits: readonly Habit[];
      people: readonly Person[];
      events: readonly LifeEvent[];
      skills: readonly Skill[];
    }
  | { kind: "missing" }
  | { kind: "error"; message: string };

export function DomainContextPage() {
  const { domainId } = useParams();
  const { lifeDomainService, goalService, actionService, reviewService, issueService,
    decisionService, habitService, lifeRecordsService, modulePreference } = useLifeOS();
  const moduleEnabled = (path: string) =>
    isModulePathEnabled(path, modulePreference ?? defaultModulePreference());
  const [read, setRead] = useState<{
    source: () => Promise<PageState>; generation: number; state: PageState;
  } | null>(null);
  const [generation, setGeneration] = useState(0);
  const [editor, setEditor] = useState<{ domain: LifeDomain; source: () => Promise<PageState> } | null>(null);
  const [metricDomain, setMetricDomain] = useState<LifeDomain | null>(null);
  const mounted = useRef(false);
  const requests = useRef(0);
  const editorOpen = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requests.current += 1; };
  }, []);

  const loadDomain = useCallback(async (): Promise<PageState> => {
    if (!domainId) {
      return { kind: "missing" };
    }

    try {
      const domain = await lifeDomainService.findById(domainId);

      if (!domain) {
        return { kind: "missing" };
      }

      const [goals, actions, reviews, issues, decisions, habits, people, events, skills] = await Promise.all([
        goalService.list(),
        actionService.list(),
        reviewService.list(),
        issueService.list(),
        decisionService.list(),
        habitService.list(),
        lifeRecordsService.listPeople(),
        lifeRecordsService.listEvents(),
        lifeRecordsService.listSkills(),
      ]);
      const goalsById = new Map(goals.map((goal) => [goal.id, goal]));
      return {
        kind: "ready",
        domain,
        goals: goals.filter((goal) => goal.domainIds.includes(domain.id)),
        actions: actions.filter((action) =>
          isActionInDomain(action, domain.id, goalsById)),
        reviews: reviews.filter((review) => review.domainIds.includes(domain.id)),
        issues: issues.filter((issue) => issue.domainIds.includes(domain.id)),
        decisions: decisions.filter((decision) => decision.domainIds.includes(domain.id)),
        habits: habits.filter((habit) => habit.domainIds.includes(domain.id) && !habit.archived),
        people: people.filter((item) => item.domainIds.includes(domain.id) && !item.archived),
        events: events.filter((item) => item.domainIds.includes(domain.id) && !item.archived),
        skills: skills.filter((item) => item.domainIds.includes(domain.id) && !item.archived),
      };
    } catch {
      return {
        kind: "error",
        message: "领域上下文读取失败，请重试。",
      };
    }
  }, [actionService, domainId, goalService, lifeDomainService, reviewService, issueService,
    decisionService, habitService, lifeRecordsService]);

  const state: PageState = read?.source === loadDomain && read.generation === generation
    ? read.state : { kind: "loading" };

  useEffect(() => {
    const request = ++requests.current;
    void loadDomain().then((nextState) => {
      if (mounted.current && request === requests.current) {
        setRead({ source: loadDomain, generation, state: nextState });
        if (nextState.kind === "ready") setMetricDomain(nextState.domain);
      }
    });

    return () => {
      requests.current += 1;
    };
  }, [loadDomain, generation]);

  const retryLoading = () => {
    if (!mounted.current) return;
    requests.current += 1;
    setGeneration(current => current + 1);
  };

  function closeEditor() {
    if (!mounted.current) return;
    editorOpen.current = false;
    setEditor(null);
  }

  function renderPage(content: ReactNode, remainder: ReactNode = null) {
    return <>{content}
      {metricDomain ? <DomainMetricsSection domain={state.kind === "ready" ? state.domain : metricDomain}
        suspended={state.kind !== "ready"} /> : null}
      {remainder}
      {editor ? <DomainEditorDialog key={editor.domain.id} domain={editor.domain}
        onClose={closeEditor}
        onSaved={savedDomain => {
          if (!mounted.current) return;
          closeEditor();
          if (loadDomain !== editor.source || domainId !== savedDomain.id) return;
          if (state.kind === "ready" && state.domain.id === savedDomain.id) {
            setRead(current => current?.source === editor.source && current.state.kind === "ready"
              && current.state.domain.id === savedDomain.id
              ? { ...current, state: { ...current.state, domain: savedDomain } } : current);
          }
        }} /> : null}
    </>;
  }

  if (state.kind === "loading") {
    return renderPage(<div className="context-loading" aria-live="polite">正在打开领域上下文</div>);
  }

  if (state.kind === "error") {
    return renderPage(
      <section className="not-found-page">
        <p className="eyebrow">读取失败</p>
        <h1>暂时无法打开这个领域</h1>
        <p className="page-intro" role="alert">{state.message}</p>
        <button className="button-secondary" type="button" onClick={retryLoading}>
          重试
        </button>
      </section>
    );
  }

  if (state.kind === "missing") {
    return renderPage(
      <section className="not-found-page">
        <p className="eyebrow">未找到领域</p>
        <h1>这个领域不在版图中</h1>
        <p className="page-intro">它可能尚未创建，或者当前链接已经失效。</p>
        <Link className="button-secondary" to="/">
          返回生活版图
        </Link>
      </section>
    );
  }

  const { domain, goals, actions, reviews, issues, decisions, habits, people, events, skills } = state;
  const activeGoals = goals.filter((goal) => goal.status === "active");
  const openActions = actions.filter((action) => action.status === "open");
  const activeIssues = issues.filter((issue) => issue.status !== "resolved");

  function recordLink(path: string, type: string, id: string, title: string) {
    return moduleEnabled(path)
      ? <Link to={`${path}?domain=${encodeURIComponent(domain.id)}#${type}-${encodeURIComponent(id)}`}>{title}</Link>
      : title;
  }

  return renderPage(
    <>
      <section className={`domain-context-heading domain-color-${domain.color}`}>
        <Link className="back-link" to="/">
          <ArrowLeft aria-hidden="true" size={17} strokeWidth={1.8} />
          生活版图
        </Link>
        <div className="domain-context-title-row">
          <div className="domain-context-title">
            <span className="domain-context-icon">
              <DomainIcon icon={domain.icon} size={25} />
            </span>
            <div>
              <p className="eyebrow">领域上下文</p>
              <h1>{domain.name}</h1>
              {domain.status !== "active" ? <p className="domain-context-status">
                {domain.status === "paused" ? "已暂停" : "已归档"}
              </p> : null}
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            title="编辑领域"
            aria-label="编辑领域"
            disabled={!!editor}
            onClick={() => {
              if (!mounted.current || editorOpen.current) return;
              editorOpen.current = true;
              setEditor({ domain, source: loadDomain });
            }}
          >
            <Pencil aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </div>
      </section>

      <section className="context-layout">
        <article className="context-statement">
          <p className="eyebrow">长期期待</p>
          <p className="context-body">
            {domain.longTermExpectation || "还没有写下长期期待。"}
          </p>
        </article>
        <article className="context-statement">
          <p className="eyebrow">当前状态</p>
          <p className="context-body">{domain.currentState || "还没有写下当前状态。"}</p>
        </article>
      </section>

      <section className="context-detail">
        <p className="eyebrow">当下关注</p>
        <div>
          <p>{domain.focus || "还没有设定当下关注。"}</p>
        </div>
      </section>
      {domain.description ? <section className="context-detail">
        <p className="eyebrow">领域说明</p>
        <div><p>{domain.description}</p></div>
      </section> : null}

    </>,
    <>
      <section className="context-planning">
        <div className="context-planning-heading">
          <div><p className="eyebrow">生活中的关联</p><h2>人物、事件与能力</h2></div>
          <div className="planning-heading-actions">
            <Link className="button-secondary" to={`/roles?domainId=${encodeURIComponent(domain.id)}`}>身份角色</Link>
            {moduleEnabled("/people") ? <Link className="button-secondary" to={`/people?domain=${encodeURIComponent(domain.id)}`}>人物</Link> : null}
            {moduleEnabled("/timeline") ? <Link className="button-secondary" to={`/timeline?domain=${encodeURIComponent(domain.id)}`}>重要事件</Link> : null}
            {moduleEnabled("/skills") ? <Link className="button-secondary" to={`/skills?domain=${encodeURIComponent(domain.id)}`}>能力成长</Link> : null}
            {moduleEnabled("/resources") ? <Link className="button-secondary" to={`/resources?domain=${encodeURIComponent(domain.id)}`}>资源总览</Link> : null}
          </div>
        </div>
        <p className="context-summary-empty">
          相关人物 {people.length} 位 · 重要事件 {events.length} 件 · 能力 {skills.length} 项
        </p>
        <div className="context-planning-grid">
          <div>
            <p className="eyebrow">重要人物</p>
            {people.length ? <ol className="context-summary-list">
              {people.slice(0, 3).map(person => <li key={person.id}>
                {recordLink("/people", "person", person.id, person.name)}
              </li>)}
            </ol> : <p className="context-summary-empty">暂时没有关联人物。</p>}
          </div>
          <div>
            <p className="eyebrow">重要事件</p>
            {events.length ? <ol className="context-summary-list">
              {events.slice(0, 3).map(event => <li key={event.id}>
                {recordLink("/timeline", "event", event.id, event.title)}
              </li>)}
            </ol> : <p className="context-summary-empty">暂时没有关联事件。</p>}
          </div>
          <div>
            <p className="eyebrow">能力成长</p>
            {skills.length ? <ol className="context-summary-list">
              {skills.slice(0, 3).map(skill => <li key={skill.id}>
                {recordLink("/skills", "skill", skill.id, skill.name)}
              </li>)}
            </ol> : <p className="context-summary-empty">暂时没有关联能力。</p>}
          </div>
        </div>
      </section>

      <section className="context-planning">
        <div className="context-planning-heading">
          <div><p className="eyebrow">日常节奏</p><h2>关联习惯</h2></div>
          {moduleEnabled("/habits") ? <Link className="button-secondary" to={`/habits?domain=${encodeURIComponent(domain.id)}`}>
            查看领域习惯</Link> : null}
        </div>
        {habits.length ? <ol className="context-summary-list context-issue-list">
          {habits.slice(0, 3).map((habit) =>
            <li key={habit.id}>{recordLink("/habits", "habit", habit.id, habit.title)} · 每周 {habit.weeklyTarget} 次</li>)}
        </ol> : <p className="context-summary-empty context-issue-list">暂时没有关联习惯。</p>}
      </section>

      <section className="context-planning">
        <div className="context-planning-heading">
          <div>
            <p className="eyebrow">领域中的推进</p>
            <h2>领域里的关联</h2>
          </div>
          <div className="planning-heading-actions">
            {moduleEnabled("/goals") ? <Link className="button-secondary" to={`/goals?domain=${encodeURIComponent(domain.id)}`}>
              打开目标与行动
            </Link> : null}
            {moduleEnabled("/calendar") ? <Link className="button-secondary" to={`/calendar?domain=${encodeURIComponent(domain.id)}`}>
              查看日历
            </Link> : null}
            {moduleEnabled("/attention") ? <Link className="button-secondary" to={`/attention?domain=${encodeURIComponent(domain.id)}`}>
              查看注意事项
            </Link> : null}
            {moduleEnabled("/analytics") ? <Link className="button-secondary" to={`/analytics?domain=${encodeURIComponent(domain.id)}`}>
              查看领域分析
            </Link> : null}
            <Link className="button-secondary" to={`/export?domain=${encodeURIComponent(domain.id)}`}>
              导出领域上下文
            </Link>
          </div>
        </div>
        <div className="context-planning-grid">
          <div>
            <p className="eyebrow">活跃目标</p>
            {activeGoals.length > 0 ? (
              <ol className="context-summary-list">
                {activeGoals.slice(0, 3).map((goal) => (
                  <li key={goal.id}>{recordLink("/goals", "goal", goal.id, goal.title)}</li>
                ))}
              </ol>
            ) : (
              <p className="context-summary-empty">还没有活跃目标。</p>
            )}
          </div>
          <div>
            <p className="eyebrow">待完成行动</p>
            {openActions.length > 0 ? (
              <ol className="context-summary-list">
                {openActions.slice(0, 3).map((action) => (
                  <li key={action.id}>{recordLink("/goals", "action", action.id, action.title)}</li>
                ))}
              </ol>
            ) : (
              <p className="context-summary-empty">还没有待完成行动。</p>
            )}
          </div>
          <div>
            <p className="eyebrow">近期回顾</p>
            {reviews.length > 0 ? (
              <ol className="context-summary-list">
                {reviews.slice(0, 3).map((review) => (
                  <li key={review.id}>{recordLink("/reviews", "review", review.id, review.title)}</li>
                ))}
              </ol>
            ) : (
              <p className="context-summary-empty">还没有关联回顾。</p>
            )}
            {moduleEnabled("/reviews") ? <Link to={`/reviews?domain=${encodeURIComponent(domain.id)}`}>查看领域复盘</Link> : null}
          </div>
        </div>
      </section>

      <section className="context-planning">
        <div className="context-planning-heading">
          <div>
            <p className="eyebrow">选择的轨迹</p>
            <h2>相关决策</h2>
          </div>
          {moduleEnabled("/decisions") ? <Link className="button-secondary" to={`/decisions?domain=${encodeURIComponent(domain.id)}`}>
            查看领域决策
          </Link> : null}
        </div>
        {decisions.length ? <ol className="context-summary-list context-issue-list">
          {decisions.slice(0, 3).map((decision) =>
            <li key={decision.id}>{recordLink("/decisions", "decision", decision.id, decision.title)}</li>)}
        </ol> : <p className="context-summary-empty context-issue-list">暂时没有关联决策。</p>}
      </section>

      <section className="context-planning">
        <div className="context-planning-heading">
          <div>
            <p className="eyebrow">关联线索</p>
            <h2>当前问题</h2>
          </div>
          {moduleEnabled("/issues") ? <Link className="button-secondary" to={`/issues?domain=${encodeURIComponent(domain.id)}`}>
            查看领域问题
          </Link> : null}
        </div>
        {activeIssues.length ? (
          <ol className="context-summary-list context-issue-list">
            {activeIssues.slice(0, 3).map((issue) =>
              <li key={issue.id}>{recordLink("/issues", "issue", issue.id, issue.title)}</li>)}
          </ol>
        ) : <p className="context-summary-empty context-issue-list">暂时没有待跟进的问题。</p>}
      </section>

    </>
  );
}
