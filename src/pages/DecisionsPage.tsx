import { Pencil, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { DecisionEditorDialog } from "../components/DecisionEditorDialog";
import { useTemplateEditorRequest } from "../components/useTemplateEditorRequest";
import { TemplateRequestNotice } from "../components/TemplateRequestNotice";
import type { Decision } from "../domain/decisions/Decision";
import type { LifeDomain } from "../domain/life/LifeDomain";
import { navigationLabels, type LifeNavigation } from "../domain/life/LifeNavigation";
import { resourceKindLabels, type ResourceNeed } from "../domain/resources/Resources";
import type { Person } from "../domain/records/LifeRecords";
import type { Goal } from "../domain/planning/Goal";

type PageState = { kind: "loading" } | { kind: "error"; message: string } |
  { kind: "ready"; decisions: readonly Decision[]; domains: readonly LifeDomain[]; goals: readonly Goal[]; navigation: readonly LifeNavigation[]; people: readonly Person[]; resourceNeeds: readonly ResourceNeed[] };
type Filter = "all" | "considering" | "decided";

const fields = [
  { key: "background", label: "背景" },
  { key: "options", label: "可选方案" },
  { key: "constraints", label: "现实约束" },
  { key: "criteria", label: "评价维度" },
  { key: "risks", label: "风险" },
  { key: "opportunityCost", label: "机会成本" },
  { key: "rationale", label: "选择理由" },
  { key: "executionConditions", label: "执行条件" },
  { key: "outcome", label: "后续结果" },
  { key: "reflection", label: "复盘" },
] as const;

export function DecisionsPage() {
  const { decisionService, lifeDomainService, goalService, lifeNavigationService, lifeRecordsService, resourceService } = useLifeOS();
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const mounted = useRef(false);
  const generation = useRef(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [ignoredHash, setIgnoredHash] = useState("");

  const load = useCallback(async (): Promise<PageState> => {
    try {
      const [decisions, domains, goals, navigation, people, resourceNeeds] = await Promise.all([
        decisionService.list(), lifeDomainService.list(), goalService.list(), lifeNavigationService.list(), lifeRecordsService.listPeople(), resourceService.list(),
      ]);
      return { kind: "ready", decisions, domains, goals, navigation, people, resourceNeeds };
    } catch {
      return { kind: "error", message: "无法读取决策记录，请重试。" };
    }
  }, [decisionService, lifeDomainService, goalService, lifeNavigationService, lifeRecordsService, resourceService]);
  const [result, setResult] = useState<{ source: typeof load; state: PageState } | null>(null);
  const state = useMemo<PageState>(() => result?.source === load ? result.state : { kind: "loading" }, [result, load]);
  const domainFilter = params.get("domain") ?? "";
  const validDomain = !params.has("domain") ||
    (state.kind === "ready" && state.domains.some(domain => domain.id === domainFilter));
  const { editing, setEditing, editorOpen, templateId, templateError, retryTemplate, cancelRequest, dismissEditor } =
    useTemplateEditorRequest<Decision>("decision", state.kind === "ready" && validDomain);
  const modalBusy = Boolean(editing) || Boolean(templateId);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);
  const reload = useCallback(() => {
    if (!mounted.current) return;
    const request = ++generation.current;
    setResult({ source: load, state: { kind: "loading" } });
    void load().then(next => {
      if (mounted.current && request === generation.current) setResult({ source: load, state: next });
    });
  }, [load]);
  useEffect(() => {
    const request = ++generation.current;
    void load().then(next => {
      if (mounted.current && request === generation.current) setResult({ source: load, state: next });
    });
    return () => { generation.current += 1; };
  }, [load]);
  useEffect(() => {
    if (state.kind === "ready" && hash) {
      try { document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "center" }); }
      catch { /* A malformed source link must not interrupt browsing. */ }
    }
  }, [hash, state, filter, ignoredHash]);

  function changeDomain(value: string) {
    if (editorOpen.current || (validDomain && templateId)) return;
    const next = new URLSearchParams(params);
    if (value) next.set("domain", value);
    else next.delete("domain");
    void navigate({ pathname, search: next.toString(), hash }, { preventScrollReset: true });
  }

  function renderContent() {
  if (state.kind === "loading") return <div className="context-loading" aria-live="polite">正在打开决策记录</div>;
  if (state.kind === "error") return <section className="not-found-page">
    <p className="eyebrow">读取失败</p>
    <h1>暂时无法打开决策记录</h1>
    <p className="page-intro">{state.message}</p>
    <button className="button-secondary" type="button" onClick={reload}>重试</button>
  </section>;
  if (!validDomain) return <section className="not-found-page">
    <h1>无法按当前领域查看决策记录</h1>
    <p className="page-intro">这个领域已不存在或筛选为空。清除筛选后可查看全局记录。</p>
    <button className="button-secondary" type="button" disabled={Boolean(editing)}
      onClick={() => changeDomain("")}>清除失效筛选</button>
  </section>;

  const { decisions, domains, goals, navigation, people, resourceNeeds } = state;
  const domainMap = new Map(domains.map((domain) => [domain.id, domain]));
  const resourceMap = new Map(resourceNeeds.map((need) => [need.id, need]));
  const peopleMap = new Map(people.map((item) => [item.id, item]));
  const navigationMap = new Map(navigation.map((item) => [item.id, item]));
  const goalMap = new Map(goals.map((goal) => [goal.id, goal]));
  let linkedId = "";
  try { if (hash.startsWith("#decision-")) linkedId = decodeURIComponent(hash.slice("#decision-".length)); }
  catch { /* Ignore invalid source identifiers. */ }
  const activeFilter = hash !== ignoredHash && decisions.some(decision => decision.id === linkedId) ? "all" : filter;
  const visible = decisions.filter((decision) =>
    (activeFilter === "all" || decision.status === activeFilter) &&
    (!domainFilter || decision.domainIds.includes(domainFilter)));

  return (
    <>
      <section className="planning-heading">
        <div>
          <p className="eyebrow">决策</p>
          <h1>记下做选择的依据</h1>
        </div>
        <button className="button-primary" type="button" disabled={modalBusy}
          onClick={() => { if (!templateId) setEditing(current => current ?? {}); }}>
          <Plus aria-hidden="true" size={17} />记录决策
        </button>
      </section>
      <section className="issues-section" aria-label="决策记录">
        <div className="issue-filters">
          <div className="inbox-tabs" role="tablist" aria-label="决策状态">
            {([{ value: "all", label: "全部" }, { value: "considering", label: "考虑中" },
              { value: "decided", label: "已选择" }] as const).map(({ value, label }) => (
              <button key={value} type="button" role="tab" aria-selected={activeFilter === value}
                disabled={modalBusy}
                className={activeFilter === value ? "inbox-tab selected" : "inbox-tab"}
                onClick={() => { if (!editorOpen.current && !templateId) { setIgnoredHash(hash); setFilter(value); } }}>{label}</button>
            ))}
          </div>
          <label className="issue-filter-domain">
            <span className="sr-only">按生活领域筛选</span>
            <select aria-label="按生活领域筛选" value={domainFilter} disabled={modalBusy}
              onChange={(event) => changeDomain(event.target.value)}>
              <option value="">全部领域</option>
              {domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.name}</option>)}
            </select>
          </label>
        </div>
        {!editing && templateId ? <TemplateRequestNotice category="decision" label="决策"
          message={templateError} onRetry={retryTemplate} onCancel={cancelRequest} /> : null}
        {visible.length ? <ol className="issue-list">
          {visible.map((decision) => <li key={decision.id} id={`decision-${decision.id}`} className="issue-row">
            <div className="issue-row-main">
              <div className="issue-title-line">
                <h2>{decision.title}</h2>
                {decision.importance === "major" ? <span className="goal-status status-active">重大决策</span> : null}
                <span className={`goal-status status-${decision.status === "decided" ? "completed" : "paused"}`}>
                  {decision.status === "decided" ? "已选择" : "考虑中"}
                </span>
              </div>
              {decision.choice ? <p className="issue-description">选择：{decision.choice}</p> : null}
              <div className="planning-meta">
                <time dateTime={decision.decidedOn}>{decision.decidedOn}</time>
                {decision.domainIds.map((id) => {
                  const domain = domainMap.get(id);
                  return domain ? <span className={`domain-meta domain-color-${domain.color}`} key={id}>
                    <i aria-hidden="true" />{domain.name}</span> : null;
                })}
                {decision.goalId && goalMap.has(decision.goalId)
                  ? <span>目标 · {goalMap.get(decision.goalId)?.title}</span> : null}
              </div>
              {(decision.navigationIds ?? []).length ? <div className="planning-meta">
                {(decision.navigationIds ?? []).map((id) => {
                  const item = navigationMap.get(id);
                  return item ? <Link key={id} to={`/navigation?kind=${item.kind}&archived=${item.archivedAt ? "true" : "false"}#navigation-${encodeURIComponent(id)}`}>
                    {navigationLabels[item.kind]} · {item.title}{item.archivedAt ? "（已归档）" : ""}
                  </Link> : null;
                })}
              </div> : null}
              {(decision.personIds ?? []).length ? <div className="planning-meta">
                {(decision.personIds ?? []).map((id) => {
                  const person = peopleMap.get(id);
                  return person ? <Link key={id} to={`/people#person-${encodeURIComponent(id)}`}>
                    人物 · {person.name}{person.archived ? "（已归档）" : ""}
                  </Link> : null;
                })}
              </div> : null}
              {(decision.resourceNeedIds ?? []).length ? <div className="planning-meta">
                {(decision.resourceNeedIds ?? []).map((id) => {
                  const need = resourceMap.get(id);
                  return need ? <Link key={id} to={`/resources?${need.goalId ? `goal=${encodeURIComponent(need.goalId)}` : `decision=${encodeURIComponent(need.decisionId ?? decision.id)}`}#resource-${encodeURIComponent(id)}`}>
                    {resourceKindLabels[need.kind]} · {need.description} · {need.met ? "已具备" : "缺口"}
                  </Link> : null;
                })}
              </div> : null}
              {decision.importance === "major" || fields.some(({ key }) => Boolean(decision[key])) ||
                decision.reversibility !== "unknown" ? <details className="issue-details">
                <summary>决策档案</summary>
                {fields.filter(({ key }) => decision[key]).map(({ key, label }) => (
                  <div key={key}><span className="eyebrow">{label}</span><p>{decision[key]}</p></div>
                ))}
                {decision.importance === "major" || decision.reversibility !== "unknown" ? <div>
                  <span className="eyebrow">可逆性</span>
                  <p>{decision.reversibility === "reversible" ? "可以回退"
                    : decision.reversibility === "difficult" ? "难以回退" : "尚未判断"}</p>
                </div> : null}
              </details> : null}
            </div>
            <div className="issue-row-actions">
              <Link className="history-link" to={"/resources?decision=" + encodeURIComponent(decision.id)}
                title={"查看" + decision.title + "的资源缺口"}>资源缺口</Link>
              <Link className="history-link" to={`/history?type=decision&id=${encodeURIComponent(decision.id)}`}
                title={`查看${decision.title}的历史`}>历史</Link>
              <button className="icon-button" type="button" title="编辑决策"
                disabled={modalBusy}
                aria-label={`编辑决策：${decision.title}`}
                onClick={() => { if (!templateId) setEditing(current => current ?? { object: decision }); }}>
                <Pencil aria-hidden="true" size={17} />
              </button>
            </div>
          </li>)}
        </ol> : <div className="planning-empty"><p>这里还没有符合条件的决策记录。</p></div>}
      </section>
    </>
  );
  }

  return <>{renderContent()}
    {editing ? <DecisionEditorDialog key={editing.object?.id ?? "new"} template={editing.template}
      decision={editing.object} domains={state.kind === "ready" ? state.domains : []}
      goals={state.kind === "ready" ? state.goals : []}
      navigation={state.kind === "ready" ? state.navigation : []}
      people={state.kind === "ready" ? state.people : []}
      resourceNeeds={state.kind === "ready" ? state.resourceNeeds : []} defaultDomainId={domainFilter}
      onClose={dismissEditor}
      onSaved={() => { dismissEditor(); reload(); }} /> : null}
  </>;
}
