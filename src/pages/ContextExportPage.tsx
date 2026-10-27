import { ArrowDown, ArrowUp, Check, ClipboardCopy, Download, RotateCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { TemplateRequestNotice } from "../components/TemplateRequestNotice";
import { useExportTemplateRequest } from "../components/useExportTemplateRequest";
import type { ExportDraftDefaults } from "../domain/export/ExportTemplate";
import {
  buildContextDocument, exportTypes, fieldPresets, privacyLabels, privacyLevels, scenarioPresets,
  exportPrivacyTypes, serializeContext, type ExportFilter, type ExportFormat, type ExportRecord,
  type ExportScenario, type ExportType, type PrivacyLevel, type ExportPrivacyRecordType,
  typeLabels,
} from "../domain/export/ContextExport";

type PageState = { kind: "loading" } | { kind: "error"; message: string } |
  { kind: "ready"; records: readonly ExportRecord[] };
const isPrivacyRecord = (record: ExportRecord): record is ExportRecord & {
  type: ExportPrivacyRecordType;
} => exportPrivacyTypes.some((type) => type === record.type);
const scenarios = Object.keys(scenarioPresets) as ExportScenario[];
const formats: readonly { value: ExportFormat; label: string }[] = [
  { value: "markdown", label: "Markdown" },
  { value: "text", label: "纯文本" },
  { value: "json", label: "JSON" },
];

async function readExportRecords(service: ReturnType<typeof useLifeOS>["contextExportService"]): Promise<PageState> {
  try {
    return { kind: "ready", records: await service.loadRecords() };
  } catch {
    return { kind: "error", message: "无法读取本地记录，请重试。" };
  }
}

export function ContextExportPage() {
  const { contextExportService, environment } = useLifeOS();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const source = useMemo(() => ({ contextExportService, attempt }), [contextExportService, attempt]);
  const latestSource = useRef(source);
  useLayoutEffect(() => { latestSource.current = source; }, [source]);
  const [result, setResult] = useState<{ source: typeof source; state: PageState } | null>(null);
  const state = useMemo<PageState>(() => result?.source === source ? result.state : { kind: "loading" },
    [result, source]);
  const [scenario, setScenario] = useState<ExportScenario>("goal-analysis");
  const [sections, setSections] = useState<ExportType[]>([...scenarioPresets["goal-analysis"].sections]);
  const [fieldOrder, setFieldOrder] = useState<Record<ExportType, string[]>>(() =>
    Object.fromEntries(exportTypes.map((type) => [type, [...fieldPresets[type]]])) as
      Record<ExportType, string[]>);
  const [localFilter, setFilter] = useState<Omit<ExportFilter, "domainId">>({
    from: "", to: "", goalId: null,
    types: [...exportTypes], maxPrivacy: "normal",
  });
  const [scope, setScope] = useState({ key: location.key, domainId: params.get("domain") });
  // Template-only links keep the current scope; consumption puts that scope back in the URL.
  const domainId = scope.key === location.key ? scope.domainId
    : params.has("domain") ? params.get("domain") : params.has("template") ? scope.domainId : null;
  if (scope.key !== location.key) setScope({ key: location.key, domainId });
  const filter = useMemo<ExportFilter>(() => ({ ...localFilter, domainId }), [localFilter, domainId]);
  const [question, setQuestion] = useState(scenarioPresets["goal-analysis"].question);
  const [format, setFormat] = useState<ExportFormat>("markdown");
  const previewContext = useMemo(() => ({ source, state, filter, scenario, sections, fieldOrder, question, format }),
    [source, state, filter, scenario, sections, fieldOrder, question, format]);
  const latestPreview = useRef(previewContext);
  useLayoutEffect(() => { latestPreview.current = previewContext; }, [previewContext]);
  const [confirmedPreview, setConfirmedPreview] = useState<{
    context: typeof previewContext; text: string;
  } | null>(null);
  type PrivacyDraft = {
    source: typeof source; record: ExportRecord & { type: ExportPrivacyRecordType };
    level: PrivacyLevel; error: string;
  };
  const [privacyDraft, setPrivacyDraft] = useState<PrivacyDraft | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [draftStarted, setDraftStarted] = useState(false);
  const [feedback, setFeedback] = useState<{ context: typeof previewContext; message: string } | null>(null);
  const mounted = useRef(false);
  const privacySubmitting = useRef(false);
  const exportSubmitting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const applyTemplate = useCallback((defaults: ExportDraftDefaults) => {
    setScenario(defaults.scenario);
    setSections([...defaults.sections]);
    setFieldOrder(Object.fromEntries(exportTypes.map(type =>
      [type, [...defaults.fieldOrder[type]]])) as Record<ExportType, string[]>);
    setQuestion(defaults.question);
    setDraftStarted(true);
    setConfirmedPreview(null);
    setFeedback(null);
  }, []);
  const templateRequest = useExportTemplateRequest(
    state.kind === "ready", Boolean(saving) || exporting || Boolean(privacyDraft), draftStarted, applyTemplate, domainId);
  const locked = templateRequest.pending || Boolean(saving) || exporting || Boolean(privacyDraft);
  function markDraftChanged() {
    setDraftStarted(true);
    setConfirmedPreview(null);
    setFeedback(null);
  }

  useEffect(() => {
    let active = true;
    void readExportRecords(source.contextExportService).then(next => {
      if (active) setResult({ source, state: next });
    });
    return () => { active = false; };
  }, [source]);
  const reload = () => {
    if ((templateRequest.pending && state.kind === "ready") ||
        state.kind === "loading" || privacyDraft || privacySubmitting.current || exportSubmitting.current) return;
    setConfirmedPreview(null);
    setFeedback(null);
    setAttempt(value => value + 1);
  };

  async function savePrivacy(session: PrivacyDraft) {
    if (privacySubmitting.current || exportSubmitting.current) return;
    privacySubmitting.current = true;
    markDraftChanged();
    setPrivacyDraft({ ...session, error: "" });
    setSaving(`${session.record.type}:${session.record.id}`);
    try {
      await session.source.contextExportService.setPrivacy(session.record.type, session.record.id, session.level);
      if (!mounted.current) return;
      setPrivacyDraft(null);
      if (latestSource.current !== session.source) return;
      const next = await readExportRecords(session.source.contextExportService);
      if (mounted.current && latestSource.current === session.source) {
        setResult({ source: session.source, state: next.kind === "error" ? {
          kind: "error", message: "隐私等级已保存，但记录读取失败。请重新读取，不要重复保存。",
        } : next });
      }
    } catch {
      if (mounted.current) setPrivacyDraft({ ...session, error: "隐私等级保存失败，已保留本次选择。请重试或撤销。" });
    } finally {
      privacySubmitting.current = false;
      if (mounted.current) setSaving(null);
    }
  }

  function changePrivacy(record: ExportRecord & { type: ExportPrivacyRecordType }, level: PrivacyLevel) {
    if (locked || latestSource.current !== source || state.kind !== "ready" ||
        privacySubmitting.current || exportSubmitting.current) return;
    void savePrivacy({ source, record, level, error: "" });
  }

  function changeDomain(value: string | null, clearGoal: boolean) {
    if (locked || privacySubmitting.current || exportSubmitting.current) return;
    markDraftChanged();
    if (clearGoal) setFilter(current => ({ ...current, goalId: null }));
    const next = new URLSearchParams(location.search);
    if (value !== null) next.set("domain", value); else next.delete("domain");
    navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, { replace: true });
  }

  function changeScenario(next: ExportScenario) {
    setScenario(next);
    setSections([...scenarioPresets[next].sections]);
    setQuestion(scenarioPresets[next].question);
    setFeedback(null);
  }

  function toggleType(type: ExportType) {
    setFilter((current) => ({
      ...current, types: current.types.includes(type)
        ? current.types.filter((item) => item !== type) : [...current.types, type],
    }));
  }

  function moveSection(index: number, offset: number) {
    const next = [...sections];
    const [item] = next.splice(index, 1);
    next.splice(index + offset, 0, item);
    setSections(next);
  }

  function moveField(type: ExportType, index: number, offset: number) {
    const next = [...fieldOrder[type]];
    const [item] = next.splice(index, 1);
    next.splice(index + offset, 0, item);
    setFieldOrder({ ...fieldOrder, [type]: next });
  }

  const privacyNotice = privacyDraft ? <div className="export-privacy-notice" aria-busy={Boolean(saving)}>
    {privacyDraft.source !== source
      ? <p role="alert">有另一数据来源的隐私选择尚未保存，请先重试或撤销原选择。</p>
      : privacyDraft.error ? <p role="alert">{privacyDraft.error}</p> : null}
    {!saving ? <div className="editor-actions">
      <button type="button" className="button-secondary" onClick={() => void savePrivacy(privacyDraft)}>重试保存隐私等级</button>
      <button type="button" className="button-secondary" onClick={() => {
        if (!privacySubmitting.current) setPrivacyDraft(null);
      }}>撤销未保存选择</button>
    </div> : null}
  </div> : null;

  if (state.kind === "loading") {
    return <>{privacyNotice}<div className="context-loading" aria-live="polite">正在读取本地上下文</div></>;
  }
  if (state.kind === "error") {
    return <>{privacyNotice}<section className="not-found-page">
      <p className="eyebrow">读取失败</p><h1>暂时无法打开上下文导出</h1>
      <p role="alert">{state.message}</p>
      <button className="button-secondary" type="button" disabled={Boolean(saving) || exporting || Boolean(privacyDraft)}
        onClick={reload}>重试</button>
    </section></>;
  }

  const records = state.records;
  const domains = records.filter((record) => record.type === "domain");
  const goals = records.filter((record) => record.type === "goal" &&
    (!filter.domainId || record.domainIds.includes(filter.domainId)));
  const missingDomain = filter.domainId !== null &&
    (!filter.domainId || !domains.some((record) => record.id === filter.domainId));
  const missingGoal = filter.goalId && !goals.some((record) => record.id === filter.goalId);
  let preview = "";
  let error = "";
  let count = 0;
  try {
    const document = buildContextDocument(missingDomain || missingGoal ? [] : records,
      scenario, filter, sections, question, fieldOrder);
    preview = serializeContext(document, format);
    count = document.sections.reduce((sum, section) => sum + section.records.length, 0);
  } catch (reason) {
    error = reason instanceof Error ? reason.message : "无法生成预览。";
  }
  const previewConfirmed = confirmedPreview?.context === previewContext && confirmedPreview.text === preview;
  const canExport = !error && !missingDomain && !missingGoal && count > 0 && !locked &&
    (filter.maxPrivacy === "normal" ||
      previewConfirmed);

  async function copyPreview() {
    if (!canExport || latestPreview.current !== previewContext || exportSubmitting.current || privacySubmitting.current) return;
    exportSubmitting.current = true;
    setExporting(true);
    setFeedback(null);
    try {
      await navigator.clipboard.writeText(preview);
      if (mounted.current && latestPreview.current === previewContext) setFeedback({ context: previewContext, message: "已复制当前预览。" });
    } catch {
      if (mounted.current && latestPreview.current === previewContext) {
        setFeedback({ context: previewContext, message: "复制失败，请检查剪贴板权限，或下载文件。" });
      }
    } finally {
      exportSubmitting.current = false;
      if (mounted.current) setExporting(false);
    }
  }

  function downloadPreview() {
    if (!canExport || latestPreview.current !== previewContext || exportSubmitting.current || privacySubmitting.current) return;
    exportSubmitting.current = true;
    const extension = format === "markdown" ? "md" : format === "text" ? "txt" : "json";
    const mime = format === "json" ? "application/json" : "text/plain";
    let url: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      const blob = new Blob([preview], { type: `${mime};charset=utf-8` });
      url = URL.createObjectURL(blob);
      link = document.createElement("a");
      link.href = url;
      link.download = `lifeos-${scenario}.${extension}`;
      document.body.append(link);
      link.click();
      setFeedback({ context: previewContext, message: "已下载当前预览。" });
    } catch {
      setFeedback({ context: previewContext, message: "下载失败，请重试，或复制当前预览。" });
    } finally {
      link?.remove();
      if (url) {
        const createdUrl = url;
        window.setTimeout(() => URL.revokeObjectURL(createdUrl), 1000);
      }
      exportSubmitting.current = false;
    }
  }

  return (
    <>
      <section className="planning-heading">
        <div><p className="eyebrow">本地 · 手动导出</p><h1>上下文导出</h1></div>
        <button className="icon-button" type="button" title="重新读取"
          aria-label="重新读取导出记录" disabled={locked} onClick={reload}>
          <RotateCw aria-hidden="true" size={18} />
        </button>
      </section>
      {privacyNotice}
      {templateRequest.pending ? templateRequest.templateName ?
        <div className="export-template-request" role="status">
          <p>{templateRequest.templateName}</p>
          <button className="button-primary" type="button" disabled={Boolean(saving) || exporting}
            onClick={templateRequest.applyTemplate}>应用模板</button>
          <button className="button-secondary" type="button"
            onClick={templateRequest.cancelRequest}>取消模板请求</button>
        </div> :
        <div className="export-template-request">
          <TemplateRequestNotice label="导出" category="export" message={templateRequest.templateError}
            onRetry={templateRequest.retryTemplate} onCancel={templateRequest.cancelRequest} />
          {!templateRequest.templateError ? <button type="button" className="button-secondary"
            onClick={templateRequest.cancelRequest}>取消模板请求</button> : null}
        </div> : null}
      <div className="export-layout">
        <fieldset className="export-controls export-control-fields" disabled={locked}
          aria-busy={Boolean(saving) || exporting}
          onChangeCapture={event => {
            if (locked || privacySubmitting.current || exportSubmitting.current) {
              event.stopPropagation();
              return;
            }
            markDraftChanged();
          }}
          onClickCapture={event => {
            if (locked || privacySubmitting.current || exportSubmitting.current) {
              event.stopPropagation();
              return;
            }
            if (event.target instanceof Element && event.target.closest("button")) markDraftChanged();
          }}>
          <section className="export-block">
            <h2>场景与范围</h2>
            <label className="export-field"><span>分析场景</span>
              <select value={scenario} onChange={(event) =>
                changeScenario(event.target.value as ExportScenario)}>
                {scenarios.map((key) => <option key={key} value={key}>
                  {scenarioPresets[key].title}</option>)}
              </select>
            </label>
            <div className="export-field-row">
              <label className="export-field"><span>开始日期</span>
                <input type="date" value={filter.from} onChange={(event) =>
                  setFilter({ ...localFilter, from: event.target.value })} /></label>
              <label className="export-field"><span>结束日期</span>
                <input type="date" value={filter.to} onChange={(event) =>
                  setFilter({ ...localFilter, to: event.target.value })} /></label>
            </div>
            <div className="export-field-row">
              <label className="export-field"><span>生活领域</span>
                <select value={missingDomain ? filter.domainId || "__invalid_domain__" : filter.domainId ?? ""} onChange={(event) =>
                  changeDomain(event.target.value || null, true)}>
                  <option value="">全部领域</option>
                  {missingDomain ? <option value={filter.domainId || "__invalid_domain__"} disabled>
                    所选领域已不可用</option> : null}
                  {domains.map((record) => <option key={record.id} value={record.id}>
                    {record.title}</option>)}
                </select>
              </label>
              <label className="export-field"><span>关联目标</span>
                <select value={filter.goalId ?? ""} onChange={(event) =>
                  setFilter({ ...localFilter, goalId: event.target.value || null })}>
                  <option value="">全部目标</option>
                  {missingGoal ? <option value={filter.goalId!} disabled>
                    所选目标已不可用</option> : null}
                  {goals.map((record) => <option key={record.id} value={record.id}>
                    {record.title}</option>)}
                </select>
              </label>
            </div>
            {missingDomain ? <div><p role="alert">链接中的领域不可用，请明确清除领域筛选后继续。</p>
              <button type="button" className="button-secondary" onClick={() => changeDomain(null, false)}>清除领域筛选</button>
            </div> : null}
            {missingGoal ? <div><p role="alert">所选目标在当前范围不可用，请明确清除目标筛选后继续。</p>
              <button type="button" className="button-secondary" onClick={() => setFilter(current => ({
                ...current, goalId: null,
              }))}>清除目标筛选</button>
            </div> : null}
            <fieldset className="export-fieldset">
              <legend>对象类型</legend>
              <div className="export-checks">
                {exportTypes.map((type) => <label key={type}>
                  <input type="checkbox" checked={filter.types.includes(type)}
                    onChange={() => toggleType(type)} />{typeLabels[type]}
                </label>)}
              </div>
            </fieldset>
            <label className="export-field"><span>允许纳入的最高隐私等级</span>
              <select value={filter.maxPrivacy} onChange={(event) => {
                setConfirmedPreview(null);
                setFilter({ ...localFilter, maxPrivacy: event.target.value as PrivacyLevel });
              }}>
                {privacyLevels.map((level) => <option key={level} value={level}>
                  {privacyLabels[level]}</option>)}
              </select>
            </label>
            {filter.maxPrivacy !== "normal" ? <label className="export-confirm">
              <input type="checkbox" disabled={Boolean(error) || missingDomain || Boolean(missingGoal) || count === 0}
                checked={previewConfirmed}
                onChange={(event) => setConfirmedPreview(event.target.checked
                  ? { context: previewContext, text: preview } : null)} />
              我已查看预览，确认包含{privacyLabels[filter.maxPrivacy]}记录
            </label> : null}
          </section>

          <section className="export-block">
            <h2>模板字段</h2>
            <ol className="export-sections">
              {sections.map((type, index) => <li key={type}>
                <div className="export-section-head">
                  <span>{typeLabels[type]}</span>
                  <button className="icon-button" type="button" title="上移"
                    aria-label={`上移${typeLabels[type]}`} disabled={index === 0}
                    onClick={() => moveSection(index, -1)}>
                    <ArrowUp aria-hidden="true" size={15} /></button>
                  <button className="icon-button" type="button" title="下移"
                    aria-label={`下移${typeLabels[type]}`} disabled={index === sections.length - 1}
                    onClick={() => moveSection(index, 1)}>
                    <ArrowDown aria-hidden="true" size={15} /></button>
                  <button className="icon-button" type="button" title="不包含"
                    aria-label={`移除${typeLabels[type]}`}
                    onClick={() => setSections(sections.filter((item) => item !== type))}>
                    <Check aria-hidden="true" size={15} /></button>
                </div>
                <details className="export-fields">
                  <summary>具体字段</summary>
                  <ol>{fieldOrder[type].map((label, fieldIndex) => <li key={label}>
                    <span>{label}</span>
                    <button className="icon-button" type="button" title="上移"
                      aria-label={`上移${typeLabels[type]}的${label}`}
                      disabled={fieldIndex === 0} onClick={() => moveField(type, fieldIndex, -1)}>
                      <ArrowUp aria-hidden="true" size={14} /></button>
                    <button className="icon-button" type="button" title="下移"
                      aria-label={`下移${typeLabels[type]}的${label}`}
                      disabled={fieldIndex === fieldOrder[type].length - 1}
                      onClick={() => moveField(type, fieldIndex, 1)}>
                      <ArrowDown aria-hidden="true" size={14} /></button>
                    <button className="icon-button" type="button" title="不包含"
                      aria-label={`移除${typeLabels[type]}的${label}`}
                      onClick={() => setFieldOrder({ ...fieldOrder,
                        [type]: fieldOrder[type].filter((item) => item !== label) })}>
                      <Check aria-hidden="true" size={14} /></button>
                  </li>)}</ol>
                  <label className="export-field"><span>加入具体字段</span>
                    <select value="" onChange={(event) => {
                      if (event.target.value) setFieldOrder({ ...fieldOrder,
                        [type]: [...fieldOrder[type], event.target.value] });
                    }}>
                      <option value="">选择字段</option>
                      {fieldPresets[type].filter((label) => !fieldOrder[type].includes(label))
                        .map((label) => <option key={label} value={label}>{label}</option>)}
                    </select>
                  </label>
                </details>
              </li>)}
            </ol>
            <label className="export-field"><span>加入字段</span>
              <select value="" onChange={(event) => {
                if (event.target.value) setSections([...sections, event.target.value as ExportType]);
              }}>
                <option value="">选择字段</option>
                {scenarioPresets[scenario].sections.filter((type) => !sections.includes(type))
                  .map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}
              </select>
            </label>
            <label className="export-field"><span>希望讨论的问题</span>
              <textarea rows={3} value={question} maxLength={1000}
                onChange={(event) => setQuestion(event.target.value)} /></label>
          </section>

          <details className="export-privacy">
            <summary>管理记录的隐私等级（{records.filter(isPrivacyRecord).length}）</summary>
            <p>现有及新建记录默认私密；指标记录继承所属指标的等级。将一条记录设为普通后，才会进入默认导出范围。</p>
            <ul>{records.filter(isPrivacyRecord)
              .map((record) => <li key={`${record.type}:${record.id}`}>
              <div><small>{typeLabels[record.type]} · {record.date}</small>
                <span>{record.title}</span></div>
              <select aria-label={`${typeLabels[record.type]} ${record.title} 的隐私等级`}
                disabled={Boolean(saving)}
                value={privacyDraft?.source === source && privacyDraft.record.type === record.type &&
                  privacyDraft.record.id === record.id ? privacyDraft.level : record.privacy} onChange={(event) =>
                  void changePrivacy(record, event.target.value as PrivacyLevel)}>
                {privacyLevels.map((level) => <option key={level} value={level}>
                  {privacyLabels[level]}</option>)}
              </select>
            </li>)}</ul>
          </details>
        </fieldset>

        <section className="export-output" aria-label="导出预览">
          <div className="export-output-head">
            <div><h2>导出预览</h2><span>{count} 条记录 · {format.toUpperCase()}</span></div>
            <div className="export-format" role="group" aria-label="导出格式">
              {formats.map(({ value, label }) => <button key={value} type="button"
                disabled={locked} aria-pressed={format === value}
                onClick={() => {
                  if (locked || privacySubmitting.current || exportSubmitting.current) return;
                  markDraftChanged(); setFormat(value);
                }}>{label}</button>)}
            </div>
          </div>
          {error ? <p className="export-error" role="alert">{error}</p>
            : <pre className="export-preview">{preview}</pre>}
          <div className="export-output-foot">
            <p>仅复制或下载已预览的内容；系统不会向 AI 发送数据。
              {environment === "browser-preview" ? " 浏览器预览中的记录不会持久保存。" : ""}
            </p>
            <div className="export-actions">
              <button className="button-secondary" type="button" disabled={!canExport}
                onClick={() => void copyPreview()}>
                <ClipboardCopy aria-hidden="true" size={16} />复制</button>
              <button className="button-primary" type="button" disabled={!canExport}
                onClick={downloadPreview}>
                <Download aria-hidden="true" size={16} />下载</button>
            </div>
          </div>
          {feedback?.context === previewContext ? <p className="export-feedback" role="status">{feedback.message}</p> : null}
        </section>
      </div>
    </>
  );
}
