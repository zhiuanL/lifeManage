import { Download, RotateCcw, Upload } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import { reloadApplication } from "../app/reloadApplication";
import { backupTableLabels, landscapeContextBackupTables, type BackupReport } from "../domain/backup/Backup";
import { BackupValidationError } from "../domain/backup/BackupValidationError";
import type { BackupService } from "../services/backup/BackupService";

function errorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof BackupValidationError) return reason.message;
  return fallback;
}

type BackupSession = { service: BackupService; environment: string };
type Selection = { source: BackupSession; generation: number; fileName: string } & (
  { kind: "reading" } | { kind: "ready"; report: BackupReport } | { kind: "error"; message: string });

export function BackupPage() {
  const { backupService, environment } = useLifeOS();
  const session = useMemo(() => ({ service: backupService, environment }), [backupService, environment]);
  const [file, setFile] = useState<Selection | null>(null);
  const [confirmed, setConfirmed] = useState<Selection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ source: BackupSession; message: string } | null>(null);
  const [restored, setRestored] = useState(false);
  const selection = useRef(0);
  const operation = useRef(false);
  const mounted = useRef(false);
  const source = useRef(session);
  useLayoutEffect(() => { source.current = session; }, [session]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [feedback, setFeedback] = useState(() => {
    try {
      return { message: sessionStorage.getItem("lifeos-last-safety-snapshot") ?? "", restore: true, source: session };
    } catch {
      return { message: "", restore: false, source: session };
    }
  });
  const currentFile = file?.source === session && environment === "desktop" ? file : null;
  const report = currentFile?.kind === "ready" ? currentFile.report : null;
  const locked = busy || restored;
  const isCurrent = () => mounted.current &&
    source.current === session && session.environment === "desktop";

  async function create() {
    if (operation.current || restored || !isCurrent()) return;
    operation.current = true;
    setError(null); setBusy(true);
    try {
      const backup = await backupService.create();
      if (!isCurrent()) return;
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      try {
        anchor.href = url;
        anchor.download = `lifeos-backup-${backup.exportedAt.slice(0, 10)}.json`;
        document.body.append(anchor); anchor.click();
      } finally {
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setFeedback({ message: "完整备份已下载，请妥善保管，其中包含所有隐私等级的记录。",
        restore: false, source: session });
    } catch (reason) {
      if (isCurrent()) setError({ source: session,
        message: errorMessage(reason, "无法创建备份，请检查本地数据状态后重试。") });
    } finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    if (operation.current || restored || !isCurrent()) return;
    const request = ++selection.current;
    setFile(null); setConfirmed(null); setError(null);
    const selected = event.target.files?.[0];
    // Permit explicitly choosing the same file again after a failed check.
    event.target.value = "";
    if (!selected) return;
    const original = { source: session, generation: request, fileName: selected.name };
    setFile({ ...original, kind: "reading" });
    try {
      const text = await selected.text();
      if (!isCurrent() || request !== selection.current) return;
      const next = backupService.inspect(JSON.parse(text) as unknown);
      setFile({ ...original, kind: "ready", report: next });
    } catch (reason) {
      if (isCurrent() && request === selection.current)
        setFile({ ...original, kind: "error",
          message: errorMessage(reason, "无法读取或校验备份文件，请重新选择有效的 LifeOS JSON 备份。") });
    }
  }
  async function restore() {
    if (!report || confirmed !== currentFile || operation.current || restored || !isCurrent()) return;
    operation.current = true;
    setBusy(true); setError(null);
    let path: string;
    try {
      path = await backupService.restore(report);
    } catch (reason) {
      if (isCurrent()) {
        setConfirmed(null);
        setError({ source: session,
          message: errorMessage(reason, "恢复未完成，请检查备份文件与本地数据状态后重新确认。") });
      }
      operation.current = false;
      if (mounted.current) setBusy(false);
      return;
    }
    const receipt = `恢复完成。恢复前安全快照：${path}`;
    try {
      sessionStorage.setItem("lifeos-last-safety-snapshot", receipt);
    } catch {
      // The database is already committed; losing UI feedback must not report a failed restore.
    }
    if (!isCurrent()) {
      operation.current = false;
      if (mounted.current) setBusy(false);
      return;
    }
    setRestored(true); setConfirmed(null); setFeedback({ message: receipt, restore: true, source: session }); setBusy(false);
    // A committed restore must never become a retryable restore after reload fails.
    try { reloadApplication(); }
    catch { setFeedback({ message: `${receipt}。请重新载入生活空间以读取恢复后的数据。`,
      restore: true, source: session }); }
  }
  return <section className="search-page backup-page" aria-busy={busy}>
    <header className="planning-heading"><div>
      <p className="eyebrow">本地数据</p><h1>备份与恢复</h1>
    </div></header>
    {environment !== "desktop" ? <p className="planning-empty">
      浏览器预览数据仅保存在内存中。请在桌面版创建备份或恢复。</p> :
      <>
        <section className="backup-section"><h2>创建完整备份</h2>
          <p>包含当前数据库的全部记录、关联、历史与隐私等级。备份文件未加密，请存放在安全位置。</p>
          <button type="button" className="button-primary" disabled={locked} onClick={() => void create()}>
            <Download size={17} aria-hidden="true" />{busy ? "正在处理" : "下载 JSON 备份"}</button>
        </section>
        <section className="backup-section"><h2>从备份恢复</h2>
          <p>恢复将替换当前数据。操作前会在本机自动保存恢复前的完整安全快照。</p>
          <label className="form-field"><span>选择 LifeOS 备份文件</span>
            <input type="file" accept=".json,application/json" disabled={locked}
              onChange={(event) => void choose(event)} /></label>
          {currentFile?.kind === "reading" ? <p role="status">正在检查备份文件：{currentFile.fileName}</p> : null}
          {currentFile?.kind === "error" ? <p className="form-error" role="alert">{currentFile.message}</p> : null}
          {report ? <div className="backup-report">
            <h3>文件结构检查完成：{currentFile?.fileName}</h3>
            <p>导出时间：{report.backup.exportedAt} · 共 {report.total} 条记录</p>
            <p>恢复时还会检查数据库字段、约束和关联；如检查失败，当前数据会回滚。</p>
            <dl>{landscapeContextBackupTables.filter((table) => report.counts[table] > 0).map((table) =>
              <div key={table}><dt>{backupTableLabels[table]}</dt><dd>{report.counts[table]}</dd></div>)}</dl>
            <label className="export-confirm"><input type="checkbox" checked={confirmed === currentFile} disabled={locked}
              onChange={(event) => {
                if (!operation.current && !restored) setConfirmed(event.target.checked ? currentFile : null);
              }} />
              我确认用此备份替换当前数据，并保留自动生成的安全快照
            </label>
            <button type="button" className="button-secondary" disabled={locked || confirmed !== currentFile}
              onClick={() => void restore()}><RotateCcw size={17} aria-hidden="true" />
              {busy ? "正在恢复" : "确认恢复"}</button>
          </div> : null}
        </section>
      </>}
    {error?.source === session && environment === "desktop"
      ? <p className="form-error" role="alert">{error.message}</p> : null}
    {feedback.message && (feedback.restore || feedback.source === session)
      ? <p role="status"><Upload size={16} aria-hidden="true" /> {feedback.message}</p> : null}
    {restored || (feedback.restore && feedback.message) ? <button type="button" className="button-secondary" onClick={() => {
      try { reloadApplication(); }
      catch { setFeedback(value => ({ ...value,
        message: `${value.message}。请关闭并重新打开 LifeOS 以读取恢复后的数据。` })); }
    }}><RotateCcw size={16} aria-hidden="true" />重新载入生活空间</button> : null}
  </section>;
}
