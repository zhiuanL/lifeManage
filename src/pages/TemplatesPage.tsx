import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Save, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { ProgressItemsEditor } from "../components/ProgressItemsEditor";
import { ReviewTemplateEditor } from "../components/ReviewTemplateEditor";
import { TemplateDefaultsEditor } from "../components/TemplateDefaultsEditor";
import { DomainAppearanceEditor } from "../components/DomainAppearanceEditor";
import { domainColorKeys, domainIconKeys } from "../domain/life/LifeDomain";
import { domainTemplateLimits } from "../domain/life/DomainTemplate";
import { issueTemplateLimits } from "../domain/issues/IssueTemplate";
import { reviewTypes, reviewTypeLabels, type ReviewType, type ReviewField } from "../domain/reviews/ReviewStructure";
import { GoalProgressModeEditor } from "../components/GoalProgressModeEditor";
import { normalizeGoalProgressMode } from "../domain/progress/GoalProgressMode";
import type { GoalProgressItemDraft } from "../domain/progress/GoalProgressItem";
import { fieldPresets, scenarioPresets, type ExportScenario, type ExportType, typeLabels } from "../domain/export/ContextExport";
import { builtInTemplates, cloneTemplateDefaults, normalizeTemplateProgressAlgorithm, reviewTemplateDefaults, templateCategories, templateFields, templateLabels, TemplateValidationError,
  type Template, type TemplateCategory } from "../domain/templates/Template";
import { TemplateSavedReadError } from "../services/templates/TemplateService";

type Draft = { id?: string; category: TemplateCategory; name: string;
  defaults: Template["defaults"] };
function draftOf(template: Template): Draft {
  return { id: template.builtIn ? undefined : template.id, category: template.category,
    name: template.builtIn ? `${template.name}（副本）` : template.name,
    defaults: cloneTemplateDefaults(template.defaults) };
}
function emptyDraft(category: TemplateCategory): Draft {
  return { category, name: "", defaults: category === "export" ?
    cloneTemplateDefaults(builtInTemplates.find((template) =>
      template.id === "default-export-goal-analysis")!.defaults) : category === "review" ? reviewTemplateDefaults("daily") : {} };
}
const destinations: Record<TemplateCategory, string> = {
  goal: "/goals", review: "/reviews", issue: "/issues", decision: "/decisions",
  domain: "/settings", habit: "/habits", export: "/export",
};
type ListState = { kind: "loading" } | { kind: "error" } |
  { kind: "ready"; templates: readonly Template[] };

