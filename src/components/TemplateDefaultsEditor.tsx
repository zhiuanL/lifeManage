import { useEffect, useMemo, useRef, useState } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import { reviewTypes, reviewTypeLabels, type ReviewType } from "../domain/reviews/ReviewStructure";
import { TemplateValidationError, type Template } from "../domain/templates/Template";

export function TemplateDefaultsEditor({ category, templates, disabled = false, onPendingChange }: {
  category: "goal" | "review"; templates: readonly Template[];
  disabled?: boolean;
  onPendingChange?(pending: boolean): void;
}) {
  const { templateService } = useLifeOS();
  const [revision, setRevision] = useState(0);
  const source = useMemo(() => ({ category, templateService, revision }), [category, templateService, revision]);
  type ReadState = { kind: "ready"; values: Record<string, string>; unavailable: readonly ReviewType[] } |
    { kind: "loading" } | { kind: "error"; message: string };
  type Attempt = { source: typeof source; cycle: ReviewType; id: string; error: string };
  const [result, setResult] = useState<{ source: typeof source; state: ReadState } | null>(null);
  const state: ReadState = result?.source === source ? result.state : { kind: "loading" };
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const attemptRef = useRef<Attempt | null>(null);
  const currentAttempt = attempt?.source === source ? attempt : null;
  const [busy, setBusy] = useState(false);
  const [savedSource, setSavedSource] = useState<typeof source | null>(null);
  const saving = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const pendingCallback = useRef(onPendingChange);
  const cycles: readonly ReviewType[] = category === "goal" ? ["daily"] : reviewTypes;
  useEffect(() => {
    pendingCallback.current = onPendingChange;
  }, [onPendingChange]);
  useEffect(() => {
    const requests = generation;
    mounted.current = true;
    return () => {
      mounted.current = false;
      requests.current++;
      pendingCallback.current?.(false);
    };
  }, []);
  useEffect(() => {
    const requests = generation;
    const request = ++requests.current;
    const keys = source.category === "goal" ? ["daily"] as const : reviewTypes;
    void Promise.all(keys.map(async cycle => {
      try {
        return { cycle, id: (await source.templateService.getDefaultTemplate(source.category, cycle))?.id ?? "",
          unavailable: false };
      } catch (reason) {
        if (reason instanceof TemplateValidationError) return { cycle, id: "", unavailable: true };
        throw reason;
      }
    }))
      .then(entries => {
        if (mounted.current && request === requests.current) {
          setResult({ source, state: { kind: "ready",
            values: Object.fromEntries(entries.map(entry => [entry.cycle, entry.id])),
            unavailable: entries.filter(entry => entry.unavailable).map(entry => entry.cycle) } });
        }
      })
      .catch(reason => {
        if (mounted.current && request === requests.current) {
          setResult({ source, state: { kind: "error", message: reason instanceof TemplateValidationError
            ? reason.message : "默认模板读取失败，请重试。" } });
        }
      });
    return () => { requests.current++; };
  }, [source]);
  const pending = state.kind !== "ready" || busy || currentAttempt !== null || state.unavailable.length > 0;
  useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);
  async function save(cycle: ReviewType, id: string, retry = false) {
    if (saving.current || disabled || state.kind !== "ready" || !mounted.current ||
      (!retry && attemptRef.current?.source === source)) return;
    const request = generation.current;
    const next: Attempt = { source, cycle, id, error: "" };
    attemptRef.current = next;
    setAttempt(next);
    saving.current = true;
    pendingCallback.current?.(true);
    setBusy(true);
    setSavedSource(null);
    try {
      await source.templateService.setDefaultTemplate(source.category, id || null, cycle);
      if (mounted.current && request === generation.current) {
        setResult({ source, state: { kind: "ready", values: { ...state.values, [cycle]: id },
          unavailable: state.unavailable.filter(item => item !== cycle) } });
        attemptRef.current = null;
        setAttempt(null);
        setSavedSource(source);
      }
    } catch (reason) {
      if (mounted.current && request === generation.current) {
        const failed = { ...next, error: reason instanceof TemplateValidationError
          ? reason.message : "默认模板保存失败，请重试。" };
        attemptRef.current = failed;
        setAttempt(failed);
      }
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function cancelAttempt() {
    if (saving.current || disabled) return;
    attemptRef.current = null;
    setAttempt(null);
  }
  return <section className="template-defaults" aria-label="默认模板" aria-busy={busy}>
    <h3>默认模板</h3>
    {state.kind === "error" ? <><p className="form-error" role="alert">{state.message}</p>
      <button type="button" className="button-secondary" disabled={disabled || busy}
        onClick={() => { if (!disabled && !saving.current) setRevision(value => value + 1); }}>重新读取</button>
    </> : state.kind === "loading" ? <p role="status">正在读取默认模板</p> : <fieldset disabled={disabled || busy || currentAttempt !== null}>
      <legend className="sr-only">默认模板</legend>
      {cycles.map(cycle => <label className="form-field" key={cycle}>
        <span>{category === "goal" ? "新建目标" : reviewTypeLabels[cycle]}</span>
        {state.unavailable.includes(cycle) ? <span className="form-error" role="alert">
          默认模板不可用，请重新选择。</span> : null}
        <select value={currentAttempt?.cycle === cycle ? currentAttempt.id
          : state.unavailable.includes(cycle) ? "__unavailable" : state.values[cycle] ?? ""}
          onChange={event => void save(cycle, event.target.value)}>
          {state.unavailable.includes(cycle) ? <option value="__unavailable" disabled>不可用的默认模板</option> : null}
          <option value="">{category === "goal" ? "空白目标" : "系统推荐模板"}</option>
          {templates.filter(template => template.category === category &&
            (category === "goal" || (template.defaults.reviewType ?? "daily") === cycle))
            .map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
      </label>)}
    </fieldset>}
    {currentAttempt?.error ? <><p className="form-error" role="alert">{currentAttempt.error}</p>
      <div className="dialog-actions">
        <button type="button" className="button-secondary" disabled={disabled || busy}
          onClick={cancelAttempt}>撤销未保存选择</button>
        <button type="button" className="button-primary" disabled={disabled || busy}
          onClick={() => void save(currentAttempt.cycle, currentAttempt.id, true)}>重试保存默认模板</button>
      </div></> : null}
    {busy ? <p role="status">正在保存默认模板</p> : savedSource === source ? <p role="status">已保存</p> : null}
  </section>;
}
