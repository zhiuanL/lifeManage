import { useEffect, useRef, useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, History, Pencil, Plus, Save, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { NavigationValidationError, navigationKinds, navigationLabels, type LifeNavigation, type NavigationDraft, type NavigationKind } from "../domain/life/LifeNavigation";

interface Editing { kind: NavigationKind; record: LifeNavigation | null; draft: NavigationDraft }
export function LifeNavigationPage() {
  const { lifeNavigationService } = useLifeOS();
  const { hash } = useLocation();
  let linkedId = "";
  try {
    if (hash.startsWith("#navigation-")) linkedId = decodeURIComponent(hash.slice(12));
  } catch { /* Invalid URL fragments do not select a record. */ }
  const [records, setRecords] = useState<readonly LifeNavigation[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [archived, setArchived] = useState(false);
  const [retry, setRetry] = useState(0);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const triggerRecordId = useRef<string | null>(null);
  const archiveFilter = useRef<HTMLInputElement | null>(null);
  const focusPending = useRef(false);
  const focusedLink = useRef("");
  const mounted = useRef(false);
  const saving = useRef(false);
  const editingRef = useRef<Editing | null>(null);
  const requests = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requests.current += 1; };
  }, []);
  useEffect(() => {
    const request = ++requests.current;
    lifeNavigationService.list().then(value => {
      if (mounted.current && request === requests.current) { setRecords(value); setError(null); }
    }).catch(() => {
      if (mounted.current && request === requests.current) setError("人生导航读取失败，请重试。");
    });
    return () => { requests.current += 1; };
  }, [lifeNavigationService, retry]);
  useEffect(() => {
    if (!editing && !busy && focusPending.current) {
      focusPending.current = false;
      if (trigger.current?.isConnected) trigger.current.focus();
      else {
        const recordButton = triggerRecordId.current
          ? document.getElementById("navigation-" + triggerRecordId.current)?.querySelector<HTMLButtonElement>("button:not(:disabled)")
          : null;
        (recordButton ?? archiveFilter.current)?.focus();
      }
    }
  }, [editing, busy]);
  useEffect(() => {
    if (!linkedId) { focusedLink.current = ""; return; }
    if (!records || focusedLink.current === linkedId) return;
    const element = document.getElementById("navigation-" + linkedId);
    if (!element) return;
    focusedLink.current = linkedId;
    element.scrollIntoView?.({ block: "center" });
    element.focus({ preventScroll: true });
  }, [records, linkedId]);
  function begin(kind: NavigationKind, record: LifeNavigation | null, button: HTMLButtonElement) {
    if (!mounted.current || saving.current || editingRef.current || !records || error) return;
    trigger.current = button; triggerRecordId.current = record?.id ?? null; setSaveError(null);
    const next = { kind, record, draft: { title: record?.title ?? "", description: record?.description ?? "" } };
    editingRef.current = next; setEditing(next);
  }
  function change(patch: Partial<NavigationDraft>) {
    if (!mounted.current || saving.current || !editingRef.current) return;
    const next = { ...editingRef.current, draft: { ...editingRef.current.draft, ...patch } };
    editingRef.current = next; setEditing(next);
  }
  function cancel() {
    if (!mounted.current || saving.current) return;
    focusPending.current = true; editingRef.current = null; setEditing(null); setSaveError(null);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const submitted = editingRef.current;
    if (!mounted.current || !submitted || saving.current) return;
    saving.current = true; setBusy(true); setSaveError(null);
    try {
      let next: LifeNavigation;
      if (submitted.record) {
        next = await lifeNavigationService.update(submitted.record.id, submitted.draft);
      } else next = await lifeNavigationService.create(submitted.kind, submitted.draft);
      if (!mounted.current) return;
      requests.current += 1;
      setRecords(current => current?.some(record => record.id === next.id)
        ? current.map(record => record.id === next.id ? next : record) : [...(current ?? []), next]);
      focusPending.current = true; editingRef.current = null; setEditing(null);
    } catch (reason) {
      if (mounted.current) setSaveError(reason instanceof NavigationValidationError
        ? reason.message : "保存失败，请重试。");
    } finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  async function toggleArchive(record: LifeNavigation, button: HTMLButtonElement) {
    if (!mounted.current || saving.current || editingRef.current || error) return;
    trigger.current = button; triggerRecordId.current = record.id;
    saving.current = true; setBusy(true); setSaveError(null);
    try {
      const next = await lifeNavigationService.setArchived(record.id, !record.archivedAt);
      if (!mounted.current) return;
      requests.current += 1;
      setRecords(current => current?.map(item => item.id === next.id ? next : item) ?? null);
      focusPending.current = true;
    } catch (reason) {
      if (mounted.current) setSaveError(reason instanceof NavigationValidationError
        ? reason.message : "操作失败，请重试。");
    } finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  function editor() {
    if (!editing) return null;
    return <form className="navigation-editor" aria-label={editing.record ? "编辑导航记录" : "新增导航记录"}
      onSubmit={save} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); cancel(); } }}>
      <fieldset disabled={busy}>
        <label className="form-field">标题<input autoFocus required maxLength={120} value={editing.draft.title}
          onChange={event => change({ title: event.target.value })} /></label>
        <label className="form-field">内容<textarea rows={5} maxLength={6000} value={editing.draft.description}
          onChange={event => change({ description: event.target.value })} /></label>
        {saveError && <p role="alert" className="form-error">{saveError}</p>}
        <div className="navigation-commands"><button type="submit" className="button-primary"><Save size={16} aria-hidden="true" />保存</button>
          <button type="button" className="button-secondary" onClick={cancel}><X size={16} aria-hidden="true" />取消</button></div>
      </fieldset>
    </form>;
  }
  const displayed = editing?.record && !records?.some(record => record.id === editing.record?.id)
    ? [...(records ?? []), editing.record] : records;
  return <section className="navigation-page">
    <header className="page-header"><h1>人生导航</h1>
      <label className="navigation-archive-filter"><input ref={archiveFilter} type="checkbox" checked={archived} disabled={busy || !!editing}
        onChange={event => { if (!saving.current && !editingRef.current) setArchived(event.target.checked); }} />显示已归档</label></header>
    {error && <div role="alert"><p>{error}</p><button className="button-secondary" disabled={busy}
      onClick={() => { if (!saving.current) setRetry(value => value + 1); }}>重试</button></div>}
    {!records && !error && <p role="status">正在读取人生导航...</p>}
    {records && linkedId && !records.some(record => record.id === linkedId) &&
      <p role="status">链接对应的导航记录不存在。</p>}
    {saveError && !editing && <p role="alert" className="form-error">{saveError}</p>}
    {displayed && navigationKinds.map(kind => <section className="navigation-section" key={kind} aria-label={navigationLabels[kind]}>
      <header><h2>{navigationLabels[kind]}</h2><button className="icon-button" type="button"
        aria-label={"添加" + navigationLabels[kind]} title={"添加" + navigationLabels[kind]} disabled={busy || !!editing || !!error}
        onClick={event => begin(kind, null, event.currentTarget)}><Plus size={18} aria-hidden="true" /></button></header>
      {displayed.filter(record => record.kind === kind &&
        (archived || !record.archivedAt || record.id === linkedId || record.id === editing?.record?.id)).map(record =>
        <article className="navigation-record" key={record.id} id={"navigation-" + record.id} tabIndex={-1}>
          {editing?.record?.id === record.id ? editor() : <>
            <div className="navigation-record-heading"><h3>{record.title}</h3><div className="navigation-commands">
              {record.archivedAt ? <span className="muted-text">已归档</span> : <button className="icon-button"
                aria-label={"编辑" + record.title} title="编辑" disabled={busy || !!editing || !!error}
                onClick={event => begin(kind, record, event.currentTarget)}><Pencil size={16} aria-hidden="true" /></button>}
              {!busy && !editing && <Link className="icon-button"
                to={`/history?type=navigation&id=${encodeURIComponent(record.id)}`}
                aria-label={"查看" + record.title + "的版本历史"} title="版本历史">
                <History size={16} aria-hidden="true" /></Link>}
              <button className="icon-button" aria-label={(record.archivedAt ? "恢复" : "归档") + record.title}
                title={record.archivedAt ? "恢复" : "归档"} disabled={busy || !!editing || !!error} onClick={event => void toggleArchive(record, event.currentTarget)}>
                {record.archivedAt ? <ArchiveRestore size={16} aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />}</button>
            </div></div>
            {record.description && <p className="navigation-content">{record.description}</p>}
          </>}
        </article>)}
      {editing?.kind === kind && !editing.record && editor()}
      {!displayed.some(record => record.kind === kind && (archived || !record.archivedAt || record.id === linkedId)) && editing?.kind !== kind &&
        <p className="muted-text">暂未记录</p>}
    </section>)}
  </section>;
}
