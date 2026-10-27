import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { AssessmentValidationError, assessmentFields, type AssessmentDraft, type AssessmentKind,
  type SystemAssessment } from "../domain/assessments/SystemAssessment";
import { localDate } from "../domain/habits/Habit";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { Action } from "../domain/planning/Action";
import { isPlainDate, type Goal } from "../domain/planning/Goal";
import type { Review } from "../domain/reviews/Review";
import { reviewPeriod } from "../domain/reviews/ReviewStructure";
import type { Decision } from "../domain/decisions/Decision";
import type { Issue } from "../domain/issues/Issue";
import type { SystemAssessmentService } from "../services/assessments/SystemAssessmentService";

type Data = { domains: readonly LifeDomain[]; goals: readonly Goal[]; actions: readonly Action[];
  reviews: readonly Review[]; decisions: readonly Decision[]; issues: readonly Issue[];
  assessments: readonly SystemAssessment[] };
type State = { kind: "loading" } | { kind: "error"; message: string } |
  { kind: "ready"; data: Data };
type AssessmentLoader = () => Promise<State>;
type ReadResult = { source: AssessmentLoader; generation: number; state: State };

export function SystemAssessmentPage() {
  const { systemAssessmentService, lifeDomainService, goalService, actionService,
    reviewService, decisionService, issueService } = useLifeOS();
  const [kind, setKind] = useState<AssessmentKind>("month");
  const [month, setMonth] = useState(localDate(new Date()).slice(0, 7));
  const [result, setResult] = useState<ReadResult | null>(null);
  const [formSnapshot, setFormSnapshot] = useState<{
    source: AssessmentLoader; service: SystemAssessmentService; data: Data;
  } | null>(null);
  const [generation, setGeneration] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const reportSaving = useCallback((pending: boolean) => {
    savingRef.current = pending;
    setSaving(pending);
  }, []);
  const load = useCallback(async (): Promise<State> => {
    try {
      const [domains, goals, actions, reviews, decisions, issues, assessments] =
        await Promise.all([lifeDomainService.list(), goalService.list(), actionService.list(),
          reviewService.list(), decisionService.list(), issueService.list(),
          systemAssessmentService.list()]);
      return { kind: "ready", data: { domains, goals, actions, reviews, decisions, issues,
        assessments } };
    } catch {
      return { kind: "error", message: "评估记录读取失败，请重试。" };
    }
  }, [systemAssessmentService, lifeDomainService, goalService, actionService,
    reviewService, decisionService, issueService]);
  const currentRead = useRef({ source: load, generation });
  useLayoutEffect(() => { currentRead.current = { source: load, generation }; }, [load, generation]);
  useEffect(() => {
    let current = true;
    void load().then(state => {
      if (current) {
        setResult({ source: load, generation, state });
        if (state.kind === "ready") setFormSnapshot({ source: load, service: systemAssessmentService, data: state.data });
      }
    });
    return () => { current = false; };
  }, [load, generation, systemAssessmentService]);
  const state: State = result?.source === load && result.generation === generation
    ? result.state : { kind: "loading" };
  const reload = () => setGeneration(value => value + 1);
  const validMonth = /^\d{4}-\d{2}$/.test(month) && isPlainDate(`${month}-01`);
  const period = validMonth
    ? reviewPeriod(kind === "month" ? "monthly" : "quarterly", `${month}-01`) : null;
  const periodStart = period?.start ?? "";
  const periodEnd = period?.end ?? "";
  const previousData = formSnapshot?.data;
  const renderForm = () => period && previousData ? <AssessmentForm
    key={`${kind}:${periodStart}`} kind={kind} periodStart={periodStart}
    source={formSnapshot!.source} currentSource={load} service={formSnapshot!.service}
    ready={state.kind === "ready"}
    existing={previousData.assessments.find(item => item.periodKind === kind && item.periodStart === periodStart)}
    onSaved={(source, saved) => {
      if (currentRead.current.source !== source) return;
      setFormSnapshot(previous => previous?.source === source ? {
        ...previous, data: { ...previous.data, assessments: [
          ...previous.data.assessments.filter(item => item.periodKind !== saved.periodKind ||
            item.periodStart !== saved.periodStart), saved,
        ] },
      } : previous);
      setResult(previous => {
        if (previous?.source !== source || previous.generation !== currentRead.current.generation ||
          previous.state.kind !== "ready") return previous;
        const data = previous.state.data;
        return { ...previous, state: { kind: "ready", data: { ...data, assessments: [
          ...data.assessments.filter(item => item.periodKind !== saved.periodKind ||
            item.periodStart !== saved.periodStart), saved,
        ] } } };
      });
    }} onSavingChange={reportSaving} /> : null;
  const renderPage = (facts: ReactNode) => <section className="record-page">
    <header className="planning-heading">
      <div><p className="eyebrow">定期回看使用价值</p><h1>系统成效评估</h1></div>
    </header>
    <div className="attention-filters">
      <label className="attention-control"><span>周期</span>
        <select value={kind} disabled={saving || state.kind !== "ready"} onChange={(event) => {
          if (!savingRef.current && state.kind === "ready") setKind(event.target.value as AssessmentKind);
        }}>
          <option value="month">月度</option><option value="quarter">季度</option></select></label>
      <label className="attention-control"><span>所在月份</span>
        <input type="month" max={localDate(new Date()).slice(0, 7)} value={month}
          disabled={saving || state.kind !== "ready"}
          onChange={(event) => { if (!savingRef.current && state.kind === "ready") setMonth(event.target.value); }} /></label>
    </div>
    {facts}
    {renderForm()}
  </section>;
  if (state.kind === "loading") return renderPage(<p className="context-loading">正在读取评估</p>);
  if (state.kind === "error") return renderPage(<section className="not-found-page">
    <h2>无法打开系统成效评估</h2><p role="alert">{state.message}</p>
    <button type="button" className="button-secondary" disabled={saving} onClick={reload}>
      重试</button></section>);
  const { data } = state;
  const within = (date: string) => date >= periodStart && date <= periodEnd;
  const activeDomains = data.domains.filter((domain) => domain.description || domain.focus);
  const linkedActions = data.actions.filter((action) => action.goalId &&
    within(action.createdAt.slice(0, 10)));
  const reviews = data.reviews.filter((review) => within(review.reviewedOn));
  const decisions = data.decisions.filter((decision) =>
    decision.importance === "major" && within(decision.decidedOn));
  const issues = data.issues.filter((issue) => within(issue.firstSeen));
  return renderPage(<>
    {!validMonth ? <p className="form-error" role="alert">请选择有效的月份。</p> : <>
    <section className="record-timeline" aria-label="本期记录">
      <h2>本期可查的记录</h2>
      <p className="analytics-note">仅展示已记录事实，不把数量当成改善程度。旧数据可能缺少完整历史。</p>
      <ol>
        <li><span>有描述或关注的领域</span><strong>{activeDomains.length}</strong>
          <Link to="/">查看生活版图</Link></li>
        <li><span>本期创建且关联目标的行动</span><strong>{linkedActions.length}</strong>
          <Link to="/goals">查看目标与行动</Link></li>
        <li><span>本期回顾</span><strong>{reviews.length}</strong>
          <Link to="/reviews">查看回顾</Link></li>
        <li><span>本期记录的重大决策</span><strong>{decisions.length}</strong>
          <Link to="/decisions">查看决策</Link></li>
        <li><span>本期首次发现的问题</span><strong>{issues.length}</strong>
          <Link to="/issues">查看问题</Link></li>
      </ol>
      <details className="record-details"><summary>查看来源</summary>
        {[
          ...linkedActions.map((item) => ({ id: `action-${item.id}`, title: item.title,
            to: `/goals#action-${encodeURIComponent(item.id)}` })),
          ...reviews.map((item) => ({ id: `review-${item.id}`, title: item.title,
            to: `/reviews#review-${encodeURIComponent(item.id)}` })),
          ...decisions.map((item) => ({ id: `decision-${item.id}`, title: item.title,
            to: `/decisions#decision-${encodeURIComponent(item.id)}` })),
          ...issues.map((item) => ({ id: `issue-${item.id}`, title: item.title,
            to: `/issues#issue-${encodeURIComponent(item.id)}` })),
        ].map((item) => <p key={item.id}><Link to={item.to}>{item.title}</Link></p>)}
      </details>
    </section>
    </>}
  </>);
}

