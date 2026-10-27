import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Save } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import type { LifeDomain } from "../domain/life/LifeDomain";
import { DomainEditorDialog } from "./DomainEditorDialog";
import { DomainIcon } from "./DomainIcon";
import { validateTemplate, type Template } from "../domain/templates/Template";
import type { LifeDomainService } from "../services/life/LifeDomainService";
import type { TemplateService } from "../services/templates/TemplateService";

type DomainRead = { service: LifeDomainService; revision: number };
type DomainResult = { source: DomainRead } & (
  { kind: "ready"; domains: readonly LifeDomain[] } | { kind: "error" });
type TemplateRequest = { read: DomainRead; service: TemplateService; id: string | null; revision: number };
type DomainEditor = { source: DomainRead; domains: readonly LifeDomain[]; domain?: LifeDomain;
  template?: Template; request?: TemplateRequest };
type OrderDraft = { source: DomainRead; domains: readonly LifeDomain[]; error: boolean };

export function SetupDomains({ onPendingChange, onDomainsChanged }: {
  onPendingChange?(pending: boolean): void;
  onDomainsChanged?(domains: readonly LifeDomain[]): void;
}) {
  const { lifeDomainService, templateService } = useLifeOS();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const templateId = params.get("template");
  const templateRequested = params.has("template");
  const [result, setResult] = useState<DomainResult | null>(null);
  const [editor, setEditor] = useState<DomainEditor | null>(null);
  const [templateError, setTemplateError] = useState<{ source: TemplateRequest; message: string } | null>(null);
  const [templateRevision, setTemplateRevision] = useState(0);
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<DomainRead | null>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  const read = useMemo(() => ({ service: lifeDomainService, revision }), [lifeDomainService, revision]);
  const request = useMemo(() => ({ read, service: templateService, id: templateId, revision: templateRevision }),
    [read, templateService, templateId, templateRevision]);
  const latest = useRef({ read, request, onDomainsChanged });
  useLayoutEffect(() => { latest.current = { read, request, onDomainsChanged }; }, [read, request, onDomainsChanged]);
  const current = result?.source === read ? result : null;
  const domains = draft?.domains ?? (current?.kind === "ready" ? current.domains : null);
  const dirty = draft !== null;
  const error = draft?.error ? "领域顺序保存失败，请重试或重新读取。"
    : current?.kind === "error" ? "人生领域读取失败，请重试。" : "";
  const requestError = templateRequested && !templateId ? "领域模板入口无效，请取消后重新选择。"
    : templateError?.source === request ? templateError.message : "";
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let current = true;
    void read.service.list().then(items => { if (current) {
      setResult({ source: read, kind: "ready", domains: items });
      latest.current.onDomainsChanged?.(items);
    } })
      .catch(() => { if (current) setResult({ source: read, kind: "error" }); });
    return () => { current = false; };
  }, [read]);
  useEffect(() => {
    if (!request.id || current?.kind !== "ready" || editor !== null || dirty || busy ||
      templateError?.source === request) return;
    let active = true;
    void request.service.find(request.id).then(template => {
      if (!active || !mounted.current || latest.current.request !== request) return;
      if (!template || template.category !== "domain") {
        setTemplateError({ source: request, message: "领域模板已不存在，请返回模板中心重新选择。" });
        return;
      }
      const checked = validateTemplate("domain", template.name, template.defaults);
      setEditor({ source: read, domains: current.domains, request,
        template: { ...template, defaults: checked.defaults } });
    }).catch(() => {
      if (active && mounted.current && latest.current.request === request)
        setTemplateError({ source: request, message: "领域模板读取失败，请重试或重新选择。" });
    });
    return () => { active = false; };
  }, [request, read, current, editor, dirty, busy, templateError]);
  useEffect(() => {
    if (!editor?.template || editor.request !== request || editor.template.id !== templateId) return;
    const next = new URLSearchParams(location.search);
    next.delete("template");
    navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, { replace: true });
  }, [editor, request, templateId, location, navigate]);
  useEffect(() => { onPendingChange?.(current?.kind !== "ready" || editor !== null || dirty || busy || templateRequested); },
    [current, editor, dirty, busy, templateRequested, onPendingChange]);
  function move(index: number, offset: number) {
    if (!domains || saving.current || editor || index < 0 || index >= domains.length ||
      index + offset < 0 || index + offset >= domains.length) return;
    const items = [...domains];
    [items[index], items[index + offset]] = [items[index + offset], items[index]];
    setDraft({ source: draft?.source ?? read, domains: items, error: false }); setSaved(null);
  }
  async function saveOrder() {
    if (!draft || editor || saving.current || !mounted.current) return;
    const original = draft;
    saving.current = true; setBusy(true); setSaved(null);
    setDraft({ ...original, error: false });
    try {
      await original.source.service.reorder(original.domains.map(domain => domain.id));
      if (!mounted.current) return;
      const items = original.domains.map((domain, index) => ({ ...domain, sortOrder: index }));
      setDraft(null);
      if (latest.current.read === original.source) {
        setResult({ source: original.source, kind: "ready", domains: items });
        latest.current.onDomainsChanged?.(items); setSaved(original.source);
      }
    } catch {
      if (mounted.current) setDraft({ ...original, error: true });
    } finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  function cancelOrder() {
    if (saving.current || editor) return;
    setDraft(null); setSaved(null); setRevision(value => value + 1);
  }
  function openEditor(domain?: LifeDomain) {
    if (saving.current || dirty || editor || templateRequested || current?.kind !== "ready") return;
    setEditor({ source: read, domains: current.domains, domain });
  }
  return <section className="settings-section" aria-labelledby="setup-domains-title" aria-busy={busy}>
    <header className="section-heading"><h2 id="setup-domains-title">人生领域</h2>
      <div className="landscape-settings-actions">
        <Link className="button-secondary" to="/templates?category=domain" aria-disabled={busy || dirty || editor !== null}
          onClick={event => { if (saving.current || dirty || editor) event.preventDefault(); }}><Copy size={16} />领域模板</Link>
        <button type="button" className="button-secondary" disabled={busy || dirty || editor !== null || current?.kind !== "ready" || templateRequested}
          onClick={() => openEditor()}><Plus size={16} />添加领域</button>
      </div>
    </header>
    {templateRequested && requestError ? <div className="form-error" role="alert">
      <p>{requestError}</p>
      <button type="button" className="button-secondary" disabled={busy || editor !== null || !templateId} onClick={() => {
        setTemplateError(null); setTemplateRevision(value => value + 1);
      }}>重试读取模板</button>
      <button type="button" className="button-secondary" disabled={busy || editor !== null} onClick={() => {
        const next = new URLSearchParams(location.search); next.delete("template");
        navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, { replace: true });
      }}>取消模板请求</button>
    </div> : templateId && !editor && current?.kind === "ready" && !dirty && !busy
      ? <p role="status">正在读取领域模板</p> : null}
    {error ? <p className="form-error" role="alert">{error}<button type="button" className="button-secondary"
      disabled={busy || editor !== null} onClick={cancelOrder}>重新读取</button></p> : null}
    {draft && draft.source !== read ? <p role="status">领域顺序草稿仍属于原生活空间，可继续保存或取消。</p> : null}
    {domains === null ? current?.kind === "error" ? null : <p role="status">正在读取人生领域</p> : <ul className="setup-domain-list" aria-label="领域全局顺序">
      {domains.map((domain, index) => <li key={domain.id}><DomainIcon icon={domain.icon} size={18} />
        <div><strong>{domain.name}</strong><span>{domain.status === "active" ? "启用" : domain.status === "paused" ? "已暂停" : "已归档"}</span></div>
        <div className="landscape-settings-move">
          <button type="button" className="icon-button" title={"上移" + domain.name} aria-label={"上移" + domain.name}
            disabled={busy || editor !== null || templateRequested || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
          <button type="button" className="icon-button" title={"下移" + domain.name} aria-label={"下移" + domain.name}
            disabled={busy || editor !== null || templateRequested || index === domains.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
          <button type="button" className="icon-button" title={"编辑" + domain.name} aria-label={"编辑" + domain.name}
            disabled={busy || dirty || editor !== null || templateRequested || current?.kind !== "ready"} onClick={() => openEditor(domain)}><Pencil size={16} /></button>
        </div>
      </li>)}
    </ul>}
    {domains?.length ? <div className="landscape-settings-actions">
      <button type="button" className="button-primary" disabled={busy || !dirty || editor !== null} onClick={() => void saveOrder()}>
        <Save size={16} />{busy ? "正在保存" : "保存顺序"}</button>
      {dirty ? <button type="button" className="button-secondary" disabled={busy || editor !== null}
        onClick={cancelOrder}>取消</button> : null}
      {saved === read ? <span role="status">领域顺序已保存</span> : null}
    </div> : null}
    {editor ? <DomainEditorDialog domain={editor.domain} template={editor.template}
      onClose={() => setEditor(null)} onSaved={saved => {
      if (!mounted.current) return;
      if (editor.source === latest.current.read) {
        const items = editor.domains.some(item => item.id === saved.id)
          ? editor.domains.map(item => item.id === saved.id ? saved : item) : [...editor.domains, saved];
        setResult({ source: editor.source, kind: "ready", domains: items });
        latest.current.onDomainsChanged?.(items);
      }
      setEditor(null);
    }} /> : null}
  </section>;
}
