import { Pencil, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import type { ResourceNeed, ResourceNeedDraft } from "../domain/resources/Resources";
import { ResourceValidationError, resourceKinds, resourceKindLabels } from "../domain/resources/Resources";
import type { Goal } from "../domain/planning/Goal";
import type { Decision } from "../domain/decisions/Decision";
import type { Action } from "../domain/planning/Action";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { Person, Skill } from "../domain/records/LifeRecords";
import type { MetricDefinition, MetricRecord } from "../domain/life/DomainMetric";

import { latestResourceMetrics, summarizeResourceNeeds } from "../domain/resources/ResourceFacts";
import { localDate } from "../domain/habits/Habit";
import type { ResourceService } from "../services/resources/ResourceService";

type Data = { domains: readonly LifeDomain[]; goals: readonly Goal[];
  actions: readonly Action[]; people: readonly Person[]; skills: readonly Skill[];
  metrics: readonly MetricDefinition[]; metricRecords: readonly MetricRecord[]; needs: readonly ResourceNeed[]; decisions: readonly Decision[] };
type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: Data };
type ResourceLoader = () => Promise<State>;
type ReadResult = { source: ResourceLoader; generation: number; state: State };
type NeedEditorState = { source: ResourceLoader; service: ResourceService; need?: ResourceNeed; goals: readonly Goal[]; skills: readonly Skill[];
  people: readonly Person[]; defaultGoalId: string; decision?: Decision };

