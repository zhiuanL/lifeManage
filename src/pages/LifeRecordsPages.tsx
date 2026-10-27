import { Archive, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { localDate } from "../domain/habits/Habit";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { Goal } from "../domain/planning/Goal";
import { LifeRecordValidationError, selectPersonEvents,
  type LifeEvent, type Person, type Skill } from "../domain/records/LifeRecords";
import type { Decision } from "../domain/decisions/Decision";
import type { Review } from "../domain/reviews/Review";
import { GoalTimeline } from "./GoalTimeline";
import { DomainTimeline } from "./DomainTimeline";
import { PersonDatesEditor } from "../components/PersonDatesEditor";
import { PersonRelationshipTimeline } from "./PersonRelationshipTimeline";

type Kind = "person" | "event" | "skill";
type RecordItem = Person | LifeEvent | Skill;
type Data = { domains: readonly LifeDomain[]; goals: readonly Goal[];
  people: readonly Person[]; events: readonly LifeEvent[]; skills: readonly Skill[];
  decisions: readonly Decision[]; reviews: readonly Review[] };
type State = { kind: "loading" } | { kind: "error"; message: string } |
  { kind: "ready"; data: Data };
type EditorState = { item?: RecordItem; data: Data; domainId: string; personId: string };
const titles = { person: "人物", event: "重要事件", skill: "能力成长" };

function RecordEditor({ kind: initialKind, item: initialItem, data: initialData,
  defaultDomainId, defaultPersonId, onClose, onSaved }: {
  kind: Kind; item?: RecordItem; data: Data; defaultDomainId: string;
  defaultPersonId: string;
  onClose(): void; onSaved(): void;
}) {
  const context = useLifeOS();
  const [{ kind, item, data, lifeRecordsService }] = useState(() => ({
    kind: initialKind, item: initialItem, data: initialData,
    lifeRecordsService: context.lifeRecordsService,
  }));
  const savedCallback = useRef(onSaved);
  useEffect(() => { savedCallback.current = onSaved; }, [onSaved]);
  const person = kind === "person" ? item as Person | undefined : undefined;
  const event = kind === "event" ? item as LifeEvent | undefined : undefined;
  const skill = kind === "skill" ? item as Skill | undefined : undefined;
  const [draft, setDraft] = useState(() => ({
    name: person?.name ?? skill?.name ?? "", title: event?.title ?? "",
    relationshipType: person?.relationshipType ?? "", state: person?.state ?? "",
    importantDate: person?.importantDate ?? "", lastContact: person?.lastContact ?? "",
    sharedExperiences: person?.sharedExperiences ?? "", notes: person?.notes ?? "",
    dates: (person?.dates ?? []).map(date => ({ ...date })),
    happenedOn: event?.happenedOn ?? localDate(new Date()),
    description: event?.description ?? "", personId: event?.personId ?? (item ? "" : defaultPersonId),
    goalId: event?.goalId ?? skill?.goalId ?? "",
    currentLevel: skill?.currentLevel ?? 0, targetLevel: skill?.targetLevel ?? 1,
    learningPath: skill?.learningPath ?? "", practice: skill?.practice ?? "",
    reflection: skill?.reflection ?? "",
    domainIds: [...(item?.domainIds ?? (defaultDomainId ? [defaultDomainId] : []))],
  }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const close = () => { if (!savingRef.current) onClose(); };
  const change = (values: Partial<typeof draft>) => {
    if (!savingRef.current) setDraft((current) => ({ ...current, ...values }));
  };
  async function submit(eventForm: FormEvent<HTMLFormElement>) {
    eventForm.preventDefault();
    if (savingRef.current || !mounted.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      if (kind === "person") {
        await lifeRecordsService.savePerson({ name: draft.name, relationshipType: draft.relationshipType,
          state: draft.state, importantDate: draft.importantDate || null,
          lastContact: draft.lastContact || null, sharedExperiences: draft.sharedExperiences,
          notes: draft.notes, domainIds: draft.domainIds, dates: draft.dates }, item?.id);
      } else if (kind === "event") {
        await lifeRecordsService.saveEvent({ title: draft.title, happenedOn: draft.happenedOn,
          description: draft.description, personId: draft.personId || null,
          goalId: draft.goalId || null, domainIds: draft.domainIds }, item?.id);
      } else {
        await lifeRecordsService.saveSkill({ name: draft.name, currentLevel: draft.currentLevel,
          targetLevel: draft.targetLevel, learningPath: draft.learningPath,
          practice: draft.practice, reflection: draft.reflection, goalId: draft.goalId || null,
          domainIds: draft.domainIds }, item?.id);
      }
      if (mounted.current) savedCallback.current();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof LifeRecordValidationError
        ? reason.message : "保存记录失败，请重试。");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return <section className="record-editor" aria-label={`${item ? "编辑" : "新增"}${titles[kind]}`}>
    <header className="section-heading">
      <h2>{item ? "编辑" : "新增"}{titles[kind]}</h2>
      <button type="button" className="icon-button" title="关闭编辑" aria-label="关闭编辑"
        onClick={close} disabled={saving}><X size={18} aria-hidden="true" /></button>
    </header>
    <form className="domain-form" aria-busy={saving} onSubmit={(form) => void submit(form)}>
      <fieldset className="record-edit-fields" disabled={saving}>
      <legend className="sr-only">记录内容</legend>
      <label className="form-field"><span>{kind === "event" ? "事件标题" : "名称"}</span>
        <input autoFocus required maxLength={80} value={kind === "event" ? draft.title : draft.name}
          onChange={(changeEvent) => change(kind === "event"
            ? { title: changeEvent.target.value } : { name: changeEvent.target.value })} /></label>
      {kind === "person" ? <>
        <div className="planning-form-grid">
          <label className="form-field"><span>关系类型</span>
            <input maxLength={80} value={draft.relationshipType}
              onChange={(e) => change({ relationshipType: e.target.value })} /></label>
          <label className="form-field"><span>关系状态</span>
            <input maxLength={200} value={draft.state}
              onChange={(e) => change({ state: e.target.value })} /></label>
          <label className="form-field"><span>重要日期</span>
            <input type="date" value={draft.importantDate}
              onChange={(e) => change({ importantDate: e.target.value })} /></label>
          <label className="form-field"><span>最近联系</span>
            <input type="date" value={draft.lastContact}
              onChange={(e) => change({ lastContact: e.target.value })} /></label>
        </div>
        <PersonDatesEditor dates={draft.dates} onChange={dates => change({ dates })} />
        <details className="habit-optional"><summary>共同经历与备注</summary>
          <label className="form-field"><span>共同经历</span>
            <textarea rows={3} maxLength={500} value={draft.sharedExperiences}
              onChange={(e) => change({ sharedExperiences: e.target.value })} /></label>
          <label className="form-field"><span>备注</span>
            <textarea rows={3} maxLength={500} value={draft.notes}
              onChange={(e) => change({ notes: e.target.value })} /></label>
        </details>
      </> : null}
      {kind === "event" ? <>
        <label className="form-field"><span>发生日期</span>
          <input type="date" required value={draft.happenedOn}
            onChange={(e) => change({ happenedOn: e.target.value })} /></label>
        <label className="form-field"><span>发生了什么</span>
          <textarea rows={3} maxLength={1000} value={draft.description}
            onChange={(e) => change({ description: e.target.value })} /></label>
        <details className="habit-optional" open={Boolean(defaultPersonId || event?.personId)}>
          <summary>关联人物与目标</summary>
          <label className="form-field"><span>相关人物</span>
            <select value={draft.personId} onChange={(e) => change({ personId: e.target.value })}>
              <option value="">不关联</option>
              {data.people.filter((p) => !p.archived || p.id === event?.personId)
                .map((p) => <option key={p.id} value={p.id}>
                  {p.name}{p.archived ? "（已归档）" : ""}</option>)}
            </select></label>
          <GoalSelect goals={data.goals} value={draft.goalId}
            onChange={(goalId) => change({ goalId })} />
        </details>
      </> : null}
      {kind === "skill" ? <>
        <div className="planning-form-grid">
          {(["currentLevel", "targetLevel"] as const).map((field) =>
            <label className="form-field" key={field}>
              <span>{field === "currentLevel" ? "当前水平" : "期望水平"}</span>
              <select value={draft[field]} onChange={(e) => change({ [field]: Number(e.target.value) })}>
                {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>)}
        </div>
        <GoalSelect goals={data.goals} value={draft.goalId}
          onChange={(goalId) => change({ goalId })} />
        <details className="habit-optional"><summary>学习与练习</summary>
          {([["learningPath", "学习路径"], ["practice", "练习与成果"], ["reflection", "复盘"]] as const)
            .map(([field, label]) => <label className="form-field" key={field}>
              <span>{label}</span><textarea rows={2} maxLength={500} value={draft[field]}
                onChange={(e) => change({ [field]: e.target.value })} /></label>)}
        </details>
      </> : null}
      <fieldset className="form-field"><legend>相关生活领域</legend>
        <div className="issue-domain-options">
          {data.domains.map((domain) => <label className="issue-domain-option" key={domain.id}>
            <input type="checkbox" checked={draft.domainIds.includes(domain.id)}
              onChange={(e) => change({ domainIds: e.target.checked
                ? [...draft.domainIds, domain.id]
                : draft.domainIds.filter((id) => id !== domain.id) })} />
            <span className={`domain-meta domain-color-${domain.color}`}>
              <i aria-hidden="true" />{domain.name}</span>
          </label>)}
        </div>
      </fieldset>
      </fieldset>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      <footer className="dialog-actions">
        <button type="button" className="button-secondary" onClick={close} disabled={saving}>取消</button>
        <button type="submit" className="button-primary" disabled={saving}>
          {saving ? "保存中" : "保存记录"}</button>
      </footer>
    </form>
  </section>;
}

function GoalSelect({ goals, value, onChange }: {
  goals: readonly Goal[]; value: string; onChange(value: string): void;
}) {
  return <label className="form-field"><span>关联目标</span>
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">不关联</option>
      {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
    </select>
  </label>;
}

function LifeRecordsPage({ type }: { type: Kind }) {
  const { lifeRecordsService, lifeDomainService, goalService, decisionService, reviewService } = useLifeOS();
  const [params] = useSearchParams();
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<EditorState | null>(null);
  const editingRef = useRef(false);
  const [showArchived, setShowArchived] = useState(Boolean(hash));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const loadGeneration = useRef(0);
  const sourceEpoch = useRef(0);
  const load = useCallback(async (): Promise<State> => {
    try {
      const [domains, goals, people, events, skills, decisions, reviews] = await Promise.all([
        lifeDomainService.list(), goalService.list(), lifeRecordsService.listPeople(),
        lifeRecordsService.listEvents(), lifeRecordsService.listSkills(),
        decisionService.list(), reviewService.list(),
      ]);
      return { kind: "ready", data: { domains, goals, people, events, skills, decisions, reviews } };
    } catch {
      return { kind: "error", message: "记录读取失败，请重试。" };
    }
  }, [lifeDomainService, goalService, lifeRecordsService, decisionService, reviewService]);
  const [result, setResult] = useState<{ source: typeof load; state: State } | null>(null);
  const state = useMemo<State>(() =>
    result?.source === load ? result.state : { kind: "loading" }, [result, load]);
  useEffect(() => {
    const requests = loadGeneration;
    mounted.current = true;
    return () => { mounted.current = false; requests.current++; };
  }, []);
  useEffect(() => {
    const requests = loadGeneration, epoch = sourceEpoch;
    epoch.current++;
    const generation = ++requests.current;
    void load().then((next) => {
      if (mounted.current && generation === loadGeneration.current) setResult({ source: load, state: next });
    });
    return () => { epoch.current++; requests.current++; };
  }, [load]);
  useEffect(() => {
    if (state.kind !== "ready" || !hash) return;
    try {
      document.getElementById(decodeURIComponent(hash.slice(1)))
        ?.scrollIntoView({ block: "center" });
    } catch {
      // Ignore malformed URL fragments; they must not prevent opening the records.
    }
  }, [state, hash, showArchived]);
  useEffect(() => {
    let active = true;
    if (hash) queueMicrotask(() => { if (active) setShowArchived(true); });
    return () => { active = false; };
  }, [hash]);
  const reload = async () => {
    if (!mounted.current) return;
    const generation = ++loadGeneration.current;
    setResult({ source: load, state: { kind: "loading" } });
    const next = await load();
    if (mounted.current && generation === loadGeneration.current) setResult({ source: load, state: next });
  };
  const closeEditor = () => {
    editingRef.current = false;
    setEditing(null);
  };
  function changeFilter(key: "domain" | "person", value: string, replace = false) {
    if (editingRef.current || busyRef.current) return;
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    navigate({ pathname, search: next.toString(), hash }, { replace });
  }
  function renderContent(part: "before" | "after") {
  if (state.kind === "loading") return part === "before"
    ? <p className="context-loading" aria-live="polite">正在读取记录</p> : null;
  if (state.kind === "error") return part === "before" ? <section className="not-found-page">
    <h1>暂时无法打开{titles[type]}</h1><p role="alert">{state.message}</p>
    <button type="button" className="button-secondary" onClick={() => void reload()}>重试</button>
  </section> : null;
  const { data } = state;
  const requestedDomainId = params.get("domain");
  if (params.has("domain") && !data.domains.some((domain) => domain.id === requestedDomainId)) {
    return part === "before" ? <section className="not-found-page">
      <h1>无法按当前领域查看{titles[type]}</h1>
      <p>链接中的生活领域已不存在或筛选为空。清除领域筛选后可继续查看记录。</p>
      <button type="button" className="button-secondary" disabled={busy || Boolean(editing)} onClick={() =>
        changeFilter("domain", "", true)}>清除失效筛选</button>
    </section> : null;
  }
  const domainId = requestedDomainId ?? "";
  const personId = type === "event" ? params.get("person") ?? "" : "";
  const selectedPerson = data.people.find((person) => person.id === personId);
  if (type === "event" && params.has("person") && !selectedPerson) {
    return part === "before" ? <section className="not-found-page">
      <h1>无法按当前人物查看重要事件</h1>
      <p>链接中的人物已不存在或筛选为空。</p>
      <button type="button" className="button-secondary" disabled={busy || Boolean(editing)} onClick={() =>
        changeFilter("person", "", true)}>清除失效人物筛选</button>
    </section> : null;
  }
  const rows = type === "person" ? data.people : type === "event" ? data.events : data.skills;
  const visible = type === "event" && personId
    ? selectPersonEvents(data.events, personId, domainId, showArchived)
    : rows.filter((item) => (showArchived || !item.archived) &&
      (!domainId || item.domainIds.includes(domainId)));
  const goalTitle = new Map(data.goals.map((goal) => [goal.id, goal.title]));
  const personName = new Map(data.people.map((person) => [person.id, person.name]));
  function openEditor(item?: RecordItem) {
    if (editingRef.current || busyRef.current || (!item && selectedPerson?.archived)) return;
    editingRef.current = true;
    setEditing({ item, data, domainId, personId });
  }
  async function archive(item: RecordItem) {
    if (busyRef.current || editingRef.current) return;
    const epoch = sourceEpoch.current;
    busyRef.current = true;
    setBusy(true); setError("");
    try {
      await lifeRecordsService.setArchived(type === "person" ? "people" :
        type === "event" ? "life_events" : "skills", item.id, !item.archived);
      if (mounted.current && epoch === sourceEpoch.current) await reload();
    } catch (reason) {
      if (mounted.current && epoch === sourceEpoch.current) setError(reason instanceof LifeRecordValidationError
        ? reason.message : "更新归档状态失败，请重试。");
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  if (part === "before") return <>
    <header className="planning-heading">
      <div><p className="eyebrow">{type === "event" ? "人生时间线" :
        type === "person" ? "重要关系" : "持续成长"}</p><h1>{titles[type]}</h1></div>
      <button type="button" className="button-primary"
        disabled={busy || Boolean(editing) || Boolean(selectedPerson?.archived)}
        onClick={() => openEditor()}>
        <Plus size={17} aria-hidden="true" />新增{titles[type]}</button>
    </header>
    <div className="issue-filters">
      <label className="issue-filter-domain"><span className="sr-only">按生活领域筛选</span>
        <select aria-label="按生活领域筛选" value={domainId} disabled={busy || Boolean(editing)}
          onChange={(e) => changeFilter("domain", e.target.value)}>
          <option value="">全部领域</option>
          {data.domains.map((domain) => <option key={domain.id} value={domain.id}>
            {domain.name}</option>)}
        </select></label>
      {type === "event" ? <label className="issue-filter-domain"><span className="sr-only">按人物筛选</span>
        <select aria-label="按人物筛选" value={personId} disabled={busy || Boolean(editing)}
          onChange={(e) => changeFilter("person", e.target.value)}>
          <option value="">全部人物</option>
          {data.people.map((person) => <option key={person.id} value={person.id}>
            {person.name}{person.archived ? "（已归档）" : ""}</option>)}
        </select></label> : null}
      <label className="record-archive-filter">
        <input type="checkbox" checked={showArchived} disabled={busy || Boolean(editing)}
          onChange={(e) => {
            if (!editingRef.current && !busyRef.current) setShowArchived(e.target.checked);
          }} />显示归档</label>
    </div>
    {selectedPerson ? <p className="record-context">
      <Link to={`/people#person-${encodeURIComponent(selectedPerson.id)}`}>
        人物：{selectedPerson.name}{selectedPerson.archived ? "（已归档）" : ""}</Link>
    </p> : null}
  </>;
  return <>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    {visible.length ? <ol className="record-list">
      {visible.map((item) => {
        const person = type === "person" ? item as Person : null;
        const birthday = person?.dates?.find(date => date.kind === "birthday");
        const event = type === "event" ? item as LifeEvent : null;
        const skill = type === "skill" ? item as Skill : null;
        return <li key={item.id} id={`${type}-${item.id}`} className="record-row">
          <div className="record-main">
            <div className="record-title">
              <h2>{person?.name ?? event?.title ?? skill?.name}</h2>
              {item.archived ? <span className="goal-status">已归档</span> : null}
              <div className="record-actions">
                <button className="icon-button" type="button" title="编辑"
                  aria-label={`编辑${titles[type]}：${person?.name ?? event?.title ?? skill?.name}`}
                  disabled={busy || Boolean(editing)}
                  onClick={() => openEditor(item)}><Pencil size={16} aria-hidden="true" /></button>
                <button className="icon-button" type="button" disabled={busy || Boolean(editing)}
                  title={item.archived ? "恢复" : "归档"}
                  aria-label={`${item.archived ? "恢复" : "归档"}${titles[type]}`}
                  onClick={() => void archive(item)}>
                  {item.archived ? <RotateCcw size={16} aria-hidden="true" /> :
                    <Archive size={16} aria-hidden="true" />}</button>
              </div>
            </div>
            <div className="planning-meta">
              {person ? <><span>{person.relationshipType || "未设置关系类型"}</span>
                {person.state ? <span>{person.state}</span> : null}
                {person.lastContact ? <time dateTime={person.lastContact}>
                  最近联系 {person.lastContact}</time> : null}
                {person.importantDate ? <time dateTime={person.importantDate}>
                  重要日期 {person.importantDate}</time> : null}
                {birthday ? <time dateTime={birthday.date}>生日 {birthday.date}</time> : null}</> : null}
              {event ? <time dateTime={event.happenedOn}>{event.happenedOn}</time> : null}
              {skill ? <span>当前 {skill.currentLevel} · 期望 {skill.targetLevel}</span> : null}
              {item.domainIds.map((id) => {
                const domain = data.domains.find((entry) => entry.id === id);
                return domain ? <span key={id} className={`domain-meta domain-color-${domain.color}`}>
                  <i aria-hidden="true" />{domain.name}</span> : null;
              })}
            </div>
            {event?.description ? <p>{event.description}</p> : null}
            {skill?.learningPath ? <p>学习路径：{skill.learningPath}</p> : null}
            {person?.sharedExperiences || person?.notes || skill?.practice || skill?.reflection ?
              <details className="record-details"><summary>更多记录</summary>
                {person?.sharedExperiences ? <p>共同经历：{person.sharedExperiences}</p> : null}
                {person?.notes ? <p>备注：{person.notes}</p> : null}
                {skill?.practice ? <p>练习与成果：{skill.practice}</p> : null}
                {skill?.reflection ? <p>复盘：{skill.reflection}</p> : null}
              </details> : null}
            {person ? <PersonEvents person={person} events={data.events}
              domainId={domainId} includeArchived={showArchived} /> : null}
            {person?.dates?.some(date => date.kind === "important") ?
              <details className="record-details"><summary>其他重要日期</summary>
                <dl className="person-date-summary">{person.dates.filter(date => date.kind === "important")
                  .map((date, index) => <div key={index}><dt>{date.label}</dt>
                    <dd><time dateTime={date.date}>{date.date}</time></dd></div>)}</dl>
              </details> : null}
            {event?.personId ? <Link to={`/people#person-${encodeURIComponent(event.personId)}`}>
              人物：{personName.get(event.personId) ?? "已归档人物"}</Link> : null}
            {(event?.goalId || skill?.goalId) ? <Link to={`/goals#goal-${encodeURIComponent(
              (event?.goalId ?? skill?.goalId)! )}`}>目标：{goalTitle.get(
                (event?.goalId ?? skill?.goalId)!) ?? "已有目标"}</Link> : null}
          </div>
        </li>;
      })}
    </ol> : <p className="planning-empty">这里还没有符合条件的记录。</p>}
    {type === "event" ? <PersonRelationshipTimeline domainId={domainId} personId={personId} /> : null}
    {type === "event" && !personId ? <>
      <GoalTimeline domainId={domainId} />
      <DomainTimeline domainId={domainId} />
      <Timeline data={data} domainId={domainId} />
    </> : null}
  </>;
  }
  return <section className="record-page">
    {renderContent("before")}
    {editing ? <RecordEditor key={`${type}:${editing.item?.id ?? "new"}`}
      kind={type} item={editing.item} data={editing.data} defaultDomainId={editing.domainId}
      defaultPersonId={editing.personId}
      onClose={closeEditor} onSaved={() => { closeEditor(); void reload(); }} /> : null}
    {renderContent("after")}
  </section>;
}

function PersonEvents({ person, events, domainId, includeArchived }: {
  person: Person; events: readonly LifeEvent[]; domainId: string; includeArchived: boolean;
}) {
  const related = selectPersonEvents(events, person.id, domainId, includeArchived);
  const params = new URLSearchParams({ person: person.id });
  if (domainId) params.set("domain", domainId);
  const href = `/timeline?${params.toString()}`;
  return <details className="record-details person-events">
    <summary>重要事件 · {related.length}</summary>
    {related.length ? <ol>{related.map((event) => <li key={event.id}>
      <time dateTime={event.happenedOn}>{event.happenedOn}</time>
      <Link to={`${href}#event-${encodeURIComponent(event.id)}`}>{event.title}</Link>
      {event.archived ? <span className="goal-status">已归档</span> : null}
    </li>)}</ol> : <p className="context-summary-empty">当前范围内暂无关联事件。</p>}
    <Link to={href}>查看人物事件：{person.name}</Link>
    <Link to={`${href}#person-relationships`}>查看关系变化：{person.name}</Link>
  </details>;
}

function Timeline({ data, domainId }: { data: Data; domainId: string }) {
  const entries = [
    ...data.goals.filter((item) => item.completedAt &&
      (!domainId || item.domainIds.includes(domainId))).map((item) => ({
      id: `goal-${item.id}`, date: item.completedAt!.slice(0, 10), label: "完成目标",
      title: item.title, href: `/goals#goal-${encodeURIComponent(item.id)}`,
    })),
    ...data.decisions.filter((item) => item.status === "decided" &&
      (!domainId || item.domainIds.includes(domainId))).map((item) => ({
      id: `decision-${item.id}`, date: item.decidedOn, label: "关键决策",
      title: item.title, href: `/decisions#decision-${encodeURIComponent(item.id)}`,
    })),
    ...data.reviews.filter((item) => !domainId || item.domainIds.includes(domainId)).map((item) => ({
      id: `review-${item.id}`, date: item.reviewedOn, label: "回顾节点",
      title: item.title, href: `/reviews#review-${encodeURIComponent(item.id)}`,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return <section className="record-timeline" aria-label="其他人生节点">
    <h2>其他人生节点</h2>
    {entries.length ? <ol>{entries.map((entry) => <li key={entry.id}>
      <time dateTime={entry.date}>{entry.date}</time><span>{entry.label}</span>
      <Link to={entry.href}>{entry.title}</Link></li>)}</ol> :
      <p className="context-summary-empty">暂时没有目标完成、决策或回顾节点。</p>}
  </section>;
}

export function PeoplePage() { return <LifeRecordsPage type="person" />; }
export function TimelinePage() { return <LifeRecordsPage type="event" />; }
export function SkillsPage() { return <LifeRecordsPage type="skill" />; }