function AssessmentForm({ kind, periodStart, existing, source, currentSource, service, ready, onSaved, onSavingChange }: {
  kind: AssessmentKind; periodStart: string; existing?: SystemAssessment;
  source: AssessmentLoader; currentSource: AssessmentLoader; service: SystemAssessmentService; ready: boolean;
  onSaved(source: AssessmentLoader, saved: SystemAssessment): void;
  onSavingChange(pending: boolean): void;
}) {
  const [session, setSession] = useState({ source, service });
  const [draft, setDraft] = useState<AssessmentDraft>({
    periodKind: kind, periodStart, clarity: existing?.clarity ?? "",
    alignment: existing?.alignment ?? "", reviews: existing?.reviews ?? "",
    decisions: existing?.decisions ?? "", earlyIssues: existing?.earlyIssues ?? "",
    adjustment: existing?.adjustment ?? "",
  });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const callbacks = useRef({ onSaved, onSavingChange });
  useLayoutEffect(() => { callbacks.current = { onSaved, onSavingChange }; }, [onSaved, onSavingChange]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  function change(values: Partial<AssessmentDraft>) {
    if (savingRef.current) return;
    setSaved(false); setDraft(current => ({ ...current, ...values }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current || !mounted.current) return;
    savingRef.current = true; setSaving(true); setError(""); setSaved(false);
    callbacks.current.onSavingChange(true);
    try {
      const saved = await session.service.save(draft);
      if (mounted.current) {
        setSaved(true);
        callbacks.current.onSaved(session.source, saved);
      }
    } catch (reason) {
      if (mounted.current) setError(reason instanceof AssessmentValidationError
        ? reason.message : "评估保存失败，请重试。");
    } finally {
      savingRef.current = false;
      if (mounted.current) { setSaving(false); callbacks.current.onSavingChange(false); }
    }
  }
  return <section className="record-editor" aria-label="本期评估">
    <h2>{periodStart.slice(0, 7)} · {kind === "month" ? "月度" : "季度"}回看</h2>
    <form className="domain-form" onSubmit={(event) => void submit(event)}>
      <fieldset className="record-edit-fields" disabled={saving}>
      <legend className="sr-only">评估内容</legend>
      {assessmentFields.map(([field, label]) => <label className="form-field" key={field}>
        <span>{label}</span><textarea rows={2} maxLength={600} value={draft[field]}
          onChange={(event) => change({ [field]: event.target.value })} /></label>)}
      <label className="form-field"><span>下期调整</span>
        <textarea rows={2} maxLength={600} value={draft.adjustment}
          onChange={(event) => change({ adjustment: event.target.value })} /></label>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      {session.source !== currentSource ? <p role="status">
        {saved ? "原来源评估已保存。" : "正在编辑原来源评估。"}
      </p> : saved ? <p role="status">评估已保存。</p> : null}
      <button type="submit" className="button-primary" disabled={saving}>
        {saving ? "保存中" : "保存本期评估"}</button>
      <button type="button" className="button-secondary" disabled={saving || !ready}
        onClick={() => {
          if (savingRef.current || !ready) return;
          setSession({ source: currentSource, service });
          setDraft({ periodKind: kind, periodStart, clarity: existing?.clarity ?? "",
            alignment: existing?.alignment ?? "", reviews: existing?.reviews ?? "",
            decisions: existing?.decisions ?? "", earlyIssues: existing?.earlyIssues ?? "",
            adjustment: existing?.adjustment ?? "" });
          setError(""); setSaved(false);
        }}>撤销修改</button>
      </fieldset>
    </form>
  </section>;
}