export function ResourcesPage() {
  const { resourceService, lifeRecordsService, lifeDomainService,
    goalService, actionService, domainMetricService, decisionService } = useLifeOS();
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [result, setResult] = useState<ReadResult | null>(null);
  const [generation, setGeneration] = useState(0);
  const [editing, setEditing] = useState<NeedEditorState>();
  const [error, setError] = useState<{ source: ResourceLoader; generation: number; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);
  const editorOpen = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const load = useCallback(async (): Promise<State> => {
    try {
      const [domains, goals, actions, people, skills, metrics, needs, decisions, metricRecords] = await Promise.all([
        lifeDomainService.list(), goalService.list(), actionService.list(),
        lifeRecordsService.listPeople(), lifeRecordsService.listSkills(),
        domainMetricService.listDefinitions(), resourceService.list(), decisionService?.list() ?? [], domainMetricService.listRecords(),
      ]);
      return { kind: "ready", data: { domains, goals, actions, people, skills, metrics, needs, decisions, metricRecords } };
    } catch {
      return { kind: "error", message: "资源记录读取失败，请重试。" };
    }
  }, [resourceService, lifeRecordsService, lifeDomainService, goalService, actionService,
    domainMetricService, decisionService]);
  const currentRead = useRef({ source: load, generation });
  useLayoutEffect(() => { currentRead.current = { source: load, generation }; }, [load, generation]);
  useEffect(() => {
    let current = true;
    void load().then(state => {
      if (current) setResult({ source: load, generation, state });
    });
    return () => { current = false; };
  }, [load, generation]);
  const state = useMemo<State>(() => result?.source === load && result.generation === generation
    ? result.state : { kind: "loading" }, [result, load, generation]);
  useEffect(() => {
    if (state.kind === "ready" && hash) {
      let fragment: string;
      try { fragment = decodeURIComponent(hash.slice(1)); }
      catch { return; }
      document.getElementById(fragment)?.scrollIntoView({ block: "center" });
    }
  }, [hash, state]);
  const reload = () => setGeneration(value => value + 1);
  const closeEditor = () => {
    editorOpen.current = false;
    setEditing(undefined);
  };
  const setParams = (next: URLSearchParams, options?: { replace: boolean }) =>
    navigate({ pathname, search: next.toString() ? `?${next.toString()}` : "", hash }, options);
  const renderEditor = () => editing ? <NeedEditor key={editing.need?.id ?? "new"}
    {...editing} onClose={closeEditor} onSaved={() => {
      if (!mounted.current) return;
      closeEditor();
      if (currentRead.current.source === editing.source) reload();
    }} /> : null;
  // Keep the editor under the same parent when route validation or a reread fails.
  const renderPage = (context: ReactNode, facts?: ReactNode) => <section className="record-page">
    {context}{renderEditor()}{facts}
  </section>;
  if (state.kind === "loading") return renderPage(<p className="context-loading">正在整理资源</p>);
  if (state.kind === "error") return renderPage(<section className="not-found-page">
    <h1>暂时无法打开资源</h1><p role="alert">{state.message}</p>
    <button type="button" className="button-secondary" onClick={reload}>重试</button>
  </section>);
  const { data } = state;
  const requestedDomainId = params.get("domain");
  const domainId = requestedDomainId ?? "";
  const invalidDomain = params.has("domain") &&
    (!requestedDomainId || !data.domains.some((domain) => domain.id === requestedDomainId));
  const goals = data.goals.filter((goal) => !domainId || goal.domainIds.includes(domainId));
  const requestedGoalId = params.get("goal");
  const decisionId = params.get("decision") ?? "";
  const decisions = data.decisions.filter((decision) => !domainId || decision.domainIds.includes(domainId));
  const decision = decisions.find((item) => item.id === decisionId);
  const invalidDecision = params.has("decision") && (!decisionId || !data.decisions.some((item) =>
    item.id === decisionId && (!domainId || invalidDomain || item.domainIds.includes(domainId))));
  const invalidGoal = params.has("goal") && (!requestedGoalId ||
    !data.goals.some((goal) => goal.id === requestedGoalId &&
      (!domainId || invalidDomain || goal.domainIds.includes(domainId))));
  if (invalidDomain || invalidGoal || invalidDecision) {
    return renderPage(<section className="not-found-page">
      <h1>无法按当前条件查看资源</h1>
      <p>{invalidDomain ? "链接中的生活领域已不存在。" :
        invalidDecision ? "链接中的决策已不存在，或不属于当前领域。" : "链接中的目标已不存在，或不属于当前领域。"}清除失效筛选后可重新查看记录。</p>
      <button type="button" className="button-secondary" disabled={busy || Boolean(editing)} onClick={() => {
        if (savingRef.current || editorOpen.current) return;
        const next = new URLSearchParams(params);
        if (invalidDomain) next.delete("domain");
        if (invalidGoal) next.delete("goal");
        if (invalidDecision) next.delete("decision");
        setParams(next, { replace: true });
      }}>清除失效筛选</button>
    </section>);
  }
  const goalId = requestedGoalId ?? "";
  const inScope = new Set((goalId ? goals.filter((goal) => goal.id === goalId) : goals).map((g) => g.id));
  const decisionNeeds = new Set(decision?.resourceNeedIds ?? []);
  const scopedNeeds = data.needs.filter((need) => decision
    ? (need.decisionId === decision.id || decisionNeeds.has(need.id)) && (!goalId || need.goalId === goalId)
    : (need.goalId ? inScope.has(need.goalId) : !goalId && Boolean(need.decisionId && decisions.some((item) => item.id === need.decisionId))));
  const gapOnly = params.get("status") === "gap";
  const needs = scopedNeeds.filter((need) => !gapOnly || !need.met);
  const gapCount = scopedNeeds.filter((need) => !need.met).length;
  const referencedSkills = new Set(scopedNeeds.map((need) => need.skillId).filter(Boolean));
  const referencedPeople = new Set(scopedNeeds.map((need) => need.personId).filter(Boolean));
  const skills = data.skills.filter((skill) => !skill.archived &&
    (decision ? referencedSkills.has(skill.id) : goalId ? skill.goalId === goalId || referencedSkills.has(skill.id) :
      !domainId || skill.domainIds.includes(domainId) || referencedSkills.has(skill.id) ||
      (skill.goalId ? inScope.has(skill.goalId) : false)));
  const people = data.people.filter((person) => !person.archived &&
    (decision ? referencedPeople.has(person.id) : goalId ? referencedPeople.has(person.id) :
      !domainId || person.domainIds.includes(domainId) || referencedPeople.has(person.id)));
  const actions = data.actions.filter((action) => action.status === "open" &&
    (decision ? Boolean(decision.goalId && action.goalId === decision.goalId && (!goalId || action.goalId === goalId)) : goalId ? action.goalId === goalId : !domainId || action.domainIds.includes(domainId) ||
      (action.goalId ? inScope.has(action.goalId) : false)));
  const selectedGoal = goals.find((goal) => goal.id === goalId);
  const contextDomains = domainId ? [domainId] : decision && selectedGoal
    ? decision.domainIds.filter((id) => selectedGoal.domainIds.includes(id))
    : decision ? decision.domainIds : selectedGoal ? selectedGoal.domainIds : null;
  const metrics = data.metrics.filter((metric) => !metric.archived &&
    (contextDomains === null || metric.domainIds.some((id) => contextDomains.includes(id))));
  const metricFacts = latestResourceMetrics(metrics, data.metricRecords, localDate(new Date()));
  const kindSummary = summarizeResourceNeeds(scopedNeeds);
  const plannedActions = [...actions].sort((a, b) =>
    (a.scheduledFor ?? "9999").localeCompare(b.scheduledFor ?? "9999") || a.title.localeCompare(b.title));
  const goalsById = new Map(data.goals.map((goal) => [goal.id, goal]));
  const locked = busy || Boolean(editing);
  function openEditor(need?: ResourceNeed) {
    if (savingRef.current || editorOpen.current || !mounted.current) return;
    editorOpen.current = true;
    setEditing({ source: load, service: resourceService, need, goals: decision ? data.goals : goals, skills: data.skills, people: data.people,
      defaultGoalId: goalId, decision: need?.decisionId
        ? data.decisions.find(item => item.id === need.decisionId) : decision });
  }
  async function mark(need: ResourceNeed) {
    if (savingRef.current || editorOpen.current || !mounted.current) return;
    const original = currentRead.current;
    const isCurrent = () => mounted.current &&
      currentRead.current.source === original.source && currentRead.current.generation === original.generation;
    savingRef.current = true; setBusy(true); setError(null);
    try {
      const saved = await resourceService.save({ ...need, met: !need.met }, need.id);
      if (isCurrent()) setResult({ ...original, state: {
        kind: "ready", data: { ...data, needs: data.needs.map(item => item.id === saved.id ? saved : item) },
      } });
    } catch (reason) {
      if (isCurrent()) setError({ ...original, message: reason instanceof ResourceValidationError
        ? reason.message : "更新需求失败，请重试。" });
    } finally { savingRef.current = false; if (mounted.current) setBusy(false); }
  }
  return renderPage(<>
    <header className="planning-heading">
      <div><p className="eyebrow">目标与决策的可用条件</p><h1>资源总览</h1></div>
      <button type="button" className="button-primary" disabled={locked || (!goals.length && !decision)}
        onClick={() => openEditor()}><Plus size={17} aria-hidden="true" />{decision ? "记录决策需求" : "记录目标需求"}</button>
    </header>
    <div className="attention-filters">
      <label className="attention-control"><span>生活领域</span>
        <select value={domainId} disabled={locked} onChange={(e) => {
          if (savingRef.current || editorOpen.current) return;
          const next = new URLSearchParams(params);
          if (e.target.value) next.set("domain", e.target.value); else next.delete("domain");
          next.delete("goal"); next.delete("decision"); setParams(next);
        }}>
          <option value="">全部领域</option>
          {data.domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.name}</option>)}
        </select></label>
      <label className="attention-control"><span>目标</span>
        <select value={goalId} disabled={locked} onChange={(e) => {
          if (savingRef.current || editorOpen.current) return;
          const next = new URLSearchParams(params);
          if (e.target.value) next.set("goal", e.target.value); else next.delete("goal");
          setParams(next);
        }}>
          <option value="">全部目标</option>
          {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
        </select></label>
      <label className="attention-control"><span>决策</span>
        <select value={decisionId} disabled={locked} onChange={(e) => {
          if (savingRef.current || editorOpen.current) return;
          const next = new URLSearchParams(params);
          next.delete("goal");
          if (e.target.value) next.set("decision", e.target.value); else next.delete("decision");
          setParams(next);
        }}>
          <option value="">全部决策</option>
          {decisions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>
      <label className="record-archive-filter"><input type="checkbox" checked={gapOnly} disabled={locked}
        onChange={(e) => {
          if (savingRef.current || editorOpen.current) return;
          const next = new URLSearchParams(params);
          if (e.target.checked) next.set("status", "gap"); else next.delete("status");
          setParams(next);
        }} />仅看待补齐</label>
    </div>
    </>, <>
    {error?.source === load && error.generation === generation
      ? <p role="alert" className="form-error">{error.message}</p> : null}
    <section className="record-timeline">
      <h2>{decision ? "决策需要的资源" : "目标需要的资源"}</h2>
      {decision ? <Link to={"/decisions#decision-" + encodeURIComponent(decision.id)}>返回决策：{decision.title}</Link> : null}
      <p className="planning-meta">已记录 {scopedNeeds.length} 项 · 已具备 {scopedNeeds.length - gapCount} 项 · 待补齐 {gapCount} 项</p>
      {needs.length ? <ol>{needs.map((need) => <li key={need.id} id={`resource-${need.id}`} className="resource-need">
        <label><input type="checkbox" checked={need.met} disabled={locked}
          onChange={() => void mark(need)} />
          <span>{need.met ? "已具备" : "待补齐"} · {resourceKindLabels[need.kind]}</span></label>
        <span>{need.description}</span>
        {need.goalId ? <Link to={`/goals#goal-${encodeURIComponent(need.goalId)}`}>
          {goalsById.get(need.goalId)?.title ?? "目标"}</Link> :
          <Link to={`/decisions#decision-${encodeURIComponent(need.decisionId ?? "")}`}>
            {data.decisions.find((item) => item.id === need.decisionId)?.title ?? "决策"}</Link>}
        {need.skillId ? <Link to={`/skills#skill-${encodeURIComponent(need.skillId)}`}>关联能力</Link> : null}
        {need.personId ? <Link to={`/people#person-${encodeURIComponent(need.personId)}`}>关联人物</Link> : null}
        <button type="button" className="icon-button" title="编辑资源需求"
          aria-label={`编辑资源需求：${need.description}`} disabled={locked} onClick={() => openEditor(need)}>
          <Pencil size={15} aria-hidden="true" /></button>
      </li>)}</ol> : <p className="context-summary-empty">
        {gapOnly && scopedNeeds.length ? "当前已记录的需求均已具备。" : "暂无明确记录的资源需求；没有记录不代表资源充足或不足。"}</p>}
    </section>
    <section className="record-timeline" aria-label="资源分类汇总">
      <h2>资源缺口分类</h2>
      <ol>{kindSummary.map((item) => <li key={item.kind}>
        <span>{resourceKindLabels[item.kind]}</span>
        <span>已记录 {item.total} · 已具备 {item.met} · 待补齐 {item.gap}</span>
      </li>)}</ol>
    </section>
    <div className="resource-columns">
      <section className="record-timeline"><h2>能力 · {skills.length}</h2>
        {skills.length ? <ol>{skills.map((skill) => <li key={skill.id}>
          <Link to={`/skills#skill-${encodeURIComponent(skill.id)}`}>{skill.name}</Link>
          <span>当前 {skill.currentLevel} / 期望 {skill.targetLevel}</span></li>)}</ol> :
          <p className="context-summary-empty">暂无相关能力记录。</p>}</section>
      <section className="record-timeline"><h2>人物 · {people.length}</h2>
        {people.length ? <ol>{people.map((person) => <li key={person.id}>
          <Link to={`/people#person-${encodeURIComponent(person.id)}`}>{person.name}</Link>
          <span>{person.relationshipType || "重要关系"}</span></li>)}</ol> :
          <p className="context-summary-empty">暂无相关人物记录。</p>}</section>
      <section className="record-timeline"><h2>时间与状态线索</h2>
        <p>未完成行动 {actions.length} 项；已记录的状态指标 {metrics.length} 项。</p>
        {plannedActions.length ? <ol>{plannedActions.map((action) => <li key={action.id}>
          <Link to={`/goals#action-${encodeURIComponent(action.id)}`}>{action.title}</Link>
          <span>{action.scheduledFor ?? "尚未安排日期"}</span>
        </li>)}</ol> : <p className="context-summary-empty">暂无相关未完成行动。</p>}
        {metricFacts.length ? <ol>{metricFacts.map(({ definition, latest }) => <li key={definition.id}>
          <Link to={`/metrics#${latest ? `metric-record-${encodeURIComponent(latest.id)}`
            : `metric-${encodeURIComponent(definition.id)}`}`}>{definition.name}</Link>
          <span>{latest ? `${latest.value} ${definition.unit} · ${latest.recordedOn}` : "尚无截至今日的记录"}</span>
          {latest ? <span>{latest.note}</span> : null}
          {definition.domainIds.filter((id) => data.domains.some((domain) => domain.id === id))
            .map((id) => <Link key={id} to={`/domains/${encodeURIComponent(id)}${latest
              ? `#metric-record-${encodeURIComponent(latest.id)}` : `#metric-${encodeURIComponent(definition.id)}`}`}>
              {data.domains.find((domain) => domain.id === id)!.name}指标</Link>)}
        </li>)}</ol> : <p className="context-summary-empty">暂无相关状态指标。</p>}
        <p className="analytics-note">这些是已有记录的入口，不代表可支配时间或精力。财务和工具仅在资源需求中记录，不推测余额或库存。</p>
        <Link to="/calendar">查看行动日历</Link>
        {domainId ? <Link to={`/domains/${encodeURIComponent(domainId)}`}>查看领域状态</Link> : null}
      </section>
    </div>
  </>);
}

function NeedEditor({ service, need, goals, skills, people, defaultGoalId, decision, onClose, onSaved }: {
  service: ResourceService;
  need?: ResourceNeed; goals: readonly Goal[]; skills: readonly Skill[]; people: readonly Person[];
  decision?: Decision; defaultGoalId: string; onClose(): void; onSaved(): void;
}) {
  const [resourceService] = useState(() => service);
  const [draft, setDraft] = useState<ResourceNeedDraft>({
    goalId: need ? need.goalId : decision ? null : (defaultGoalId || goals[0]?.id || ""),
    decisionId: need?.decisionId ?? (need ? null : decision?.id ?? null),
    kind: need?.kind ?? "time", description: need?.description ?? "",
    skillId: need?.skillId ?? null, personId: need?.personId ?? null, met: need?.met ?? false,
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  function change(values: Partial<ResourceNeedDraft>) {
    if (!savingRef.current) setDraft(current => ({ ...current, ...values }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current || !mounted.current) return;
    savingRef.current = true; setSaving(true); setError("");
    try { await resourceService.save(draft, need?.id); if (mounted.current) onSaved(); }
    catch (reason) {
      if (mounted.current) setError(reason instanceof ResourceValidationError
        ? reason.message : "无法保存需求，请重试。");
    }
    finally { savingRef.current = false; if (mounted.current) setSaving(false); }
  }
  return <section className="record-editor" aria-label={draft.decisionId ? "决策资源需求" : "目标资源需求"}>
    <h2>{need ? "编辑需求" : "记录需求"}</h2>
    <form className="domain-form" aria-busy={saving} onSubmit={(event) => void submit(event)}>
      <fieldset className="record-edit-fields" disabled={saving}>
      <legend className="sr-only">需求内容</legend>
      <div className="planning-form-grid">
        {draft.decisionId ? <p>所属决策：{decision?.title ?? "决策"}</p> : <label className="form-field"><span>目标</span>
          <select disabled={Boolean(need)} value={draft.goalId ?? ""} onChange={(e) => change({ goalId: e.target.value })}>
            {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
          </select></label>}
        <label className="form-field"><span>资源类型</span>
          <select value={draft.kind} onChange={(e) => change({
            kind: e.target.value as ResourceNeedDraft["kind"], skillId: null, personId: null })}>
            {resourceKinds.map((kind) => <option key={kind} value={kind}>
              {resourceKindLabels[kind]}</option>)}</select></label>
      </div>
      <label className="form-field"><span>{draft.decisionId ? "决策需要什么" : "目标需要什么"}</span>
        <textarea required rows={2} maxLength={300} value={draft.description}
          onChange={(e) => change({ description: e.target.value })} /></label>
      {draft.kind === "skill" ? <label className="form-field"><span>引用已有能力</span>
        <select value={draft.skillId ?? ""} onChange={(e) => change({
          skillId: e.target.value || null })}>
          <option value="">暂不关联</option>{skills.filter((skill) => !skill.archived || skill.id === need?.skillId).map((skill) => <option key={skill.id} value={skill.id}>
            {skill.name}{skill.archived ? "（已归档）" : ""}</option>)}</select></label> : null}
      {draft.kind === "person" ? <label className="form-field"><span>引用已有人物</span>
        <select value={draft.personId ?? ""} onChange={(e) => change({
          personId: e.target.value || null })}>
          <option value="">暂不关联</option>{people.filter((person) => !person.archived || person.id === need?.personId).map((person) => <option key={person.id} value={person.id}>
            {person.name}{person.archived ? "（已归档）" : ""}</option>)}</select></label> : null}
      <label className="record-archive-filter"><input type="checkbox" checked={draft.met}
        onChange={(e) => change({ met: e.target.checked })} />已经具备</label>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      <footer className="dialog-actions">
        <button type="button" className="button-secondary" disabled={saving}
          onClick={() => { if (!savingRef.current) onClose(); }}>取消</button>
        <button type="submit" className="button-primary" disabled={saving}>保存需求</button>
      </footer>
      </fieldset>
    </form>
  </section>;
}
