import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { AttentionSettingsEditor } from "../components/AttentionSettingsEditor";
import { LandscapeSettings } from "../components/LandscapeSettings";
import { ModuleSettings } from "../components/ModuleSettings";
import { SetupDomains } from "../components/SetupDomains";
import { setupStepLabels, type SetupProgress } from "../domain/system/SetupProgress";
import { TemplatesPage } from "./TemplatesPage";
import type { SetupProgressService } from "../services/system/SetupProgressService";

type ProgressRead = { service: SetupProgressService | undefined; revision: number };
type ProgressResult = { source: ProgressRead } & (
  { kind: "ready"; progress: SetupProgress } | { kind: "error" });

export function SetupPage() {
  const { setupProgressService } = useLifeOS();
  const navigate = useNavigate();
  const [result, setResult] = useState<ProgressResult | null>(null);
  const [saveError, setSaveError] = useState<ProgressRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingState, setPendingState] = useState<{
    source: ProgressRead; progress: SetupProgress | null; value: boolean;
  } | null>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [revision, setRevision] = useState(0);
  const read = useMemo(() => ({ service: setupProgressService, revision }), [setupProgressService, revision]);
  const latestRead = useRef(read);
  useLayoutEffect(() => { latestRead.current = read; }, [read]);
  const current = result?.source === read ? result : null;
  const progress = current?.kind === "ready" ? current.progress : null;
  const pending = pendingState?.source !== read || pendingState.progress !== progress || pendingState.value;
  const error = current?.kind === "error" ? "初始化进度读取失败，请重试。"
    : saveError === read ? "初始化进度保存失败，请重试。" : "";
  const reportPending = useCallback((value: boolean) => {
    if (mounted.current && latestRead.current === read)
      setPendingState({ source: read, progress, value });
  }, [read, progress]);
  useEffect(() => {
    let current = true;
    if (!read.service) return;
    void read.service.get().then(value => {
      if (current) setResult({ source: read, kind: "ready", progress: value });
    }).catch(() => { if (current) setResult({ source: read, kind: "error" }); });
    return () => { current = false; };
  }, [read]);
  async function move(step: number, completed = false) {
    if (saving.current || !mounted.current || latestRead.current !== read || !read.service || !progress ||
      (!progress.completed && pending)) return;
    saving.current = true; setBusy(true); setSaveError(null);
    try {
      const next = { step, completed };
      await read.service.save(next);
      if (!mounted.current || latestRead.current !== read) return;
      setResult({ source: read, kind: "ready", progress: next });
      if (completed) navigate("/");
    } catch { if (mounted.current && latestRead.current === read) setSaveError(read); }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  if (!setupProgressService) return <section className="settings-page"><h1>生活空间初始化</h1><p role="alert">初始化服务不可用。</p><Link to="/settings">返回设置</Link></section>;
  return <div className="settings-page setup-page" aria-busy={busy}>
    <header className="planning-heading"><h1>生活空间初始化</h1><Link className="settings-link" to="/">返回人生景观</Link></header>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {!progress ? error ? <button type="button" className="button-secondary" disabled={busy} onClick={() => { setRevision(value => value + 1); }}>重新读取</button>
      : <p role="status">正在读取初始化进度</p> : progress.completed ? <section className="settings-section">
      <h2>生活空间已准备好</h2><button type="button" className="button-secondary" disabled={busy} onClick={() => void move(0)}>调整初始化配置</button>
    </section> : <>
      <ol className="setup-steps" aria-label="初始化步骤">{setupStepLabels.map((label, index) => <li key={label} aria-current={progress.step === index ? "step" : undefined}>
        <span className="setup-step-number">{index + 1}</span><span>{label}</span>
      </li>)}</ol>
      <fieldset className="setup-body" key={progress.step} disabled={busy}>
        <legend className="sr-only">{setupStepLabels[progress.step]}</legend>
        {progress.step === 0 ? <SetupDomains onPendingChange={reportPending} /> : null}
        {progress.step === 1 || progress.step === 2 ? <TemplatesPage initialCategory={progress.step === 1 ? "goal" : "review"} embedded onPendingChange={reportPending} /> : null}
        {progress.step === 3 ? <LandscapeSettings onPendingChange={reportPending} /> : null}
        {progress.step === 4 ? <AttentionSettingsEditor onPendingChange={reportPending} /> : null}
        {progress.step === 5 ? <ModuleSettings onPendingChange={reportPending} /> : null}
      </fieldset>
      <footer className="setup-actions">
        <button type="button" className="button-secondary" disabled={busy || pending || progress.step === 0} onClick={() => void move(progress.step - 1)}><ArrowLeft size={16} />上一步</button>
        <Link className="settings-link" to="/">稍后继续</Link>
        <button type="button" className="button-primary" disabled={busy || pending} onClick={() => void move(Math.min(progress.step + 1, setupStepLabels.length - 1), progress.step === setupStepLabels.length - 1)}>
          {progress.step === setupStepLabels.length - 1 ? <><Check size={16} />完成初始化</> : <>下一步<ArrowRight size={16} /></>}
        </button>
      </footer>
    </>}
  </div>;
}
