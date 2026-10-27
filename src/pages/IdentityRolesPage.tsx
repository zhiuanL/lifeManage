import { useEffect, useRef, useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, ArrowLeft, History, Pencil, Plus, Save, X } from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { IdentityRoleValidationError, type IdentityRole, type IdentityRoleDraft } from "../domain/life/IdentityRole";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { Goal } from "../domain/planning/Goal";

interface Data { roles: readonly IdentityRole[]; domains: readonly LifeDomain[]; goals: readonly Goal[] }
interface Editing { record: IdentityRole | null; draft: IdentityRoleDraft; domains: readonly LifeDomain[]; goals: readonly Goal[] }
const privacyLabels = { normal: "普通", private: "私密", highly_sensitive: "高度敏感" } as const;

export function IdentityRolesPage() {
  const { identityRoleService, lifeDomainService, goalService } = useLifeOS();
  const { hash } = useLocation();
  const [params] = useSearchParams();
  const goalId = params.get("goalId"), domainId = params.get("domainId");
  let linkedId = "";
  try { if (hash.startsWith("#role-")) linkedId = decodeURIComponent(hash.slice(6)); } catch { /* Ignore malformed fragments. */ }
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [archived, setArchived] = useState(false);
  const [filter, setFilter] = useState("all");
  const [retry, setRetry] = useState(0);
  const saving = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const triggerRecordId = useRef<string | null>(null);
  const archiveFilter = useRef<HTMLInputElement | null>(null);
  const restoreFocus = useRef(false);
  const focused = useRef("");
  const mounted = useRef(false);
  const editingRef = useRef<Editing | null>(null);
  const requests = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requests.current += 1; };
  }, []);
  useEffect(() => {
    const request = ++requests.current;
    void Promise.all([identityRoleService.list(), lifeDomainService.list(), goalService.list()])
      .then(([roles, domains, goals]) => {
        if (mounted.current && request === requests.current) { setData({ roles, domains, goals }); setError(""); }
      }).catch(() => {
        if (mounted.current && request === requests.current) setError("身份角色读取失败，请重试。");
      });
    return () => { requests.current += 1; };
  }, [identityRoleService, lifeDomainService, goalService, retry]);
  useEffect(() => {
    if (!editing && !busy && restoreFocus.current) {
      restoreFocus.current = false;
      if (trigger.current?.isConnected) trigger.current.focus();
      else {
        const recordButton = triggerRecordId.current
          ? document.getElementById("role-" + triggerRecordId.current)?.querySelector<HTMLButtonElement>("button:not(:disabled)")
          : null;
        (recordButton ?? archiveFilter.current)?.focus();
      }
    }
  }, [editing, busy]);
  useEffect(() => {
    if (!linkedId) { focused.current = ""; return; }
    if (!data || focused.current === linkedId) return;
    const element = document.getElementById("role-" + linkedId);
    if (element) {
      focused.current = linkedId;
      element.scrollIntoView?.({ block: "center" }); element.focus({ preventScroll: true });
    }
  }, [data, linkedId]);
  function begin(record: IdentityRole | null, button: HTMLButtonElement) {
    if (!mounted.current || saving.current || editingRef.current || !data || error) return;
    trigger.current = button; triggerRecordId.current = record?.id ?? null; setSaveError("");
    const next: Editing = { record, domains: data.domains, goals: data.goals, draft: record ? { ...record } : {
      name: "", description: "", active: true, privacyLevel: "private",
      domainIds: domainId && data?.domains.some(item => item.id === domainId && item.status !== "archived") ? [domainId] : [],
      goalIds: goalId && data?.goals.some(item => item.id === goalId && item.status !== "archived") ? [goalId] : [],
    } };
    editingRef.current = next; setEditing(next);
  }
  function cancel() {
    if (!mounted.current || saving.current) return;
    restoreFocus.current = true; editingRef.current = null; setEditing(null); setSaveError("");
  }
  function change(draft: Partial<IdentityRoleDraft>) {
    if (!mounted.current || saving.current || !editingRef.current) return;
    const next = { ...editingRef.current, draft: { ...editingRef.current.draft, ...draft } };
    editingRef.current = next; setEditing(next);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const submitted = editingRef.current;
    if (!mounted.current || !submitted || saving.current) return;
    saving.current = true; setBusy(true); setSaveError("");
    try {
      const next = submitted.record ? await identityRoleService.update(submitted.record.id, submitted.draft)
        : await identityRoleService.create(submitted.draft);
      if (!mounted.current) return;
      requests.current += 1;
      setData(current => current ? { ...current, roles: current.roles.some(role => role.id === next.id)
        ? current.roles.map(role => role.id === next.id ? next : role) : [...current.roles, next] } : current);
      restoreFocus.current = true; editingRef.current = null; setEditing(null);
    } catch (reason) {
      if (mounted.current) setSaveError(reason instanceof IdentityRoleValidationError
        ? reason.message : "保存失败，请重试。");
    } finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  async function toggleArchive(record: IdentityRole, button: HTMLButtonElement) {
    if (!mounted.current || saving.current || editingRef.current || error) return;
    trigger.current = button; triggerRecordId.current = record.id;
    saving.current = true; setBusy(true); setSaveError("");
    try {
      const next = await identityRoleService.setArchived(record.id, !record.archivedAt);
      if (!mounted.current) return;
      requests.current += 1;
      setData(current => current ? { ...current, roles: current.roles.map(role => role.id === next.id ? next : role) } : current);
      restoreFocus.current = true;
    } catch (reason) {
      if (mounted.current) setSaveError(reason instanceof IdentityRoleValidationError
        ? reason.message : "操作失败，请重试。");
    } finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  function editor() {
    if (!editing || !data) return null;
    return <form className="navigation-editor role-editor" aria-label={editing.record ? "编辑身份角色" : "新增身份角色"}
      onSubmit={save} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); cancel(); } }}>
      <fieldset disabled={busy}>
        <label className="form-field">名称<input autoFocus required maxLength={120} value={editing.draft.name}
          onChange={event => change({ name: event.target.value })} /></label>
        <label className="form-field">说明<textarea rows={3} maxLength={6000} value={editing.draft.description}
          onChange={event => change({ description: event.target.value })} /></label>
        <div className="role-editor-options">
          <label className="role-check"><input type="checkbox" checked={editing.draft.active}
            onChange={event => change({ active: event.target.checked })} />启用角色</label>
          <label className="form-field">隐私级别<select value={editing.draft.privacyLevel}
            onChange={event => change({ privacyLevel: event.target.value as IdentityRoleDraft["privacyLevel"] })}>
            {Object.entries(privacyLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
          </select></label>
        </div>
        <details className="role-associations"><summary>关联领域与目标</summary>
          {(["domain", "goal"] as const).map(type => {
            const ids = type === "domain" ? editing.draft.domainIds : editing.draft.goalIds;
            const records = type === "domain" ? editing.domains : editing.goals;
            return <fieldset className="role-link-options" key={type}><legend>{type === "domain" ? "生活领域" : "目标"}</legend>
              {records.length ? records.filter(record => record.status !== "archived" || ids.includes(record.id)).map(record =>
                <label className="role-check" key={record.id}><input type="checkbox" checked={ids.includes(record.id)}
                  disabled={record.status === "archived" && !ids.includes(record.id)}
                  onChange={event => {
                    const next = event.target.checked ? [...ids, record.id] : ids.filter(id => id !== record.id);
                    change(type === "domain" ? { domainIds: next } : { goalIds: next });
                  }} />{"name" in record ? record.name : record.title}{record.status === "archived" ? "（已归档）" : ""}</label>)
                : <p className="muted-text">{type === "domain" ? "暂无领域" : "暂无目标"}</p>}
            </fieldset>;
          })}
        </details>
        {saveError && <p role="alert" className="form-error">{saveError}</p>}
        <div className="navigation-commands"><button type="submit" className="button-primary"><Save size={16} aria-hidden="true" />保存</button>
          <button type="button" className="button-secondary" onClick={cancel}><X size={16} aria-hidden="true" />取消</button></div>
      </fieldset>
    </form>;
  }
  const displayed = editing?.record && !data?.roles.some(role => role.id === editing.record?.id)
    ? [...(data?.roles ?? []), editing.record] : data?.roles;
  const visible = displayed?.filter(role => role.id === editing?.record?.id || role.id === linkedId || ((archived || !role.archivedAt)
    && (filter === "all" || role.active === (filter === "active"))
    && (!goalId || role.goalIds.includes(goalId)) && (!domainId || role.domainIds.includes(domainId)))) ?? [];
  return <section className="navigation-page roles-page">
    <Link className="role-back" to={goalId ? "/goals/" + encodeURIComponent(goalId)
      : domainId ? "/domains/" + encodeURIComponent(domainId) : "/settings"}>
      <ArrowLeft size={16} aria-hidden="true" />{goalId ? "返回目标" : domainId ? "返回领域" : "设置"}</Link>
    <header className="page-header"><h1>身份角色</h1>
      <button className="icon-button" type="button" aria-label="添加身份角色" title="添加身份角色"
        disabled={!data || busy || !!editing || !!error} onClick={event => begin(null, event.currentTarget)}><Plus size={18} aria-hidden="true" /></button>
    </header>
    <div className="role-filters">
      <label>启用状态<select aria-label="角色启用状态" disabled={busy || !!editing} value={filter}
        onChange={event => { if (!saving.current && !editingRef.current) setFilter(event.target.value); }}><option value="all">全部</option><option value="active">已启用</option><option value="inactive">已停用</option></select></label>
      <label className="role-check"><input ref={archiveFilter} type="checkbox" checked={archived} disabled={busy || !!editing}
        onChange={event => { if (!saving.current && !editingRef.current) setArchived(event.target.checked); }} />显示已归档</label>
      {(goalId || domainId) && <Link to="/roles">查看全部角色</Link>}
    </div>
    {data && (goalId || domainId) && <p className="muted-text">
      {goalId ? "关联目标：" + (data.goals.find(goal => goal.id === goalId)?.title ?? "目标已不可用")
        : "关联领域：" + (data.domains.find(domain => domain.id === domainId)?.name ?? "领域已不可用")}
    </p>}
    {error && <div role="alert"><p>{error}</p><button className="button-secondary" disabled={busy}
      onClick={() => { if (!saving.current) setRetry(value => value + 1); }}>重试</button></div>}
    {!data && !error && <p role="status">正在读取身份角色...</p>}
    {data && linkedId && !data.roles.some(role => role.id === linkedId) && <p role="status">链接对应的身份角色不存在。</p>}
    {saveError && !editing && <p role="alert" className="form-error">{saveError}</p>}
    {editing && !editing.record && editor()}
    {data && visible.map(role => <article className="navigation-record" key={role.id} id={"role-" + role.id} tabIndex={-1}>
      {editing?.record?.id === role.id ? editor() : <>
        <div className="navigation-record-heading"><h2>{role.name}</h2><div className="navigation-commands">
          <span className="muted-text">{role.archivedAt ? "已归档" : role.active ? "已启用" : "已停用"}</span>
          <Link className="icon-button" aria-label={"查看" + role.name + "的版本历史"} title="版本历史"
            to={"/history?type=role&id=" + encodeURIComponent(role.id)}><History size={16} aria-hidden="true" /></Link>
          {!role.archivedAt && <button className="icon-button" aria-label={"编辑" + role.name} title="编辑"
            disabled={busy || !!editing || !!error} onClick={event => begin(role, event.currentTarget)}><Pencil size={16} aria-hidden="true" /></button>}
          <button className="icon-button" aria-label={(role.archivedAt ? "恢复" : "归档") + role.name} title={role.archivedAt ? "恢复" : "归档"}
            disabled={busy || !!editing || !!error} onClick={event => void toggleArchive(role, event.currentTarget)}>
            {role.archivedAt ? <ArchiveRestore size={16} aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />}</button>
        </div></div>
        {role.description && <p className="navigation-content">{role.description}</p>}
        <div className="role-context"><span>{privacyLabels[role.privacyLevel]}</span>
          {role.domainIds.map(id => <Link key={"domain-" + id} to={"/domains/" + encodeURIComponent(id)}>
            {data.domains.find(domain => domain.id === id)?.name ?? "领域已不可用"}</Link>)}
          {role.goalIds.map(id => <Link key={"goal-" + id} to={"/goals/" + encodeURIComponent(id)}>
            {data.goals.find(goal => goal.id === id)?.title ?? "目标已不可用"}</Link>)}
        </div>
      </>}
    </article>)}
    {data && !visible.length && !editing && <p className="muted-text">暂无符合条件的身份角色</p>}
  </section>;
}
