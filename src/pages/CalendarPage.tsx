import { Check, ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { ActionEditorDialog } from "../components/ActionEditorDialog";
import { localDate } from "../domain/habits/Habit";
import type { LifeDomain } from "../domain/life/LifeDomain";
import { ActionValidationError, type Action } from "../domain/planning/Action";
import { buildCalendarEntries, calendarDates, calendarKindLabels, calendarKinds, moveCalendarAnchor,
  type CalendarEntry, type CalendarKind, type CalendarSources, type CalendarView } from "../domain/planning/Calendar";
import { isPlainDate } from "../domain/planning/Goal";

type CalendarData = CalendarSources & { domains: readonly LifeDomain[] };
type PageState = { kind: "loading" } | { kind: "error" } |
  { kind: "ready"; data: CalendarData };
type ActionEditorState = {
  action?: Action; goals: CalendarData["goals"]; domains: CalendarData["domains"];
  defaultDomainId: string;
};
export function CalendarPage() {
  const { lifeDomainService, goalService, actionService, lifeRecordsService, habitService, reviewService } = useLifeOS();
  const [params] = useSearchParams();
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();
  const requestedView = params.get("view");
  const validView = requestedView === null || ["agenda", "week", "month"].includes(requestedView);
  const view: CalendarView = validView && requestedView ? requestedView as CalendarView : "agenda";
  const [anchor, setAnchor] = useState(() => localDate(new Date()));
  const [kinds, setKinds] = useState<readonly CalendarKind[]>(calendarKinds);
  const [editor, setEditor] = useState<ActionEditorState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const editorOpen = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const loadData = useCallback(async (): Promise<PageState> => {
    try {
      const [domains, goals, actions, events, habits, logs, reviews] = await Promise.all([
        lifeDomainService.list(), goalService.list(), actionService.list(), lifeRecordsService.listEvents(),
        habitService.list(), habitService.listLogs(), reviewService.list(),
      ]);
      return { kind: "ready", data: { domains, goals, actions, events, habits, logs, reviews } };
    } catch {
      return { kind: "error" };
    }
  }, [actionService, goalService, lifeDomainService, lifeRecordsService, habitService, reviewService]);
  const [result, setResult] = useState<{ source: typeof loadData; state: PageState } | null>(null);
  const state: PageState = result?.source === loadData ? result.state : { kind: "loading" };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);
  const load = () => {
    if (!mounted.current) return;
    const request = ++generation.current;
    setResult({ source: loadData, state: { kind: "loading" } });
    void loadData().then(next => {
      if (mounted.current && request === generation.current) setResult({ source: loadData, state: next });
    });
  };
  useEffect(() => {
    const request = ++generation.current;
    void loadData().then(next => {
      if (mounted.current && request === generation.current) setResult({ source: loadData, state: next });
    });
    return () => { generation.current += 1; };
  }, [loadData]);
  const dates = useMemo(() => calendarDates(anchor, view), [anchor, view]);
  const toggleAction = async (action: Action) => {
    if (busyRef.current || editorOpen.current || !mounted.current) return;
    const request = generation.current;
    busyRef.current = true; setBusy(true); setError("");
    try {
      await actionService.toggleCompletion(action.id);
      if (!mounted.current || request !== generation.current) return;
      load();
    } catch (reason) {
      if (mounted.current && request === generation.current) setError(reason instanceof ActionValidationError
        ? reason.message : "无法更新行动状态，请重试。");
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const locked = busy || Boolean(editor);
  const canInteract = () => mounted.current && !busyRef.current && !editorOpen.current;
  const closeEditor = () => {
    if (!mounted.current) return;
    editorOpen.current = false; setEditor(undefined);
  };
  const editorDialog = editor ? <ActionEditorDialog key={editor.action?.id ?? "new"} {...editor}
    onClose={() => closeEditor()} onSaved={() => { closeEditor(); load(); }} /> : null;
  const renderPage = (content: ReactNode) => <>{content}{editorDialog}</>;
  const changeDomain = (value: string, replace = false) => {
    if (!canInteract()) return;
    const next = new URLSearchParams(params);
    if (value) next.set("domain", value); else next.delete("domain");
    navigate({ pathname, search: next.toString() ? `?${next.toString()}` : "", hash }, { replace });
  };
  const changeView = (value: CalendarView | null) => {
    if (!canInteract()) return;
    const next = new URLSearchParams(params);
    if (value) next.set("view", value); else next.delete("view");
    navigate({ pathname, search: next.toString() ? `?${next.toString()}` : "", hash });
  };
  if (state.kind === "loading") return renderPage(<div className="context-loading" aria-live="polite">正在读取日历</div>);
  if (state.kind === "error") return renderPage(<section className="not-found-page">
    <h1>暂时无法打开日历</h1><p>无法读取日历安排，请重试。</p>
    <button type="button" className="button-secondary" disabled={busy} onClick={load}>重试</button>
  </section>);
  if (!validView) return renderPage(<section className="not-found-page">
    <h1>日历视图不存在</h1><p>请重新选择日历视图。</p>
    <button type="button" className="button-secondary" disabled={locked}
      onClick={() => changeView(null)}>返回议程</button>
  </section>);
  const data = state.data;
  const requestedDomainId = params.get("domain");
  const domainId = requestedDomainId ?? "";
  if (requestedDomainId !== null && !data.domains.some(domain => domain.id === requestedDomainId)) {
    return renderPage(<section className="not-found-page">
      <h1>无法按当前领域查看日历</h1>
      <p>链接中的生活领域已不存在。清除失效筛选后可重新查看安排。</p>
      <button type="button" className="button-secondary" disabled={locked}
        onClick={() => changeDomain("", true)}>清除失效筛选</button>
    </section>);
  }
  const openEditor = (action?: Action) => {
    if (!canInteract()) return;
    editorOpen.current = true;
    setEditor({ action, goals: data.goals, domains: data.domains, defaultDomainId: domainId });
  };
  const entries = buildCalendarEntries(data, dates, domainId, kinds);
  const byDate = new Map(dates.map(date => [date, entries.filter(entry => entry.date === date)]));
  const today = localDate(new Date());
  const actionsById = new Map(data.actions.map(action => [action.id, action]));
  const row = (entry: CalendarEntry) => {
    const action = entry.kind === "action" ? actionsById.get(entry.sourceId) : undefined;
    return <li key={entry.id} className={"calendar-entry calendar-kind-" + entry.kind}>
      <div className="calendar-entry-main"><span className="calendar-entry-type">{calendarKindLabels[entry.kind]}</span>
        <Link to={entry.href}>{entry.title}</Link><span className="calendar-entry-detail">{entry.detail}</span></div>
      {action ? <div className="calendar-entry-tools">
        <button type="button" className="icon-button" disabled={locked} aria-pressed={entry.completed}
          title={entry.completed ? "恢复为未完成" : "标记为完成"}
          aria-label={(entry.completed ? "恢复为未完成：" : "标记为完成：") + entry.title}
          onClick={() => void toggleAction(action)}><Check size={16} aria-hidden="true" /></button>
        <button type="button" className="icon-button" disabled={locked} title="编辑行动"
          aria-label={"编辑行动：" + entry.title} onClick={() => openEditor(action)}><Pencil size={16} aria-hidden="true" /></button>
      </div> : null}</li>;
  };
  const unscheduled = data.actions.filter(action => action.status === "open" && !action.scheduledFor &&
    (!domainId || action.domainIds.includes(domainId) || data.goals.some(goal => goal.id === action.goalId && goal.domainIds.includes(domainId))));
  return renderPage(<>
    <section className="planning-heading calendar-heading"><h1>日历</h1>
      <button type="button" className="button-primary" disabled={locked} onClick={() => openEditor()}><Plus size={17} aria-hidden="true" />新增行动</button>
    </section>
    <section className="calendar-controls" aria-label="日历筛选">
      <div className="calendar-view-switch" role="group" aria-label="日历视图">
        {([["agenda", "议程"], ["week", "周"], ["month", "月"]] as const).map(([value, label]) =>
          <button type="button" key={value} disabled={locked} aria-pressed={view === value}
            onClick={() => { if (canInteract()) changeView(value); }}>{label}</button>)}
      </div>
      <div className="calendar-date-controls">
        <button type="button" className="icon-button" disabled={locked} title="上一周期" aria-label="上一周期"
          onClick={() => { if (canInteract()) setAnchor(moveCalendarAnchor(anchor, view, -1)); }}><ChevronLeft size={18} aria-hidden="true" /></button>
        <label className="calendar-date-label">日期<input aria-label="日历日期" type="date" value={anchor} disabled={locked}
          onChange={event => { if (canInteract() && isPlainDate(event.target.value)) setAnchor(event.target.value); }} /></label>
        <button type="button" className="icon-button" disabled={locked} title="下一周期" aria-label="下一周期"
          onClick={() => { if (canInteract()) setAnchor(moveCalendarAnchor(anchor, view, 1)); }}><ChevronRight size={18} aria-hidden="true" /></button>
        <button type="button" className="button-secondary" disabled={locked}
          onClick={() => { if (canInteract()) setAnchor(today); }}>今天</button>
      </div>
      <label className="calendar-domain-label">领域<select aria-label="日历领域" value={domainId} disabled={locked}
        onChange={event => changeDomain(event.target.value)}>
        <option value="">全部领域</option>{data.domains.map(domain => <option key={domain.id} value={domain.id}>{domain.name}</option>)}
      </select></label>
      <div className="calendar-kind-filters">
        {calendarKinds.map(kind => <label key={kind}><input type="checkbox" checked={kinds.includes(kind)} disabled={locked}
          onChange={event => { if (canInteract()) setKinds(current => event.target.checked ? [...current, kind] : current.filter(value => value !== kind)); }} />
          {calendarKindLabels[kind]}</label>)}
      </div>
    </section>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    <section className={"calendar-content calendar-view-" + view} aria-label={view === "agenda" ? "议程" : view === "week" ? "周视图" : "月视图"}>
      <div className="section-heading"><h2>{view === "month" ? anchor.slice(0, 4) + "年" + Number(anchor.slice(5, 7)) + "月" : dates[0] + " 至 " + dates[6]}</h2><span>{entries.length} 项</span></div>
      {view === "agenda" ? <div className="calendar-agenda">
        {dates.filter(date => byDate.get(date)?.length).map(date => <section key={date} className="calendar-agenda-day">
          <h3><time dateTime={date}>{date} · {weekday(date)}</time>{date === today ? <span>今天</span> : null}</h3>
          <ol>{byDate.get(date)!.map(row)}</ol>
        </section>)}
        {!entries.length ? <p className="planning-empty">当前周期没有符合筛选的安排。</p> : null}
      </div> : <div className={"calendar-date-grid " + (view === "month" ? "calendar-month-grid" : "calendar-week-grid")}>
        {dates.map(date => <article key={date} className={"calendar-date-cell" + (date === today ? " is-today" : "") +
          (view === "month" && date.slice(0, 7) !== anchor.slice(0, 7) ? " is-outside-month" : "")}>
          <h3><time dateTime={date}>{weekday(date)} · {Number(date.slice(8))}</time></h3><ol>{byDate.get(date)!.map(row)}</ol>
        </article>)}
      </div>}
    </section>
    {kinds.includes("action") && unscheduled.length ? <details className="calendar-unplaced">
      <summary>未安排行动（{unscheduled.length}）</summary><ol>{unscheduled.map(action =>
        <li key={action.id}><Link to={"/goals#action-" + encodeURIComponent(action.id)}>{action.title}</Link>
          <button type="button" className="icon-button" disabled={locked} title="编辑行动" aria-label={"编辑行动：" + action.title}
            onClick={() => openEditor(action)}><Pencil size={16} aria-hidden="true" /></button></li>)}</ol>
    </details> : null}
  </>);
}
function weekday(date: string): string {
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
}
