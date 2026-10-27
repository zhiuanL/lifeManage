import { Pencil, RotateCcw, Save, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import { emptyLandscapeContext, landscapeContextFields, LandscapeContextValidationError,
  type LandscapeContext, type LandscapeContextInput } from "../domain/life/LandscapeContext";
import type { LandscapeContextService } from "../services/life/LandscapeContextService";

type ReadState = { source: LandscapeContextService; generation: number } &
  ({ kind: "ready"; context: LandscapeContext | null } | { kind: "error" });
type EditSession = { source: LandscapeContextService; draft: LandscapeContextInput };

export function LandscapeContextSection() {
  const { landscapeContextService: source } = useLifeOS();
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<ReadState | null>(null);
  const [session, setSession] = useState<EditSession | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const saveLock = useRef(false);
  const mounted = useRef(false);
  const currentRead = useRef({ source, generation });
  useLayoutEffect(() => { currentRead.current = { source, generation }; }, [source, generation]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let current = true;
    void source.get()
      .then(context => { if (current) setState({ source, generation, kind: "ready", context }); })
      .catch(() => { if (current) setState({ source, generation, kind: "error" }); });
    return () => { current = false; };
  }, [source, generation]);
  const read = state?.source === source && state.generation === generation ? state : null;
  const context = read?.kind === "ready" ? read.context : null;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!session || saveLock.current) return;
    const original = session;
    const request = currentRead.current;
    saveLock.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await original.source.save(original.draft);
      if (!mounted.current) return;
      if (currentRead.current.source === original.source &&
        currentRead.current.generation === request.generation) {
        setState({ source: original.source, generation: request.generation, kind: "ready", context: saved });
      }
      setSession(null);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof LandscapeContextValidationError
        ? cause.message : "生活状态保存失败，输入已保留，请重试。");
    } finally {
      saveLock.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return <section className="landscape-context" aria-label="此刻的生活状态">
    <div className="landscape-context-heading">
      <h2>此刻的生活</h2>
      {!session ? <button type="button" className="icon-button" title="编辑生活状态"
        aria-label="编辑生活状态" disabled={read?.kind !== "ready"}
        onClick={() => { setError(""); setSession({ source, draft: context ?? emptyLandscapeContext() }); }}>
        <Pencil size={16} aria-hidden="true" />
      </button> : null}
    </div>
    {!read ? <p className="landscape-note" role="status">正在读取生活状态…</p> :
      read.kind === "error" ? <div role="alert" className="inline-error">
        <p>生活状态读取失败，其他记录不受影响。</p>
        <button className="button-secondary" type="button" disabled={saving}
          onClick={() => { if (!saveLock.current) setGeneration(value => value + 1); }}>
          <RotateCcw size={15} aria-hidden="true" />重新读取
        </button>
      </div> : null}
    {session ? <form onSubmit={save} aria-label="编辑生活状态" aria-busy={saving}>
      <fieldset disabled={saving} className="landscape-context-fields">
        {landscapeContextFields.map(({ key, label, limit }) => <label key={key}>
          <span>{label}</span>
          {key === "currentStage" ? <input value={session.draft[key]} maxLength={limit}
            onChange={event => { const value = event.target.value;
              setSession(previous => previous ? { ...previous, draft: { ...previous.draft, [key]: value } } : null); }} /> :
            <textarea rows={key === "currentFocus" ? 2 : 3} value={session.draft[key]} maxLength={limit}
              onChange={event => { const value = event.target.value;
                setSession(previous => previous ? { ...previous, draft: { ...previous.draft, [key]: value } } : null); }} />}
        </label>)}
      </fieldset>
      {error ? <p role="alert" className="inline-error">{error}</p> : null}
      <div className="landscape-context-actions">
        <button type="submit" className="button-primary" disabled={saving}>
          <Save size={15} aria-hidden="true" />{saving ? "正在保存…" : "保存"}
        </button>
        <button type="button" className="button-secondary" disabled={saving}
          onClick={() => { if (!saveLock.current) { setSession(null); setError(""); } }}>
          <X size={15} aria-hidden="true" />取消
        </button>
      </div>
    </form> : read?.kind === "ready" ? <dl className="landscape-context-values">
      {landscapeContextFields.map(({ key, label }) => <div key={key}>
        <dt>{label}</dt><dd className={context?.[key] ? "" : "landscape-note"}>{context?.[key] || "未填写"}</dd>
      </div>)}
    </dl> : null}
  </section>;
}