export function TemplatesPage({ initialCategory = "goal", embedded = false, onPendingChange }: {
  initialCategory?: TemplateCategory; embedded?: boolean; onPendingChange?(pending: boolean): void;
} = {}) {
  const { templateService } = useLifeOS();
  const [params] = useSearchParams();
  const [category, setCategory] = useState<TemplateCategory>(() =>
    !embedded && templateCategories.includes(params.get("category") as TemplateCategory)
      ? params.get("category") as TemplateCategory : initialCategory);
  const [editor, setEditor] = useState<{ draft: Draft; service: typeof templateService } | null>(null);
  const editorRef = useRef<typeof editor>(null);
  const draft = editor?.draft ?? null;
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const [error, setError] = useState("");
  const [defaultsPending, setDefaultsPending] = useState(false);
  const defaultsPendingRef = useRef(false);
  const reportDefaultsPending = useCallback((value: boolean) => {
    defaultsPendingRef.current = value;
    setDefaultsPending(value);
  }, []);
  const read = useCallback(async (): Promise<ListState> => {
    try { return { kind: "ready", templates: await templateService.list() }; }
    catch { return { kind: "error" }; }
  }, [templateService]);
  const [result, setResult] = useState<{ source: typeof read; state: ListState } | null>(null);
  const state = useMemo<ListState>(() =>
    result?.source === read ? result.state : { kind: "loading" }, [result, read]);
  const templates = state.kind === "ready" ? state.templates : null;
  useEffect(() => {
    const requests = generation;
    mounted.current = true;
    return () => { mounted.current = false; requests.current++; };
  }, []);
  useEffect(() => {
    const requests = generation;
    const request = ++requests.current;
    void read().then(next => {
      if (mounted.current && request === requests.current) setResult({ source: read, state: next });
    });
    return () => { requests.current++; };
  }, [read]);
  const load = useCallback(() => {
    if (!mounted.current) return;
    const request = ++generation.current;
    setResult({ source: read, state: { kind: "loading" } });
    void read().then(next => {
      if (mounted.current && request === generation.current) setResult({ source: read, state: next });
    });
  }, [read]);
  const latestLoad = useRef(load);
  useEffect(() => { latestLoad.current = load; }, [load]);
  function closeEditor(force = false) {
    if (saving.current && !force) return;
    editorRef.current = null;
    setEditor(null);
    setError("");
  }
  function setDraft(value: SetStateAction<Draft | null>) {
    if (saving.current || !mounted.current) return;
    const current = editorRef.current;
    if (!current && (defaultsPendingRef.current || state.kind !== "ready")) return;
    const nextDraft = typeof value === "function" ? value(current?.draft ?? null) : value;
    const next = nextDraft ? { draft: nextDraft, service: current?.service ?? templateService } : null;
    editorRef.current = next;
    setEditor(next);
  }
  function openEditor(value: Draft) {
    if (editorRef.current || saving.current || defaultsPendingRef.current || state.kind !== "ready") return;
    setDraft(value);
    setError("");
  }
  async function save() {
    const session = editorRef.current;
    if (!session || saving.current || !mounted.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const original = session.draft;
      await session.service.save(original.category, original.name, original.defaults, original.id);
      if (mounted.current) {
        closeEditor(true);
        latestLoad.current();
      }
    } catch (reason) {
      if (mounted.current) {
        if (reason instanceof TemplateSavedReadError) {
          closeEditor(true);
          setError(reason.message);
          latestLoad.current();
        } else {
          setError(reason instanceof TemplateValidationError ? reason.message : "保存模板失败，请重试。");
        }
      }
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => { onPendingChange?.(templates === null || draft !== null || busy || defaultsPending); }, [templates, draft, busy, defaultsPending, onPendingChange]);
  const selected = templates?.filter((item) => item.category === category) ?? [];
  function setDefault(key: string, value: Template["defaults"][string]) {
    setDraft((current) => current ? {
      ...current, defaults: { ...current.defaults, [key]: value },
    } : null);
  }
  const reviewFields = draft?.defaults.reviewFields as ReviewField[] | undefined;
  const sections = draft?.defaults.sections as string[] | undefined;
  const scenario = draft?.defaults.scenario as ExportScenario | undefined;
  const orders = draft?.defaults.fields as Record<string, string[]> | undefined;
  const domainAppearance = draft?.category === "domain" ? {
    color: domainColorKeys.find(color => color === draft.defaults.color) ?? "ocean",
    icon: domainIconKeys.find(icon => icon === draft.defaults.icon) ?? "heart",
  } : null;
  function moveField(type: ExportType, index: number, offset: number) {
    if (!orders) return;
    const next = [...(orders[type] ?? [])];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setDefault("fields", { ...orders, [type]: next });
  }
  return <section className="search-page templates-page">
    <header className="planning-heading">
      <div><p className="eyebrow">记录方式</p>{embedded ? <h2>{templateLabels[initialCategory]}模板</h2> : <h1>模板中心</h1>}</div>
      <button className="button-primary" type="button"
        disabled={busy || defaultsPending || Boolean(draft) || state.kind !== "ready"}
        onClick={() => openEditor(emptyDraft(category))}><Plus size={17} aria-hidden="true" />新建模板</button>
    </header>
    <div className="inbox-tabs" role="tablist" aria-label="模板分类">
      {(embedded ? [initialCategory] : templateCategories).map((type) => <button type="button" role="tab" key={type} disabled={busy || defaultsPending || Boolean(draft)}
        aria-selected={category === type} className={category === type ? "inbox-tab selected" : "inbox-tab"}
        onClick={() => {
          if (editorRef.current || saving.current || defaultsPendingRef.current) return;
          setCategory(type); setError("");
        }}>{templateLabels[type]}</button>)}
    </div>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    {templates && (category === "goal" || category === "review") ? <TemplateDefaultsEditor key={category}
      category={category} templates={templates} disabled={Boolean(draft) || busy}
      onPendingChange={reportDefaultsPending} /> : null}
    {draft ? <section className="template-editor" aria-label="编辑模板" aria-busy={busy}>
      <header className="section-heading"><h2>{draft.id ? "编辑模板" : "新建模板"}</h2>
        <button className="icon-button" type="button" title="关闭编辑" aria-label="关闭编辑"
          disabled={busy} onClick={() => closeEditor()}><X size={17} /></button></header>
      <fieldset className="record-edit-fields" disabled={busy}>
      <legend className="sr-only">模板内容</legend>
      <label className="form-field"><span>模板名称</span><input required disabled={busy} maxLength={80}
        value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      {draft.category === "export" && scenario && sections && orders ?
        <>
          <label className="form-field"><span>导出场景</span><select value={scenario}
            onChange={(event) => {
              const key = event.target.value as ExportScenario;
              setDraft({ ...draft, defaults: {
                ...builtInTemplates.find((item) => item.id === `default-export-${key}`)!.defaults,
              } });
            }}>{Object.entries(scenarioPresets).map(([key, preset]) =>
              <option key={key} value={key}>{preset.title}</option>)}</select></label>
          <fieldset className="form-field"><legend>导出分段与顺序</legend>
            {[...sections, ...scenarioPresets[scenario].sections.filter((type) =>
              !sections.includes(type))].map((type) => {
              const index = sections.indexOf(type);
              return <div className="template-section" key={type}>
                <label><input type="checkbox" checked={index !== -1} onChange={(event) =>
                  setDefault("sections", event.target.checked ? [...sections, type] :
                    sections.filter((value) => value !== type))} />{typeLabels[type as ExportType]}</label>
                {index !== -1 ? <>
                  <button className="icon-button" type="button" title="上移"
                    aria-label={`上移${typeLabels[type as ExportType]}`}
                    disabled={index === 0} onClick={() => {
                      const next = [...sections]; [next[index - 1], next[index]] = [next[index], next[index - 1]];
                      setDefault("sections", next);
                    }}><ArrowUp size={15} /></button>
                  <button className="icon-button" type="button" title="下移"
                    aria-label={`下移${typeLabels[type as ExportType]}`}
                    disabled={index === sections.length - 1} onClick={() => {
                      const next = [...sections]; [next[index + 1], next[index]] = [next[index], next[index + 1]];
                      setDefault("sections", next);
                    }}><ArrowDown size={15} /></button>
                  <details className="template-fields"><summary>字段</summary><div className="template-field-options">
                    {[...(orders[type] ?? []), ...fieldPresets[type as ExportType].filter((field) =>
                      !(orders[type] ?? []).includes(field))].map((field) => {
                      const position = (orders[type] ?? []).indexOf(field);
                      return <div className="template-field-row" key={field}><label>
                      <input type="checkbox" checked={position !== -1}
                        onChange={(event) => setDefault("fields", { ...orders,
                          [type]: event.target.checked ? [...(orders[type] ?? []), field] :
                            (orders[type] ?? []).filter((item) => item !== field) })} />{field}
                    </label>{position !== -1 ? <>
                      <button className="icon-button" type="button" title="上移"
                        aria-label={`上移${typeLabels[type as ExportType]}的${field}`}
                        disabled={position === 0}
                        onClick={() => moveField(type as ExportType, position, -1)}>
                        <ArrowUp size={14} /></button>
                      <button className="icon-button" type="button" title="下移"
                        aria-label={`下移${typeLabels[type as ExportType]}的${field}`}
                        disabled={position === (orders[type] ?? []).length - 1}
                        onClick={() => moveField(type as ExportType, position, 1)}>
                        <ArrowDown size={14} /></button>
                    </> : null}</div>;
                    })}</div></details>
                </> : null}
              </div>;
            })}
          </fieldset>
        </> : null}
      {draft.category === "review" && reviewFields ? <>
        <label className="form-field"><span>模板复盘周期</span><select disabled={busy}
          value={String(draft.defaults.reviewType)} onChange={event => setDefault("reviewType", event.target.value as ReviewType)}>
          {reviewTypes.map(type => <option key={type} value={type}>{reviewTypeLabels[type]}</option>)}
        </select></label>
        <ReviewTemplateEditor fields={reviewFields} disabled={busy} onChange={fields => setDefault("reviewFields", fields)} />
      </> : null}
      {Object.entries(draft.category === "review" && reviewFields ? {} : templateFields[draft.category]).map(([key, label]) =>
        <label className="form-field" key={key}><span>{label}</span>
          {draft.category === "decision" && key === "importance" ? <select disabled={busy}
            value={typeof draft.defaults.importance === "string" ? draft.defaults.importance : ""}
            onChange={event => {
              if (!event.target.value) {
                const next = { ...draft.defaults }; delete next.importance;
                setDraft({ ...draft, defaults: next });
              } else setDefault("importance", event.target.value);
            }}>
            <option value="">沿用普通记录</option>
            <option value="ordinary">普通记录</option>
            <option value="major">重大决策档案</option>
          </select> : draft.category === "habit" && key === "weeklyTarget" ? <input type="number"
            disabled={busy} min={1} max={7} step={1}
            value={typeof draft.defaults.weeklyTarget === "number" ? draft.defaults.weeklyTarget : ""}
            onChange={event => {
              if (!event.target.value) {
                const next = { ...draft.defaults }; delete next.weeklyTarget;
                setDraft({ ...draft, defaults: next });
              } else setDefault("weeklyTarget", event.target.valueAsNumber);
            }} /> : <textarea disabled={busy} rows={key === "question" ? 3 : 2}
            maxLength={draft.category === "domain"
              ? domainTemplateLimits[key as keyof typeof domainTemplateLimits]
              : draft.category === "habit" && key !== "frequency" ? 500
              : draft.category === "issue" ? issueTemplateLimits[key as keyof typeof issueTemplateLimits]
              : draft.category === "goal" ? 600 : draft.category === "export" ? 1000 : 2000}
            value={String(draft.defaults[key] ?? "")}
            onChange={(event) => setDefault(key, event.target.value)} />}</label>)}
      {domainAppearance ? <DomainAppearanceEditor color={domainAppearance.color} icon={domainAppearance.icon}
        disabled={busy} onColorChange={color => setDefault("color", color)}
        onIconChange={icon => setDefault("icon", icon)} /> : null}
      {draft.category === "goal" ? <GoalProgressModeEditor
        value={normalizeGoalProgressMode(draft.defaults.progressMode)}
        habitEnabled={normalizeTemplateProgressAlgorithm(draft.defaults.progressAlgorithm) === "habit"}
        onHabitEnabledChange={(enabled) => setDefault("progressAlgorithm", enabled ? "habit" : "automatic")}
        onChange={(value) => setDefault("progressMode", value)} disabled={busy} /> : null}
      {draft.category === "goal" ? <details className="goal-initial-progress">
        <summary>初始进度项</summary>
        <ProgressItemsEditor
          items={(draft.defaults.progressItems ?? []) as GoalProgressItemDraft[]}
          onChange={(items) => setDefault("progressItems", items)} disabled={busy} />
      </details> : null}
      </fieldset>
      <div className="dialog-actions"><button type="button" className="button-secondary"
        disabled={busy} onClick={() => closeEditor()}>取消</button>
        <button type="button" className="button-primary" disabled={busy || !draft.name.trim()}
          onClick={() => void save()}><Save size={16} />{busy ? "正在保存" : "保存模板"}</button></div>
    </section> : null}
    {state.kind === "loading" ? <p aria-live="polite">正在读取模板</p> : state.kind === "error" ? <>
      <p role="alert" className="form-error">模板读取失败，请重试。</p>
      <button type="button" className="button-secondary" onClick={load}>重试读取模板</button>
    </> :
      <ul className="template-list">{selected.map((item) =>
        <li key={item.id} className="template-row">
          <div><strong>{item.name}</strong><span>{item.builtIn ? "系统模板" : `第 ${item.version} 版`}</span></div>
          <div className="template-actions">
            <Link className="button-secondary"
              aria-disabled={busy || Boolean(draft) || defaultsPending}
              onClick={event => {
                if (saving.current || editorRef.current || defaultsPendingRef.current) event.preventDefault();
              }}
              to={`${destinations[category]}?template=${encodeURIComponent(item.id)}`}>
              使用</Link>
            <button className="icon-button" type="button" title={`复制${item.name}`}
              disabled={busy || Boolean(draft) || defaultsPending} aria-label={`复制${item.name}`}
              onClick={() => openEditor(draftOf({ ...item, builtIn: true }))}>
              <Copy size={16} /></button>
            {!item.builtIn ? <button className="icon-button" type="button" title={`编辑${item.name}`}
              disabled={busy || Boolean(draft) || defaultsPending} aria-label={`编辑${item.name}`}
              onClick={() => openEditor(draftOf(item))}>
              <Pencil size={16} /></button> : null}
          </div>
        </li>)}</ul>}
  </section>;
}
