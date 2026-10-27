import { RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import {
  attentionRuleKinds, attentionRuleLabels, attentionRulePreference,
  defaultAttentionSettings, validateAttentionSettings, type AttentionSettings,
  type AttentionRuleKind, type AttentionRulePreference,
} from "../domain/attention/Attention";
import type { LifeDomain } from "../domain/life/LifeDomain";
import { reviewTypes, reviewTypeLabels } from "../domain/reviews/ReviewStructure";
import { defaultReviewAttentionTypes, type ReviewSchedule } from "../domain/attention/ReviewAttentionFacts";

type Loader = () => Promise<[AttentionSettings, readonly LifeDomain[]]>;
type ReadState = { source: Loader; generation: number } & (
  { kind: "ready"; settings: AttentionSettings; domains: readonly LifeDomain[] } | { kind: "error" });

export function AttentionSettingsEditor({ onPendingChange, domainsOverride }: {
  onPendingChange?(pending: boolean): void;
  domainsOverride?: readonly LifeDomain[];
}) {
  const { attentionService, lifeDomainService } = useLifeOS();
  const [state, setState] = useState<ReadState | null>(null);
  const [generation, setGeneration] = useState(0);
  const [session, setSession] = useState<{
    source: Loader; service: typeof attentionService; draft: AttentionSettings; domains: readonly LifeDomain[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Loader | null>(null);
  const [defaultSchedule] = useState<ReviewSchedule>(() => {
    const now = new Date();
    return { startOn: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
      types: ["weekly", "monthly"], waitDays: 1 };
  });
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const requests = useRef(0);
  const load: Loader = useCallback(() => Promise.all([attentionService.getSettings(), lifeDomainService.list()]),
    [attentionService, lifeDomainService]);
  const currentRead = useRef({ source: load, generation });
  useLayoutEffect(() => { currentRead.current = { source: load, generation }; }, [load, generation]);
  useEffect(() => {
    const request = ++requests.current;
    let cancelled = false;
    void load().then(([settings, domains]) => {
      if (!cancelled && request === requests.current && mounted.current)
        setState({ source: load, generation, kind: "ready", settings, domains });
    }).catch(() => {
      if (!cancelled && request === requests.current && mounted.current)
        setState({ source: load, generation, kind: "error" });
    });
    return () => { cancelled = true; };
  }, [load, generation]);
  const read = state?.source === load && state.generation === generation ? state : null;
  const loaded = Boolean(session || read?.kind === "ready");
  const draft = session?.draft ?? (read?.kind === "ready" ? read.settings : defaultAttentionSettings);
  const scopeDomains = session?.domains ?? domainsOverride ?? (read?.kind === "ready" ? read.domains : []);
  const pending = read?.kind !== "ready" || Boolean(session) || busy;
  useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);
  function retry() {
    if (!saving.current) setGeneration(value => value + 1);
  }
  function change(next: AttentionSettings) {
    if (saving.current || !mounted.current || !loaded) return;
    setSession(previous => previous ? { ...previous, draft: next }
      : { source: load, service: attentionService, draft: next, domains: [...scopeDomains] });
    setSaved(null);
    setError("");
  }
  function updateRule(kind: AttentionRuleKind, update: Partial<AttentionRulePreference>) {
    change({ ...draft,
      ...(kind === "review-due" && update.enabled === true && !draft.reviewSchedule
        ? { reviewSchedule: { ...defaultSchedule, types: [...defaultSchedule.types] } } : {}),
      rules: {
      ...draft.rules, [kind]: { ...attentionRulePreference(draft, kind), ...update },
    } });
  }
  function updateSchedule(update: Partial<ReviewSchedule>) {
    change({ ...draft, reviewSchedule: { ...(draft.reviewSchedule ?? defaultSchedule), ...update } });
  }
  async function save() {
    if (saving.current || !mounted.current || !loaded) return;
    try { validateAttentionSettings(draft); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : "请检查提醒规则。");
      setSaved(null);
      return;
    }
    const original = session ?? { source: load, service: attentionService, draft, domains: [...scopeDomains] };
    const request = currentRead.current;
    saving.current = true; setBusy(true); setError(""); setSaved(null); setSession(original);
    try {
      await original.service.setSettings(original.draft);
      if (mounted.current) {
        if (currentRead.current.source === original.source && currentRead.current.generation === request.generation) {
          requests.current++;
          setState({ source: original.source, generation: request.generation, kind: "ready",
            settings: original.draft, domains: original.domains });
        }
        setSession(null);
        setSaved(() => original.source);
      }
    }
    catch { if (mounted.current) setError("提醒规则保存失败，请重试。"); }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  const fields = [
    ["idleWeeks", "行动观察期（周）", 1, 12], ["issueOccurrences", "问题出现次数", 2, 10],
    ["planAdjustments", "28 天内改期次数", 2, 10], ["metricDrops", "指标连续下降次数", 2, 6],
  ] as const;
  return <section className="settings-section" aria-labelledby="settings-attention-title">
    <h2 id="settings-attention-title">提醒规则</h2>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {!read ? <p role="status">正在读取提醒规则</p> : read.kind === "error" ? <>
      <p role="alert">提醒规则读取失败，请重试。</p>
      <button type="button" className="button-secondary" disabled={busy} onClick={retry}>重新读取</button>
    </> : null}
    {saved ? <p role="status">{saved === load ? "已保存" : "原提醒规则已保存"}</p> : null}
    {session && session.source !== load ? <p role="status">原提醒规则的未保存修改</p> : null}
    {loaded ? <fieldset className="setup-reminder-fields" disabled={busy}>
      <legend className="sr-only">提醒规则</legend>
      <div className="attention-rule-preferences">
        {attentionRuleKinds.map(kind => {
          const rule = attentionRulePreference(draft, kind);
          const selectedDomains = rule.domainIds.map(id => scopeDomains.find(domain => domain.id === id)?.name ?? "不可用领域");
          return <div className="attention-rule-preference" key={kind}>
            <label className="attention-rule-enabled">
              <input type="checkbox" checked={rule.enabled}
                onChange={event => updateRule(kind, { enabled: event.target.checked })} />
              <span>{attentionRuleLabels[kind]}</span>
            </label>
            <details className="attention-rule-scope">
              <summary>领域范围：{rule.scope === "all" ? "全部领域" : selectedDomains.join("、") || "未选择领域"}</summary>
              <fieldset disabled={!rule.enabled}>
                <legend className="sr-only">{attentionRuleLabels[kind]}领域范围</legend>
                <label><input type="radio" name={`attention-scope-${kind}`} checked={rule.scope === "all"}
                  onChange={() => updateRule(kind, { scope: "all" })} />全部领域</label>
                <label><input type="radio" name={`attention-scope-${kind}`} checked={rule.scope === "domains"}
                  onChange={() => updateRule(kind, { scope: "domains" })} />指定领域</label>
              </fieldset>
              {rule.scope === "domains" ? <fieldset disabled={!rule.enabled}>
                <legend className="sr-only">{attentionRuleLabels[kind]}指定领域</legend>
                {scopeDomains.map(domain => <label key={domain.id}>
                  <input type="checkbox" checked={rule.domainIds.includes(domain.id)}
                    onChange={event => updateRule(kind, { domainIds: event.target.checked
                      ? [...rule.domainIds, domain.id] : rule.domainIds.filter(id => id !== domain.id) })} />
                  {domain.name}{domain.status === "archived" ? "（已归档）" : domain.status === "paused" ? "（已暂停）" : ""}
                </label>)}
                {rule.domainIds.filter(id => !scopeDomains.some(domain => domain.id === id)).map(id => <label key={id}>
                  <input type="checkbox" checked
                    onChange={() => updateRule(kind, { domainIds: rule.domainIds.filter(item => item !== id) })} />
                  不可用领域
                </label>)}
              </fieldset>
                : null}
            </details>
          </div>;
        })}
      </div>
      {fields.map(([key, label, min, max]) => <label className="form-field" key={key}><span>{label}</span>
        <input type="number" min={min} max={max} step={1} required value={Number.isNaN(draft[key]) ? "" : draft[key]}
          onChange={event => change({ ...draft, [key]: event.target.value === "" ? NaN : Number(event.target.value) })} />
      </label>)}
      <label className="form-field"><span>相同未完成原因的行动数</span>
        <input type="number" min={2} max={10} step={1} required
          value={Number.isNaN(draft.incompleteReasons) ? "" : draft.incompleteReasons ?? 3}
          onChange={event => {
            change({ ...draft, incompleteReasons: event.target.value === "" ? NaN : Number(event.target.value) });
          }} />
      </label>
      <label className="form-field"><span>习惯完成比例下降（百分点）</span>
        <input type="number" min={1} max={100} step={1} required
          value={Number.isNaN(draft.habitDropPoints) ? "" : draft.habitDropPoints ?? 20}
          onChange={event => {
            change({ ...draft, habitDropPoints: event.target.value === "" ? NaN : Number(event.target.value) });
          }} />
      </label>
      <label className="form-field"><span>资源记录未更新观察期（周）</span>
        <input type="number" min={1} max={52} step={1} required
          value={Number.isNaN(draft.resourceIdleWeeks) ? "" : draft.resourceIdleWeeks ?? 4}
          onChange={event => {
            change({ ...draft, resourceIdleWeeks: event.target.value === "" ? NaN : Number(event.target.value) });
          }} />
      </label>
      <label className="form-field"><span>资源观察对象</span>
        <select value={draft.resourceNodeScope ?? "important"}
          title="只观察进行中目标和待决决策；重要对象为高优先级目标和重大决策。"
          onChange={event => {
            change({ ...draft, resourceNodeScope: event.target.value === "all" ? "all" : "important" });
          }}>
          <option value="important">高优先级目标 / 重大决策</option>
          <option value="all">全部进行中 / 待决对象</option>
        </select>
      </label>
      <label className="form-field"><span>复盘周期结束后等待（天）</span>
        <input type="number" min={1} max={30} step={1} required
          value={Number.isNaN(draft.reviewWaitDays) ? "" : draft.reviewWaitDays ?? 1}
          onChange={event => {
            change({ ...draft, reviewWaitDays: event.target.value === "" ? NaN : Number(event.target.value) });
          }} />
      </label>
      <fieldset className="attention-cycle-options" disabled={!attentionRulePreference(draft, "review-draft").enabled}>
        <legend>草稿提醒周期</legend>
        {reviewTypes.map(type => <label className="attention-rule-enabled" key={type}>
          <input type="checkbox" checked={(draft.reviewDraftTypes ?? defaultReviewAttentionTypes).includes(type)}
            onChange={event => {
              const selected = draft.reviewDraftTypes ?? defaultReviewAttentionTypes;
              change({ ...draft, reviewDraftTypes: event.target.checked
                ? reviewTypes.filter(item => item === type || selected.includes(item))
                : selected.filter(item => item !== type) });
            }} />
          <span>{reviewTypeLabels[type]}</span>
        </label>)}
      </fieldset>
      {attentionRulePreference(draft, "review-due").enabled ? <fieldset className="attention-schedule-fields">
        <legend>周期复盘节点</legend>
        <label className="form-field"><span>周期提醒起始日期</span>
          <input type="date" required value={(draft.reviewSchedule ?? defaultSchedule).startOn}
            onChange={event => updateSchedule({ startOn: event.target.value })} />
        </label>
        <label className="form-field"><span>周期提醒等待（天）</span>
          <input type="number" min={1} max={30} step={1} required
            value={Number.isNaN((draft.reviewSchedule ?? defaultSchedule).waitDays)
              ? "" : (draft.reviewSchedule ?? defaultSchedule).waitDays}
            onChange={event => updateSchedule({ waitDays: event.target.value === "" ? NaN : Number(event.target.value) })} />
        </label>
        <fieldset className="attention-cycle-options">
          <legend>定期提醒周期</legend>
          {reviewTypes.map(type => <label className="attention-rule-enabled" key={type}>
            <input type="checkbox" checked={(draft.reviewSchedule ?? defaultSchedule).types.includes(type)}
              onChange={event => {
                const selected = (draft.reviewSchedule ?? defaultSchedule).types;
                updateSchedule({ types: event.target.checked
                  ? reviewTypes.filter(item => item === type || selected.includes(item))
                  : selected.filter(item => item !== type) });
              }} />
            <span>{reviewTypeLabels[type]}</span>
          </label>)}
        </fieldset>
      </fieldset> : null}
      {attentionRulePreference(draft, "recent-event").enabled ? <label className="form-field">
        <span>近期重要事件观察期（天）</span>
        <input type="number" min={1} max={30} step={1} required
          value={Number.isNaN(draft.recentEventDays) ? "" : draft.recentEventDays ?? 7}
          onChange={event => {
            change({ ...draft, recentEventDays: event.target.value === "" ? NaN : Number(event.target.value) });
          }} />
      </label> : null}
      <div className="landscape-settings-actions">
        <button type="button" className="button-primary" onClick={() => void save()}><Save size={16} />保存规则</button>
        <button type="button" className="button-secondary" onClick={() => change({ ...defaultAttentionSettings })}><RotateCcw size={16} />恢复默认</button>
        {session ? <button type="button" className="button-secondary" onClick={() => {
          if (!saving.current) { setSession(null); setError(""); }
        }}>撤销未保存修改</button> : null}
      </div>
    </fieldset> : null}
  </section>;
}
