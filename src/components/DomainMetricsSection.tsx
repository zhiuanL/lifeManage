import { Archive, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { MetricValidationError, type MetricDefinition, type MetricRecord } from "../domain/life/DomainMetric";
import type { LifeDomain } from "../domain/life/LifeDomain";
import { metricPresets } from "../domain/life/MetricPresets";
import { domainSatisfaction, type DomainSatisfactionLink } from "../domain/life/DomainSatisfaction";
import type { DomainMetricService } from "../services/life/DomainMetricService";
import { buildDomainMetricTrends, recentMetricWindow } from "../domain/analytics/DomainMetricTrend";
import { MetricTrendView } from "./analytics/MetricTrendView";

type MetricState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; definitions: readonly MetricDefinition[]; records: readonly MetricRecord[];
      domains: readonly LifeDomain[]; satisfactionLinks: readonly DomainSatisfactionLink[] };
type Editor = { kind: "definition" } | { kind: "record"; definition: MetricDefinition; record?: MetricRecord };
interface EditorSnapshot {
  editor: Editor; currentDomainId: string | null; domains: readonly LifeDomain[];
  service: DomainMetricService; source: () => Promise<MetricState>;
}
interface SatisfactionEditorSnapshot {
  domainId: string; metricId: string; definitions: readonly MetricDefinition[];
  service: DomainMetricService; source: () => Promise<MetricState>;
}
const loadingState: MetricState = { kind: "loading" };

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function DomainMetricsSection({ domain, suspended = false }: { domain?: LifeDomain; suspended?: boolean }) {
  const { domainMetricService, lifeDomainService } = useLifeOS();
  const { hash } = useLocation();
  const [read, setRead] = useState<{
    source: () => Promise<MetricState>; generation: number; state: MetricState;
  } | null>(null);
  const [generation, setGeneration] = useState(0);
  const [editor, setEditor] = useState<EditorSnapshot | null>(null);
  const [satisfactionEditor, setSatisfactionEditor] = useState<SatisfactionEditorSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(false);
  const requests = useRef(0);
  const editorOpen = useRef(false);
  const domainId = domain?.id ?? null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requests.current += 1; };
  }, []);

  const load = useCallback(async (): Promise<MetricState> => {
    if (suspended) return { kind: "loading" };
    try {
      const [definitions, records, domains, satisfactionLinks] = await Promise.all([
        domainMetricService.listDefinitions(), domainMetricService.listRecords(), lifeDomainService.list(),
        domainId ? domainMetricService.listSatisfactionLinks() : [],
      ]);
      return { kind: "ready", definitions, records, domains, satisfactionLinks };
    } catch {
      return { kind: "error", message: "指标读取失败，请重试。" };
    }
  }, [domainMetricService, lifeDomainService, domainId, suspended]);
  const currentSource = useRef(load);
  useEffect(() => { currentSource.current = load; }, [load]);
  const state: MetricState = read?.source === load && read.generation === generation
    ? read.state : loadingState;

  useEffect(() => {
    const request = ++requests.current;
    void load().then((result) => {
      if (mounted.current && request === requests.current) setRead({ source: load, generation, state: result });
    });
    return () => { requests.current += 1; };
  }, [load, generation]);

  useEffect(() => {
    if (state.kind !== "ready") return;
    const record = state.records.find((item) =>
      hash === `#metric-record-${encodeURIComponent(item.id)}` &&
      state.definitions.some((definition) =>
        definition.id === item.metricId && (!domainId || definition.domainIds.includes(domainId))));
    if (record) {
      document.getElementById(`metric-record-${record.id}`)?.scrollIntoView?.({ block: "center" });
      return;
    }
    const definition = state.definitions.find((item) =>
      hash === `#metric-${encodeURIComponent(item.id)}` &&
      (!domainId || item.domainIds.includes(domainId)));
    if (definition) {
      document.getElementById(`metric-${definition.id}`)?.scrollIntoView?.({ block: "center" });
    }
  }, [state, hash, domainId]);

  function refresh() {
    if (!mounted.current) return;
    requests.current += 1;
    setGeneration(current => current + 1);
  }

  function begin(next: Editor) {
    if (!mounted.current || busyRef.current || editorOpen.current || state.kind !== "ready") return;
    editorOpen.current = true;
    setError(null);
    setEditor({ editor: next, currentDomainId: domainId, domains: state.domains,
      service: domainMetricService, source: load });
  }

  function closeEditor() {
    if (!mounted.current) return;
    editorOpen.current = false;
    setEditor(null);
    setSatisfactionEditor(null);
  }

  async function archive(definition: MetricDefinition) {
    if (!mounted.current || busyRef.current || editorOpen.current || state.kind !== "ready") return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await domainMetricService.setArchived(definition.id, !definition.archived);
      if (!mounted.current) return;
      if (currentSource.current === load) refresh();
    } catch (reason) {
      if (mounted.current && currentSource.current === load) setError(reason instanceof MetricValidationError
        ? reason.message : "更新指标失败，请重试。");
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const dialogs = <>
      {editor ? <MetricEditor
        key={editor.editor.kind === "definition" ? "new" : editor.editor.record?.id ?? editor.editor.definition.id}
        editor={editor.editor} currentDomainId={editor.currentDomainId} domains={editor.domains}
        service={editor.service}
        onClose={() => closeEditor()}
        onSaved={() => { if (mounted.current) {
          closeEditor();
          if (currentSource.current === editor.source) refresh();
        } }} /> : null}
      {satisfactionEditor ? <SatisfactionEditor snapshot={satisfactionEditor} onClose={() => closeEditor()}
        onSaved={metricId => {
          if (!mounted.current) return;
          closeEditor();
          if (currentSource.current !== satisfactionEditor.source) return;
          setRead(current => {
            if (!current || current.source !== satisfactionEditor.source || current.state.kind !== "ready") return current;
            const links = current.state.satisfactionLinks.filter(item => item.domainId !== satisfactionEditor.domainId);
            if (metricId) links.push({ domainId: satisfactionEditor.domainId, metricId });
            return { ...current, state: { ...current.state, satisfactionLinks: links } };
          });
        }} /> : null}
    </>;

  function renderSection(content: ReactNode) {
    return <section className="context-planning" aria-labelledby={!suspended && state.kind === "ready" ? "domain-metrics-heading" : undefined}>
      {content}{dialogs}
    </section>;
  }

  if (suspended) return renderSection(null);
  if (state.kind === "loading") return renderSection(<p role="status">正在读取指标</p>);
  if (state.kind === "error") return renderSection(<>
    <p className="form-error" role="alert">{state.message}</p>
    <button className="button-secondary" type="button" disabled={busy}
      onClick={() => { if (!busyRef.current) void refresh(); }}>重试</button>
  </>);

  const definitions = state.definitions.filter((item) => !domainId || item.domainIds.includes(domainId));
  const recentWindow = domainId ? recentMetricWindow(today()) : null;
  const trends = recentWindow ? buildDomainMetricTrends(
    definitions, state.records, domainId, null, recentWindow.start, recentWindow.end,
  ) : [];
  const locked = busy || !!editor || !!satisfactionEditor;
  const satisfaction = domainId
    ? domainSatisfaction(domainId, state.satisfactionLinks, state.definitions, state.records) : null;
  return renderSection(<>
    {satisfaction ? <div className="domain-satisfaction" aria-labelledby="domain-satisfaction-heading">
      <div className="metric-item-heading">
        <h2 id="domain-satisfaction-heading">满意度</h2>
        <button type="button" className="icon-button" title="设置满意度指标" aria-label="设置满意度指标"
          disabled={locked} onClick={() => {
            if (busyRef.current || editorOpen.current || !domainId || !mounted.current) return;
            editorOpen.current = true;
            setSatisfactionEditor({ domainId, service: domainMetricService, source: load,
              metricId: state.satisfactionLinks.find(item => item.domainId === domainId)?.metricId ?? "",
              definitions });
          }}><Pencil size={17} aria-hidden="true" /></button>
      </div>
      {satisfaction.kind === "none" ? <p>不评分</p> :
        satisfaction.kind === "unavailable" ? <p role="alert">评分指标不可用，请重新选择。</p> :
          <div className="satisfaction-value">
            <Link to={`#metric-${encodeURIComponent(satisfaction.definition.id)}`}>
              {satisfaction.definition.name} ({satisfaction.definition.unit})
            </Link>
            {satisfaction.latest ? <Link
              to={`#metric-record-${encodeURIComponent(satisfaction.latest.id)}`}>
              <strong>{satisfaction.latest.value} {satisfaction.definition.unit}</strong>
              <time dateTime={satisfaction.latest.recordedOn}>{satisfaction.latest.recordedOn}</time>
            </Link> : <span>尚无评分记录</span>}
            {satisfaction.definition.archived ? <span>指标已归档 · 记录保留</span> :
              <button type="button" className="button-secondary" disabled={locked}
                onClick={() => begin({ kind: "record", definition: satisfaction.definition })}>
                <Plus size={16} aria-hidden="true" />记录满意度
              </button>}
          </div>}
    </div> : null}
    <div className="context-planning-heading">
      <div><h2 id="domain-metrics-heading">{domainId ? "领域指标" : "状态指标"}</h2></div>
      <div className="planning-heading-actions">
        {domainId ? <Link className="button-secondary" to="/metrics">全部指标</Link> : null}
        <button className="button-secondary" type="button" disabled={locked} onClick={() => begin({ kind: "definition" })}>
          <Plus size={16} aria-hidden="true" />添加指标
        </button>
      </div>
    </div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {definitions.length ? <div className="metric-list">
      {definitions.map((definition) => {
        const records = state.records.filter((item) => item.metricId === definition.id)
          .sort((a, b) => b.recordedOn.localeCompare(a.recordedOn));
        const trend = trends.find(item => item.definition.id === definition.id);
        return <div className={`metric-item${hash === `#metric-${encodeURIComponent(definition.id)}` ? " metric-source" : ""}`}
          id={`metric-${definition.id}`} key={definition.id}>
          <div className="metric-item-heading">
            <div><h3>{definition.name} <span>({definition.unit})</span></h3>
              <p>{definition.archived ? "已归档 · 记录保留" : records.length
                ? `最近记录 ${records[0].recordedOn}` : "尚无记录"}</p>
              {!domainId ? <p>{definition.domainIds.length
                ? definition.domainIds.map(id => state.domains.find(item => item.id === id)?.name ?? "领域已不可用").join(" · ")
                : "未关联领域"}</p> : null}</div>
            <div className="metric-actions">
              {!definition.archived ? <button className="button-secondary" type="button" disabled={locked}
                onClick={() => begin({ kind: "record", definition })}>
                <Plus size={16} aria-hidden="true" />记录
              </button> : null}
              <button className="icon-button" type="button" disabled={locked}
                title={definition.archived ? "恢复指标" : "归档指标"}
                aria-label={`${definition.archived ? "恢复" : "归档"}${definition.name}`}
                onClick={() => void archive(definition)}>
                {definition.archived ? <RotateCcw size={17} aria-hidden="true" /> :
                  <Archive size={17} aria-hidden="true" />}
              </button>
            </div>
          </div>
          {recentWindow && trend ? <MetricTrendView
            trend={trend}
            domainId={domainId} start={recentWindow.start} end={recentWindow.end} compact /> : null}
          {records.length ? <details className="metric-records"
            open={records.some((record) => hash === `#metric-record-${encodeURIComponent(record.id)}`) || undefined}>
            <summary>查看记录 ({records.length})</summary>
            <ul>{records.map((record) => <li key={record.id} id={`metric-record-${record.id}`}
              className={hash === `#metric-record-${encodeURIComponent(record.id)}` ? "metric-source" : undefined}>
              <time dateTime={record.recordedOn}>{record.recordedOn}</time>
              <strong>{record.value} {definition.unit}</strong>
              {record.note ? <span>{record.note}</span> : null}
              {!definition.archived ? <button className="icon-button" type="button" disabled={locked}
                title="更正记录" aria-label={`更正${definition.name} ${record.recordedOn}的记录`}
                onClick={() => begin({ kind: "record", definition, record })}>
                <Pencil size={15} aria-hidden="true" />
              </button> : null}
            </li>)}</ul>
          </details> : null}
        </div>;
      })}
    </div> : <p className="context-summary-empty metric-empty">还没有指标，可以从一个自己关心的数值开始。</p>}
  </>);
}

function MetricEditor({ editor, currentDomainId, domains, service, onClose, onSaved }: {
  editor: Editor; currentDomainId: string | null; domains: readonly LifeDomain[];
  service: DomainMetricService;
  onClose(): void; onSaved(): void;
}) {
  const [domainMetricService] = useState(() => service);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [domainIds, setDomainIds] = useState<string[]>(currentDomainId ? [currentDomainId] : []);
  const [preset, setPreset] = useState("");
  const [date, setDate] = useState(editor.kind === "record" ? editor.record?.recordedOn ?? today() : today());
  const [value, setValue] = useState(editor.kind === "record" ? String(editor.record?.value ?? "") : "");
  const [note, setNote] = useState(editor.kind === "record" ? editor.record?.note ?? "" : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(false);
  const savedCallback = useRef(onSaved);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => { savedCallback.current = onSaved; }, [onSaved]);

  function change(update: () => void) {
    if (!savingRef.current && mounted.current) update();
  }

  function close() {
    if (!savingRef.current && mounted.current) onClose();
  }

  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && !savingRef.current && mounted.current) onClose();
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || !mounted.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      if (editor.kind === "definition") {
        await domainMetricService.createDefinition(name, unit, domainIds);
      } else {
        if (!value.trim()) throw new MetricValidationError("请填写指标数值。");
        await domainMetricService.saveRecord(editor.definition.id, date, Number(value), note, editor.record?.id);
      }
      if (mounted.current) savedCallback.current();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof MetricValidationError
        ? reason.message : "保存指标失败，请重试。");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const isDefinition = editor.kind === "definition";
  return <div className="modal-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) close();
  }}>
    <section className="planning-dialog" role="dialog" aria-modal="true" aria-labelledby="metric-dialog-title">
      <header className="dialog-header">
        <div><p className="eyebrow">{currentDomainId ? "领域指标" : "状态指标"}</p><h2 id="metric-dialog-title">
          {isDefinition ? "添加指标" : editor.record ? "更正记录" : `记录${editor.definition.name}`}
        </h2></div>
        <button className="icon-button" type="button" title="关闭" aria-label="关闭"
          disabled={saving} onClick={close}><X size={19} aria-hidden="true" /></button>
      </header>
      <form className="domain-form" onSubmit={(event) => void submit(event)}>
        <fieldset className="record-edit-fields" disabled={saving}>
        {isDefinition ? <>
          <label className="form-field"><span>指标起点</span>
            <select value={preset} onChange={event => {
              const key = event.target.value;
              change(() => {
                setPreset(key);
                const selected = metricPresets.find(item => item.key === key);
                if (selected) { setName(selected.name); setUnit(selected.unit); }
              });
            }}>
              <option value="">自定义</option>
              {metricPresets.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
            </select>
          </label>
          <div className="planning-form-grid">
            <label className="form-field"><span>指标名称</span>
              <input autoFocus required maxLength={60} value={name} onChange={(event) => change(() => setName(event.target.value))}
                placeholder="例如：睡眠时长" /></label>
            <label className="form-field"><span>计量单位</span>
              <input required maxLength={20} value={unit} onChange={(event) => change(() => setUnit(event.target.value))}
                placeholder="例如：小时" /></label>
          </div>
          <fieldset className="form-field"><legend>相关生活领域</legend>
            <div className="issue-domain-options">{domains.map((domain) => <label
              key={domain.id} className="issue-domain-option">
              <input type="checkbox" checked={domainIds.includes(domain.id)} disabled={domain.id === currentDomainId}
                onChange={(event) => {
                  const checked = event.target.checked;
                  change(() => setDomainIds(current => checked
                    ? [...current, domain.id] : current.filter((id) => id !== domain.id)));
                }} />
              <span className={`domain-meta domain-color-${domain.color}`}><i aria-hidden="true" />{domain.name}</span>
            </label>)}</div>
          </fieldset>
        </> : <>
          <div className="planning-form-grid">
            <label className="form-field"><span>记录日期</span>
              <input autoFocus required type="date" value={date}
                onChange={(event) => change(() => setDate(event.target.value))} /></label>
            <label className="form-field"><span>数值 ({editor.definition.unit})</span>
              <input required type="number" step="any" value={value}
                onChange={(event) => change(() => setValue(event.target.value))} /></label>
          </div>
          <label className="form-field"><span>说明（可选）</span>
            <textarea rows={2} maxLength={280} value={note}
              onChange={(event) => change(() => setNote(event.target.value))} /></label>
        </>}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <footer className="dialog-actions">
          <button className="button-secondary" type="button" disabled={saving} onClick={close}>取消</button>
          <button className="button-primary" type="submit" disabled={saving}>
            {saving ? "保存中" : isDefinition ? "创建指标" : editor.record ? "保存更正" : "保存记录"}
          </button>
        </footer>
        </fieldset>
      </form>
    </section>
  </div>;
}

