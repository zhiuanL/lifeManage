import { Pencil, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { IssueEditorDialog } from "../components/IssueEditorDialog";
import { useTemplateEditorRequest } from "../components/useTemplateEditorRequest";
import { TemplateRequestNotice } from "../components/TemplateRequestNotice";
import { IssueValidationError, type Issue } from "../domain/issues/Issue";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { Goal } from "../domain/planning/Goal";
import { IssueRecurrenceRecordedError } from "../services/issues/IssueService";

type PageState = { kind: "loading" } | { kind: "error"; message: string } |
  { kind: "ready"; issues: readonly Issue[]; domains: readonly LifeDomain[]; goals: readonly Goal[] };
type StatusFilter = "active" | "resolved" | "all";

export function IssuesPage() {
  const { issueService, lifeDomainService, goalService } = useLifeOS();
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>("active");
  const [ignoredHash, setIgnoredHash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const sourceEpoch = useRef(0);

  const load = useCallback(async (): Promise<PageState> => {
    try {
      const [issues, domains, goals] = await Promise.all([
        issueService.list(), lifeDomainService.list(), goalService.list(),
      ]);
      return { kind: "ready", issues, domains, goals };
    } catch {
      return { kind: "error", message: "无法读取问题记录，请重试。" };
    }
  }, [issueService, lifeDomainService, goalService]);

  const [result, setResult] = useState<{ source: typeof load; state: PageState } | null>(null);
  const state = useMemo<PageState>(() => result?.source === load ? result.state : { kind: "loading" }, [result, load]);
  const domainFilter = params.get("domain") ?? "";
  const validDomain = !params.has("domain") ||
    (state.kind === "ready" && state.domains.some(domain => domain.id === domainFilter));
  const { editing, setEditing, editorOpen, templateId, templateError, retryTemplate, cancelRequest, dismissEditor } =
    useTemplateEditorRequest<Issue>("issue", state.kind === "ready" && validDomain, busy);
  const modalBusy = busy || Boolean(editing) || Boolean(templateId);
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
    sourceEpoch.current += 1;
    const request = ++generation.current;
    void load().then(next => {
      if (mounted.current && request === generation.current) setResult({ source: load, state: next });
    });
    return () => { sourceEpoch.current += 1; generation.current += 1; };
  }, [load]);

  useEffect(() => {
    if (state.kind === "ready" && hash) {
      try { document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "center" }); }
      catch { /* A malformed source link must not interrupt browsing. */ }
    }
  }, [hash, state, status, ignoredHash]);

  async function recur(issue: Issue) {
    if (busyRef.current || editorOpen.current || templateId || !validDomain) return;
    const epoch = sourceEpoch.current;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await issueService.recordRecurrence(issue.id);
      if (mounted.current && epoch === sourceEpoch.current) reload();
    } catch (reason) {
      if (mounted.current && epoch === sourceEpoch.current) {
        if (reason instanceof IssueRecurrenceRecordedError) {
          generation.current += 1;
          setResult({ source: load, state: { kind: "error", message: reason.message } });
        } else {
          setError(reason instanceof IssueValidationError ? reason.message : "记录失败，请重试。");
        }
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function changeDomain(value: string) {
    if (busyRef.current || editorOpen.current || (validDomain && templateId)) return;
    const next = new URLSearchParams(params);
    if (value) next.set("domain", value);
    else next.delete("domain");
    void navigate({ pathname, search: next.toString(), hash }, { preventScrollReset: true });
  }

  function renderContent() {
  if (state.kind === "loading") return <div className="context-loading" aria-live="polite">正在打开问题记录</div>;
  if (state.kind === "error") return (
    <section className="not-found-page">
      <p className="eyebrow">读取失败</p>
      <h1>暂时无法打开问题记录</h1>
      <p className="page-intro">{state.message}</p>
      <button className="button-secondary" type="button" onClick={reload}>重试</button>
    </section>
  );
  if (!validDomain) return <section className="not-found-page">
    <h1>无法按当前领域查看问题记录</h1>
    <p className="page-intro">这个领域已不存在或筛选为空。清除筛选后可查看全局记录。</p>
    <button className="button-secondary" type="button" disabled={busy || Boolean(editing)}
      onClick={() => changeDomain("")}>清除失效筛选</button>
  </section>;

  const { issues, domains, goals } = state;
  const domainMap = new Map(domains.map((domain) => [domain.id, domain]));
  const goalMap = new Map(goals.map((goal) => [goal.id, goal]));
  let linkedId = "";
  try { if (hash.startsWith("#issue-")) linkedId = decodeURIComponent(hash.slice("#issue-".length)); }
  catch { /* Ignore invalid source identifiers. */ }
  const activeStatus = hash !== ignoredHash && issues.some(issue => issue.id === linkedId) ? "all" : status;
  const visible = issues.filter((issue) =>
    (activeStatus === "all" || (activeStatus === "active" ? issue.status !== "resolved" : issue.status === "resolved")) &&
    (!domainFilter || issue.domainIds.includes(domainFilter)));

  return (
    <>
      <section className="planning-heading issue-heading">
        <div>
          <p className="eyebrow">问题追踪</p>
          <h1>把反复出现的事看清楚</h1>
        </div>
        <button className="button-primary" type="button" disabled={modalBusy}
          onClick={() => { if (!busyRef.current && !templateId) setEditing(current => current ?? {}); }}>
          <Plus aria-hidden="true" size={17} />记录问题
        </button>
      </section>
      <section className="issues-section" aria-label="问题记录">
        <div className="issue-filters">
          <div className="inbox-tabs" role="tablist" aria-label="问题状态">
            {([
              { value: "active", label: "进行中" },
              { value: "resolved", label: "已解决" },
              { value: "all", label: "全部" },
            ] as const).map(({ value, label }) => (
              <button key={value} type="button" role="tab" aria-selected={activeStatus === value}
                disabled={modalBusy}
                className={activeStatus === value ? "inbox-tab selected" : "inbox-tab"}
                onClick={() => {
                  if (!busyRef.current && !editorOpen.current && !templateId) {
                    setIgnoredHash(hash); setStatus(value);
                  }
                }}>{label}</button>
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
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {!editing && templateId ? <TemplateRequestNotice category="issue" label="问题"
          message={templateError} onRetry={retryTemplate} onCancel={cancelRequest} /> : null}
        {visible.length === 0 ? (
          <div className="planning-empty"><p>这里还没有符合条件的问题记录。</p></div>
        ) : (
          <ol className="issue-list">
            {visible.map((issue) => (
              <li key={issue.id} id={`issue-${issue.id}`} className="issue-row">
                <div className="issue-row-main">
                  <div className="issue-title-line">
                    <h2>{issue.title}</h2>
                    <span className={`goal-status status-${issue.status === "open" ? "active" : issue.status === "watching" ? "paused" : "completed"}`}>
                      {statusNames[issue.status]}
                    </span>
                  </div>
                  {issue.description ? <p className="issue-description">{issue.description}</p> : null}
                  <div className="planning-meta">
                    <time dateTime={issue.firstSeen}>首次发现 {issue.firstSeen}</time>
                    <span>出现 {issue.occurrenceCount} 次</span>
                    {issue.domainIds.map((id) => {
                      const domain = domainMap.get(id);
                      return domain ? <span className={`domain-meta domain-color-${domain.color}`} key={id}>
                        <i aria-hidden="true" />{domain.name}</span> : null;
                    })}
                    {issue.goalId && goalMap.has(issue.goalId) ? (
                      <span>目标 · {goalMap.get(issue.goalId)?.title}</span>
                    ) : null}
                  </div>
                  {issue.causeHypothesis || issue.attempts || issue.followUp ? (
                    <details className="issue-details">
                      <summary>原因与后续</summary>
                      {([
                        { label: "原因假设", content: issue.causeHypothesis },
                        { label: "尝试方案", content: issue.attempts },
                        { label: "后续回看", content: issue.followUp },
                      ]).filter((field) => field.content).map((field) => (
                        <div key={field.label}>
                          <span className="eyebrow">{field.label}</span>
                          <p>{field.content}</p>
                        </div>
                      ))}
                    </details>
                  ) : null}
                </div>
                <div className="issue-row-actions">
                  <Link className="history-link" to={`/history?type=issue&id=${encodeURIComponent(issue.id)}`}
                    title={`查看${issue.title}的历史`}>历史</Link>
                  <button className="icon-button" type="button" disabled={modalBusy || issue.occurrenceCount >= 999999}
                    title="记录再次出现" aria-label={`记录再次出现：${issue.title}`}
                    onClick={() => void recur(issue)}><RotateCcw aria-hidden="true" size={17} /></button>
                  <button className="icon-button" type="button" title="编辑问题"
                    disabled={modalBusy}
                    aria-label={`编辑问题：${issue.title}`}
                    onClick={() => { if (!busyRef.current && !templateId) setEditing(current => current ?? { object: issue }); }}>
                    <Pencil aria-hidden="true" size={17} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
  }

  return <>{renderContent()}
      {editing ? <IssueEditorDialog key={editing.object?.id ?? "new"} issue={editing.object}
        template={editing.template}
        domains={state.kind === "ready" ? state.domains : []}
        goals={state.kind === "ready" ? state.goals : []} defaultDomainId={domainFilter}
        onClose={dismissEditor}
        onSaved={() => { dismissEditor(); reload(); }} /> : null}
    </>;
}

const statusNames = { open: "跟进中", watching: "观察中", resolved: "已解决" };
