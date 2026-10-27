import { Check, Pencil, Plus, RotateCcw, Archive, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { HabitEditorDialog } from "../components/HabitEditorDialog";
import { HabitPeriodSummary } from "../components/HabitPeriodSummary";
import { HabitValidationError, localDate, summarizeHabit, type Habit, type HabitLog } from "../domain/habits/Habit";
import type { LifeDomain } from "../domain/life/LifeDomain";
import { habitDraftDefaults } from "../domain/habits/HabitTemplate";
import { validateTemplate, type Template } from "../domain/templates/Template";

type PageState = { kind: "loading" } | { kind: "error"; message: string } |
  { kind: "ready"; habits: readonly Habit[]; logs: readonly HabitLog[]; domains: readonly LifeDomain[] };
type Filter = "active" | "archived" | "all";
type HabitEditor = {
  habit?: Habit; template?: Template;
  domains: readonly LifeDomain[]; defaultDomainId: string;
  request?: { templateId: string | null; create: boolean };
};

function weekDates(today: string): string[] {
  const monday = new Date(`${today}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, offset) =>
    new Date(monday.getTime() + offset * 86400000).toISOString().slice(0, 10));
}

function HabitItem({ habit, logs, today, domains, busy, onSave, onArchive, onEdit }: {
  habit: Habit; logs: readonly HabitLog[]; today: string; domains: readonly LifeDomain[];
  busy: boolean;
  onSave(id: string, date: string, completed: boolean, obstacle?: string, adjustment?: string): Promise<void>;
  onArchive(habit: Habit): Promise<void>;
  onEdit(habit: Habit): void;
}) {
  const [date, setDate] = useState(today);
  const [logDraft, setLogDraft] = useState<{
    date: string; source: string; completed: boolean; obstacle: string; adjustment: string;
  } | null>(null);
  const summary = summarizeHabit(habit, logs, today);
  const logMap = new Map(logs.map((log) => [log.recordedOn, log]));
  const selectedLog = logMap.get(date);
  const source = JSON.stringify([
    selectedLog?.id, selectedLog?.completed, selectedLog?.obstacle, selectedLog?.adjustment,
  ]);
  const currentDraft = logDraft?.date === date && logDraft.source === source
    ? logDraft : { date, source, completed: selectedLog?.completed ?? true,
      obstacle: selectedLog?.obstacle ?? "", adjustment: selectedLog?.adjustment ?? "" };

  function selectDate(value: string) {
    if (busy) return;
    setDate(value);
    setLogDraft(null);
  }
  function changeDraft(next: NonNullable<typeof logDraft>) {
    if (!busy) setLogDraft(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy) await onSave(habit.id, date, currentDraft.completed, currentDraft.obstacle, currentDraft.adjustment);
  }

  return <li id={`habit-${habit.id}`} className="habit-row">
    <div className="habit-row-heading">
      <div className="habit-row-title"><h2>{habit.title}</h2>
        {habit.archived ? <span className="goal-status">已归档</span> : null}
        <div className="planning-meta">
          <span>每周 {habit.weeklyTarget} 次</span><time dateTime={habit.startOn}>始于 {habit.startOn}</time>
          {habit.domainIds.map((id) => {
            const domain = domains.find((item) => item.id === id);
            return domain ? <span key={id} className={`domain-meta domain-color-${domain.color}`}>
              <i aria-hidden="true" />{domain.name}</span> : null;
          })}
        </div>
      </div>
      <div className="habit-row-actions">
        <button type="button" className="icon-button" title="编辑习惯"
          aria-label={`编辑习惯：${habit.title}`} disabled={busy} onClick={() => onEdit(habit)}>
          <Pencil size={17} aria-hidden="true" /></button>
        <button type="button" className="icon-button"
          title={habit.archived ? "恢复习惯" : "归档习惯"}
          aria-label={`${habit.archived ? "恢复" : "归档"}习惯：${habit.title}`}
          disabled={busy} onClick={() => void onArchive(habit)}>
          {habit.archived ? <RotateCcw size={17} aria-hidden="true" /> :
            <Archive size={17} aria-hidden="true" />}</button>
      </div>
    </div>
    {habit.intention ? <p className="habit-intention">{habit.intention}</p> : null}
    <div className="habit-summary">
      <span>本周 <strong>{summary.currentWeek}/{habit.weeklyTarget}</strong></span>
      <span>近 {summary.eligibleWeeks} 个完整周 <strong>
        {summary.completionRate === null ? "暂无" : `${summary.completionRate}%`}</strong></span>
      {summary.consecutiveWeeks > 0 ? <span>连续达到期望 <strong>{summary.consecutiveWeeks} 周</strong></span> : null}
    </div>
    <div className="habit-week" aria-label={`${habit.title}本周打卡`}>
      {weekDates(today).map((day, index) => {
        const logged = logMap.get(day);
        const disabled = habit.archived || day > today || day < habit.startOn || busy;
        return <button key={day} type="button" className={logged?.completed ? "habit-day is-done" : "habit-day"}
          disabled={disabled} aria-pressed={logged?.completed ?? false}
          aria-label={`${day}${logged?.completed ? "已完成，点击撤销" : "未完成，点击打卡"}`}
          title={day} onClick={() => void onSave(habit.id, day, !logged?.completed,
            logged?.obstacle ?? "", logged?.adjustment ?? "")}>
          <span>{"一二三四五六日"[index]}</span>
          <strong>{Number(day.slice(-2))}</strong>
          <Check size={15} aria-hidden="true" />
        </button>;
      })}
    </div>
    <HabitPeriodSummary habit={habit} logs={logs} today={today} />
    <details className="habit-details">
      <summary>记录与调整</summary>
      {(habit.stableContext || habit.triggerCondition || habit.obstacle || habit.adjustment) ?
        <dl className="habit-context">
          {([["稳定情境", habit.stableContext], ["触发条件", habit.triggerCondition],
            ["可能的阻碍", habit.obstacle], ["调整方式", habit.adjustment]] as const)
            .filter(([, value]) => Boolean(value)).map(([label, value]) =>
              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl> : null}
      {!habit.archived ? <form className="habit-log-form" onSubmit={(event) => void submit(event)}>
        <div className="habit-log-fields">
          <label className="form-field"><span>记录日期</span>
            <input type="date" required min={habit.startOn} max={today} value={date} disabled={busy}
              onChange={(event) => selectDate(event.target.value)} /></label>
          <label className="habit-log-check"><input type="checkbox" checked={currentDraft.completed} disabled={busy}
            onChange={(event) => changeDraft({ ...currentDraft, completed: event.target.checked })} />已完成</label>
        </div>
        <label className="form-field"><span>遇到的阻碍</span>
          <textarea rows={2} maxLength={500} value={currentDraft.obstacle} disabled={busy}
            onChange={(event) => changeDraft({ ...currentDraft, obstacle: event.target.value })} /></label>
        <label className="form-field"><span>接下来的调整</span>
          <textarea rows={2} maxLength={500} value={currentDraft.adjustment} disabled={busy}
            onChange={(event) => changeDraft({ ...currentDraft, adjustment: event.target.value })} /></label>
        <button className="button-secondary" type="submit" disabled={busy}>
          <Save size={16} aria-hidden="true" />保存记录</button>
      </form> : null}
      {logs.length ? <ol className="habit-history">
        {[...logs].sort((a, b) => b.recordedOn.localeCompare(a.recordedOn)).map((log) =>
          <li key={log.id} id={`habit-log-${log.id}`}><time dateTime={log.recordedOn}>{log.recordedOn}</time>
            <span>{log.completed ? "已完成" : "未完成"}</span>
            {log.obstacle ? <span>阻碍：{log.obstacle}</span> : null}
            {log.adjustment ? <span>调整：{log.adjustment}</span> : null}</li>)}
      </ol> : null}
    </details>
  </li>;
}

export function HabitsPage() {
  const { habitService, lifeDomainService, templateService } = useLifeOS();
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const templateId = params.get("template");
  const [filter, setFilter] = useState<Filter>(hash ? "all" : "active");
  const [editing, setEditing] = useState<HabitEditor | null>(null);
  const [templateError, setTemplateError] = useState<{ id: string; message: string } | null>(null);
  const [templateAttempt, setTemplateAttempt] = useState(0);
  const consumedRequest = useRef<HabitEditor["request"]>(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const editorOpen = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const sourceEpoch = useRef(0);
  const today = localDate(new Date());
  const load = useCallback(async (): Promise<PageState> => {
    try {
      const [habits, logs, domains] = await Promise.all([
        habitService.list(), habitService.listLogs(), lifeDomainService.list(),
      ]);
      return { kind: "ready", habits, logs, domains };
    } catch {
      return { kind: "error", message: "无法读取习惯，请重试。" };
    }
  }, [habitService, lifeDomainService]);
  const [result, setResult] = useState<{ source: typeof load; state: PageState } | null>(null);
  const state = useMemo<PageState>(() => result?.source === load ? result.state : { kind: "loading" }, [result, load]);
  const domainId = params.get("domain") ?? "";
  const validDomain = params.get("domain") === null ||
    (state.kind === "ready" && state.domains.some(domain => domain.id === domainId));
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);
  const reload = () => {
    if (!mounted.current) return;
    const request = ++generation.current;
    setResult({ source: load, state: { kind: "loading" } });
    void load().then(next => {
      if (mounted.current && request === generation.current) setResult({ source: load, state: next });
    });
  };
  useEffect(() => {
    sourceEpoch.current += 1;
    const request = ++generation.current;
    void load().then(next => {
      if (mounted.current && request === generation.current) setResult({ source: load, state: next });
    });
    return () => { sourceEpoch.current += 1; generation.current += 1; };
  }, [load]);
  useEffect(() => {
    if (state.kind !== "ready" || !validDomain || editing || busy) return;
    if (!templateId) {
      if (params.get("create") === "habit") {
        let active = true;
        void Promise.resolve().then(() => {
          if (!active || editorOpen.current || busyRef.current) return;
          editorOpen.current = true;
          setEditing({ domains: state.domains, defaultDomainId: domainId,
            request: { templateId: null, create: true } });
        });
        return () => { active = false; };
      }
      return;
    }
    if (templateError?.id === templateId) return;
    let active = true;
    void templateService.find(templateId).then(template => {
      if (!active || editorOpen.current || busyRef.current) return;
      if (!template || template.category !== "habit") {
        setTemplateError({ id: templateId, message: "习惯模板已不存在或类型不符，请返回模板中心重新选择。" });
        return;
      }
      const checked = validateTemplate("habit", template.name, template.defaults);
      try { habitDraftDefaults(checked.defaults); }
      catch {
        setTemplateError({ id: templateId, message: "习惯模板文字超过字段上限，请先在模板中心调整后重试。" });
        return;
      }
      editorOpen.current = true;
      setEditing({ template: { ...template, defaults: checked.defaults },
        domains: state.domains, defaultDomainId: domainId,
        request: { templateId, create: params.get("create") === "habit" } });
    }).catch(() => {
      if (active) setTemplateError({ id: templateId, message: "习惯模板读取或校验失败，请重试或重新选择。" });
    });
    return () => { active = false; };
  }, [state, validDomain, domainId, editing, busy, templateId, params, templateError, templateAttempt, templateService]);
  useEffect(() => {
    const request = editing?.request;
    if (state.kind !== "ready" || !request || consumedRequest.current === request) return;
    consumedRequest.current = request;
    // Consume only the request that opened this mounted draft, never a newer template choice.
    if (params.get("template") !== request.templateId) return;
    const next = new URLSearchParams(params);
    if (request.templateId) next.delete("template");
    if (request.create && next.get("create") === "habit") next.delete("create");
    if (next.toString() !== params.toString()) {
      void navigate({ pathname, search: next.toString(), hash },
        { replace: true, preventScrollReset: true });
    }
  }, [state.kind, editing, params, pathname, hash, navigate]);
  useEffect(() => {
    if (state.kind !== "ready" || !hash) return;
    try {
      const target = document.getElementById(decodeURIComponent(hash.slice(1)));
      const details = target?.closest("details");
      if (details) details.open = true;
      target?.scrollIntoView({ block: "center" });
    } catch { /* Ignore malformed link fragments. */ }
  }, [state, hash]);
  async function run(action: () => Promise<void>) {
    if (busyRef.current || editorOpen.current || !mounted.current) return;
    const source = sourceEpoch.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      if (mounted.current && source === sourceEpoch.current) reload();
    }
    catch (reason) {
      if (mounted.current && source === sourceEpoch.current) setError(reason instanceof HabitValidationError
        ? reason.message : "操作失败，请重试。");
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  const locked = busy || Boolean(editing);
  const canInteract = () => mounted.current && !busyRef.current && !editorOpen.current;
  const closeEditor = () => {
    if (!mounted.current) return;
    editorOpen.current = false; setEditing(null);
  };
  const editorDialog = editing ? <HabitEditorDialog key={editing.habit?.id ?? "new"} {...editing}
    onClose={() => closeEditor()} onSaved={() => { closeEditor(); reload(); }} /> : null;
  const renderPage = (content: ReactNode) => <>{content}{editorDialog}</>;
  if (state.kind === "loading") return renderPage(<div className="context-loading" aria-live="polite">正在打开习惯</div>);
  if (state.kind === "error") return renderPage(<section className="not-found-page">
    <h1>暂时无法打开习惯</h1><p className="page-intro">{state.message}</p>
    <button className="button-secondary" type="button" disabled={busy} onClick={reload}>重试</button>
  </section>);
  if (!validDomain) return renderPage(<section className="not-found-page">
    <h1>无法按当前领域查看习惯</h1><p>链接中的生活领域已不存在，请清除失效筛选后重试。</p>
    <button type="button" className="button-secondary" disabled={locked} onClick={() => {
      if (!canInteract()) return;
      const next = new URLSearchParams(params);
      next.delete("domain");
      navigate({ pathname, search: next.toString(), hash }, { replace: true });
    }}>清除失效筛选</button>
  </section>);
  const openEditor = (habit?: Habit) => {
    if (!canInteract()) return;
    editorOpen.current = true;
    setEditing({ habit, domains: state.domains, defaultDomainId: domainId });
  };
  const visible = state.habits.filter((habit) =>
    (filter === "all" || (filter === "active" ? !habit.archived : habit.archived)) &&
    (!domainId || habit.domainIds.includes(domainId)));
  return renderPage(<>
    <header className="planning-heading">
      <div><p className="eyebrow">日常节奏</p><h1>习惯</h1></div>
      <button type="button" className="button-primary" disabled={locked || Boolean(templateId)}
        onClick={() => openEditor()}>
        <Plus size={17} aria-hidden="true" />建立习惯</button>
    </header>
    <section className="habit-section" aria-label="习惯列表">
      <div className="issue-filters">
        <div className="inbox-tabs" role="tablist" aria-label="习惯状态">
          {(["active", "archived", "all"] as const).map((option) =>
            <button key={option} type="button" role="tab" aria-selected={filter === option} disabled={locked}
              className={filter === option ? "inbox-tab selected" : "inbox-tab"}
              onClick={() => { if (canInteract()) setFilter(option); }}>{{
                active: "进行中", archived: "已归档", all: "全部",
              }[option]}</button>)}
        </div>
        <label className="issue-filter-domain"><span className="sr-only">按生活领域筛选</span>
          <select aria-label="按生活领域筛选" value={domainId} disabled={locked}
            onChange={(event) => { if (!canInteract()) return; setParams(current => {
              const next = new URLSearchParams(current);
              if (event.target.value) next.set("domain", event.target.value);
              else next.delete("domain");
              return next;
            }); }}>
            <option value="">全部领域</option>
            {state.domains.map((domain) =>
              <option key={domain.id} value={domain.id}>{domain.name}</option>)}
          </select></label>
      </div>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      {!editing && templateId ? templateError?.id === templateId
        ? <div className="form-error" role="alert">
          <p>{templateError.message}</p>
          <button type="button" className="button-secondary" onClick={() => {
            setTemplateError(null); setTemplateAttempt(value => value + 1);
          }}>重试读取模板</button>
          <button type="button" className="button-secondary" onClick={() => {
            const next = new URLSearchParams(params);
            next.delete("template");
            if (next.get("create") === "habit") next.delete("create");
            void navigate({ pathname, search: next.toString(), hash }, { replace: true });
          }}>取消模板请求</button>
          <Link className="button-secondary" to="/templates?category=habit">习惯模板</Link>
        </div> : <p role="status">正在读取习惯模板</p> : null}
      {visible.length ? <ol className="habit-list">
        {visible.map((habit) => <HabitItem key={habit.id} habit={habit}
          logs={state.logs.filter((log) => log.habitId === habit.id)}
          today={today} domains={state.domains} busy={locked}
          onEdit={habit => openEditor(habit)}
          onSave={async (id, date, completed, obstacle, adjustment) =>
            run(async () => { await habitService.saveLog(id, date, completed, obstacle, adjustment); })}
          onArchive={async (item) => run(async () =>
            { await habitService.setArchived(item.id, !item.archived); })} />)}
      </ol> : <p className="planning-empty">这里还没有符合条件的习惯。</p>}
    </section>
  </>);
}