function SatisfactionEditor({ snapshot, onClose, onSaved }: {
  snapshot: SatisfactionEditorSnapshot; onClose(): void; onSaved(metricId: string): void;
}) {
  const [original] = useState(() => snapshot);
  const [metricId, setMetricId] = useState(original.metricId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const mounted = useRef(false);
  const callback = useRef(onSaved);
  useEffect(() => { callback.current = onSaved; }, [onSaved]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  function close() { if (mounted.current && !savingRef.current) onClose(); }
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && mounted.current && !savingRef.current) onClose();
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mounted.current || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await original.service.setSatisfactionMetric(original.domainId, metricId || null);
      if (mounted.current) callback.current(metricId);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof MetricValidationError
        ? reason.message : "保存满意度设置失败，请重试。");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return <div className="modal-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget) close();
  }}>
    <section className="planning-dialog" role="dialog" aria-modal="true" aria-labelledby="satisfaction-dialog-title">
      <header className="dialog-header">
        <h2 id="satisfaction-dialog-title">满意度设置</h2>
        <button className="icon-button" title="关闭" aria-label="关闭" type="button" disabled={saving}
          onClick={close}><X size={19} aria-hidden="true" /></button>
      </header>
      <form className="domain-form" onSubmit={event => void submit(event)}>
        <fieldset className="record-edit-fields" disabled={saving}>
          <label className="form-field"><span>评分指标</span>
            <select autoFocus value={metricId} onChange={event => {
              if (mounted.current && !savingRef.current) setMetricId(event.target.value);
            }}>
              <option value="">不评分</option>
              {original.metricId && !original.definitions.some(item => item.id === original.metricId)
                ? <option value={original.metricId} disabled>原评分指标不可用</option> : null}
              {original.definitions.map(item => <option key={item.id} value={item.id} disabled={item.archived}>
                {item.name} ({item.unit}){item.archived ? " · 已归档" : ""}
              </option>)}
            </select>
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <footer className="dialog-actions">
            <button className="button-secondary" type="button" disabled={saving} onClick={close}>取消</button>
            <button className="button-primary" type="submit" disabled={saving}>{saving ? "保存中" : "保存设置"}</button>
          </footer>
        </fieldset>
      </form>
    </section>
  </div>;
}
