import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, RotateCw } from "lucide-react";
import { Link } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { qualityCategoryLabels, type DataQualityReport, type QualityCategory } from "../domain/system/DataQuality";
import { DataQualityReadError } from "../services/system/DataQualityService";

export function DataQualityPage() {
  const { dataQualityService } = useLifeOS();
  const [attempt, setAttempt] = useState(0);
  const [category, setCategory] = useState<QualityCategory | "all">("all");
  const source = useMemo(() => ({ dataQualityService, attempt }), [dataQualityService, attempt]);
  const [result, setResult] = useState<{
    source: typeof source; report: DataQualityReport | null; error: string;
  } | null>(null);
  const current = result?.source === source ? result : null;
  const report = current?.report ?? null;
  const error = current?.error ?? "";
  const loading = current === null;
  useEffect(() => {
    let active = true;
    void source.dataQualityService.inspect().then(report => {
      if (active) setResult({ source, report, error: "" });
    }).catch((reason: unknown) => {
      if (active) setResult({ source, report: null, error: reason instanceof DataQualityReadError
        ? reason.message : "数据质量检查未完成，请重新检查。" });
    });
    return () => { active = false; };
  }, [source]);
  const findings = report?.findings.filter(item => category === "all" || item.category === category) ?? [];
  return <section className="data-quality-page">
    <header className="planning-heading">
      <div><p className="eyebrow">系统健康</p><h1>数据质量</h1></div>
      <button className="button-secondary" type="button" disabled={loading}
        onClick={() => { if (!loading) setAttempt(value => value + 1); }}>
        <RotateCw size={17} aria-hidden="true" />重新检查
      </button>
    </header>
    <nav className="data-quality-navigation" aria-label="数据维护">
      <Link to="/settings">设置</Link><Link to="/backup">备份与恢复</Link>
    </nav>
    {loading ? <p role="status">正在检查已保存的关联与记录…</p> : error
      ? <p className="form-error" role="alert">{error}</p> : report ? <>
        <p className="data-quality-time">检查时间：<time dateTime={report.checkedAt}>
          {new Date(report.checkedAt).toLocaleString("zh-CN")}</time></p>
        <dl className="data-quality-counts" aria-label="本次已读取记录">
          {report.counts.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.count}</dd></div>)}
        </dl>
        <label className="data-quality-filter">检查类别
          <select value={category} onChange={event => setCategory(event.target.value as QualityCategory | "all")}>
            <option value="all">全部</option>
            {(Object.keys(qualityCategoryLabels) as QualityCategory[]).map(key =>
              <option key={key} value={key}>{qualityCategoryLabels[key]}</option>)}
          </select>
        </label>
        <p role="status">{report.findings.length === 0 ? "本次检查范围内未发现异常。"
          : `本次发现 ${report.findings.length} 条待检查记录。`}</p>
        {findings.length ? <ul className="data-quality-findings">{findings.map(item =>
          <li key={item.key}>
            <div><p className="data-quality-kind">{qualityCategoryLabels[item.category]} · {item.sourceType}</p>
              <h2>{item.sourceTitle || "未命名记录"}</h2><p>{item.message}</p></div>
            {item.sourcePath ? <Link to={item.sourcePath}>查看原记录
              <ArrowUpRight size={16} aria-hidden="true" /></Link> : <span>暂无可用的原记录入口</span>}
          </li>)}</ul> : report.findings.length > 0 ? <p>当前类别没有待检查记录。</p> : null}
      </> : null}
  </section>;
}
