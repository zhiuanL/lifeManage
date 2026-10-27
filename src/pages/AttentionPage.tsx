import { ArrowUpRight, RotateCw } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import type { AttentionRuleKind, AttentionSettings, AttentionSignal } from "../domain/attention/Attention";
import type { LifeDomain } from "../domain/life/LifeDomain";

type PageState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; domains: readonly LifeDomain[];
      settings: AttentionSettings; signals: readonly AttentionSignal[] };

const factLabels: Record<AttentionRuleKind, string> = {
  "recurring-issue": "反复记录的问题",
  "goal-date": "目标设定日期",
  "repeated-plan": "行动改期记录",
  "repeated-reason": "当前行动反馈",
  "metric-drop": "指标数值变化",
  "idle-actions": "关联行动",
  "habit-drop": "有记录完整周的习惯事实",
  "resource-gap": "当前待补齐与最后更新记录",
  "review-draft": "已保存复盘的周期与当前草稿状态",
  "review-due": "用户启用的周期复盘节点",
  "recent-event": "已记录事件的发生日期",
};

export function AttentionPage() {
  const { attentionService, lifeDomainService } = useLifeOS();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const source = useMemo(() => ({ attentionService, lifeDomainService }),
    [attentionService, lifeDomainService]);
  const latestSource = useRef(source);
  useLayoutEffect(() => { latestSource.current = source; }, [source]);
  const [revision, setRevision] = useState(0);
  const request = useMemo(() => ({ source, revision }), [source, revision]);
  const [result, setResult] = useState<{ request: typeof request; state: PageState } | null>(null);
  const state: PageState = result?.request === request ? result.state : { kind: "loading" };
  type SettingsDraft = { source: typeof source; settings: AttentionSettings; error: string };
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [savedSource, setSavedSource] = useState<typeof source | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([request.source.lifeDomainService.list(), request.source.attentionService.getSnapshot()])
      .then(([domains, snapshot]) => {
        if (active) setResult({ request, state: { kind: "ready", domains, ...snapshot } });
      }).catch(() => { if (active) setResult({ request, state: { kind: "error" } }); });
    return () => { active = false; };
  }, [request]);

  function reload() {
    if (busy.current || draft || state.kind === "loading") return;
    setRevision(value => value + 1);
  }

  async function saveSettings(session: SettingsDraft) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setDraft({ ...session, error: "" });
    try {
      await session.source.attentionService.setSettings(session.settings);
      if (!mounted.current) return;
      setDraft(null);
      // The write is committed. Refresh separately so a read failure never retries the write.
      if (latestSource.current === session.source) {
        setSavedSource(session.source);
        setRevision(value => value + 1);
      }
    } catch {
      if (mounted.current) setDraft({ ...session, error: "提醒设置保存失败，已保留本次选择。请重试或撤销。" });
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  function updateSettings(settings: AttentionSettings) {
    if (busy.current || draft || state.kind !== "ready") return;
    setSavedSource(null);
    void saveSettings({ source, settings, error: "" });
  }

  function updateDomain(value: string) {
    if (busy.current || draft) return;
    const next = new URLSearchParams(location.search);
    if (value) next.set("domain", value); else next.delete("domain");
    navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, { replace: true });
  }

  const draftNotice = draft ? <div aria-busy={saving}>
    {draft.source !== source ? <p role="alert">有另一数据来源的提醒设置尚未保存，请先重试或撤销原选择。</p>
      : draft.error ? <p className="form-error" role="alert">{draft.error}</p> : null}
    {!saving ? <div className="editor-actions">
      <button type="button" className="button-secondary" onClick={() => void saveSettings(draft)}>重试保存提醒设置</button>
      <button type="button" className="button-secondary" onClick={() => { if (!busy.current) setDraft(null); }}>撤销未保存选择</button>
    </div> : null}
  </div> : null;

  if (state.kind === "loading") {
    return <>{draftNotice}<div className="context-loading" aria-live="polite">正在查看注意事项</div></>;
  }
  if (state.kind === "error") {
    return <>{draftNotice}<section className="not-found-page">
      <p className="eyebrow">读取失败</p>
      <h1>暂时无法打开注意事项</h1>
      <p className="page-intro" role="alert">{savedSource === source
        ? "提醒设置已保存，但注意事项读取失败。请重试读取，不要重复保存。"
        : "无法读取注意事项，请重试。已有记录不会被修改。"}</p>
      <button className="button-secondary" type="button" disabled={saving || Boolean(draft)} onClick={reload}>重试</button>
    </section></>;
  }

  const { domains, signals } = state;
  const settings = draft?.source === source ? draft.settings : state.settings;
  const domainId = params.get("domain") ?? "";
  const invalidDomain = params.has("domain") && (!domainId || !domains.some(domain => domain.id === domainId));
  const visible = invalidDomain ? [] : domainId ? signals.filter((signal) => signal.domainIds.includes(domainId)) : signals;
  const locked = saving || Boolean(draft);

  return (
    <>
      <section className="planning-heading attention-heading">
        <div>
          <p className="eyebrow">值得留意的事实</p>
          <h1>注意事项</h1>
        </div>
        <button className="icon-button" type="button" title="重新查看" aria-label="重新查看注意事项"
          disabled={locked} onClick={reload}><RotateCw aria-hidden="true" size={18} /></button>
      </section>
      <Link className="attention-settings-link" to="/settings#settings-attention-title">
        提醒规则设置<ArrowUpRight aria-hidden="true" size={15} />
      </Link>
      <section className="attention-section" aria-label="规则触发的记录">
        <div className="attention-filters">
          <label className="attention-control">
            <span>生活领域</span>
            <select value={domainId} disabled={locked} onChange={(event) => updateDomain(event.target.value)}>
              <option value="">全部领域</option>
              {domainId && invalidDomain ? <option value={domainId} disabled>链接领域不可用</option> : null}
              {domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.name}</option>)}
            </select>
          </label>
          <label className="attention-control">
            <span>行动观察期</span>
            <select value={settings.idleWeeks} disabled={locked}
              onChange={(event) => void updateSettings({
                ...settings, idleWeeks: Number(event.target.value),
              })}>
              {Array.from({ length: 12 }, (_, index) => index + 1).map((weeks) => (
                <option key={weeks} value={weeks}>{weeks} 周</option>
              ))}
            </select>
          </label>
          <label className="attention-control">
            <span>问题出现次数</span>
            <select value={settings.issueOccurrences} disabled={locked}
              onChange={(event) => void updateSettings({
                ...settings, issueOccurrences: Number(event.target.value),
              })}>
              {Array.from({ length: 9 }, (_, index) => index + 2).map((count) => (
                <option key={count} value={count}>{count} 次</option>
              ))}
            </select>
          </label>
          <label className="attention-control">
            <span>28 天内改期次数</span>
            <select value={settings.planAdjustments} disabled={locked}
              onChange={(event) => void updateSettings({
                ...settings, planAdjustments: Number(event.target.value),
              })}>
              {Array.from({ length: 9 }, (_, index) => index + 2).map((count) => (
                <option key={count} value={count}>{count} 次</option>
              ))}
            </select>
          </label>
          <label className="attention-control">
            <span>指标连续下降次数</span>
            <select value={settings.metricDrops} disabled={locked}
              onChange={(event) => void updateSettings({
                ...settings, metricDrops: Number(event.target.value),
              })}>
              {Array.from({ length: 5 }, (_, index) => index + 2).map((count) => (
                <option key={count} value={count}>{count} 次</option>
              ))}
            </select>
          </label>
        </div>
        {draftNotice}
        {invalidDomain ? <div><p role="alert">链接中的领域不可用，请明确清除领域筛选后继续。</p>
          <button type="button" className="button-secondary" disabled={locked}
            onClick={() => updateDomain("")}>清除领域筛选</button></div> :
          visible.length ? <ol className="attention-list">
          {visible.map((signal) => <li className="attention-row" key={signal.id}>
            <p className="eyebrow">{factLabels[signal.kind]}</p>
            <h2>{signal.title}</h2>
            <p className="attention-summary">{signal.summary}</p>
            {signal.action ? <Link className="attention-settings-link" to={signal.action.to}>
              {signal.action.label}<ArrowUpRight aria-hidden="true" size={15} />
            </Link> : null}
            <details className="attention-evidence">
              <summary>查看依据</summary>
              <dl>
                <div><dt>触发规则</dt><dd>{signal.rule}</dd></div>
                <div><dt>基线</dt><dd>{signal.baseline}</dd></div>
                <div><dt>时间范围</dt><dd>{signal.period}</dd></div>
              </dl>
              <p className="eyebrow">来源记录</p>
              <ul>
                {signal.sources.map((source) => <li key={`${source.path}:${source.id}`}>
                  <Link to={`${source.path === "/issues" && domainId
                    ? `/issues?domain=${encodeURIComponent(domainId)}`
                    : signal.kind === "metric-drop" && domainId
                      ? `/domains/${encodeURIComponent(domainId)}` : source.path}#${encodeURIComponent(source.fragment)}`}>
                    {source.title}<ArrowUpRight aria-hidden="true" size={15} />
                  </Link>
                  <time dateTime={source.date}>{source.date.slice(0, 10)}</time>
                </li>)}
              </ul>
            </details>
          </li>)}
        </ol> : <div className="planning-empty">
          <p>{domainId ? "这个领域目前没有符合条件的注意事项。" : "目前没有符合条件的注意事项。"}</p>
        </div>}
      </section>
    </>
  );
}
