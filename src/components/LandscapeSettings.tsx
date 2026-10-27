import { ArrowDown, ArrowUp, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import { changeLandscapePosition, defaultLandscapePreference, landscapeSlots, orderLandscapeDomains,
  type LandscapePreference } from "../domain/life/LandscapePreference";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { LandscapePreferenceService } from "../services/system/LandscapePreferenceService";

type Loader = () => Promise<[readonly LifeDomain[], LandscapePreference]>;
type ReadState = { source: Loader; generation: number } & (
  { kind: "ready"; domains: readonly LifeDomain[]; preference: LandscapePreference } | { kind: "error" });
type EditSession = { source: Loader; service: LandscapePreferenceService;
  domains: readonly LifeDomain[]; draft: LandscapePreference };

export function LandscapeSettings({ onPendingChange, domainsOverride }: {
  onPendingChange?(pending: boolean): void;
  domainsOverride?: readonly LifeDomain[];
}) {
  const { lifeDomainService, landscapePreferenceService } = useLifeOS();
  const [state, setState] = useState<ReadState | null>(null);
  const [session, setSession] = useState<EditSession | null>(null);
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Loader | null>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const readVersion = useRef(0);
  const load: Loader = useCallback(() => Promise.all([lifeDomainService.list(), landscapePreferenceService.get()]), [lifeDomainService, landscapePreferenceService]);
  const currentRead = useRef({ source: load, generation });
  useLayoutEffect(() => { currentRead.current = { source: load, generation }; }, [load, generation]);
  useEffect(() => {
    const current = ++readVersion.current;
    let cancelled = false;
    void load().then(([items, preference]) => {
      if (cancelled || current !== readVersion.current || !mounted.current) return;
      setState({ source: load, generation, kind: "ready", domains: items, preference });
    }).catch(() => {
      if (!cancelled && current === readVersion.current && mounted.current) setState({ source: load, generation, kind: "error" });
    });
    return () => { cancelled = true; };
  }, [load, generation]);
  function retry() {
    if (!saving.current) setGeneration(value => value + 1);
  }
  const read = state?.source === load && state.generation === generation ? state : null;
  const domains = session?.domains ?? domainsOverride ?? (read?.kind === "ready" ? read.domains : []);
  const draft = session?.draft ?? (read?.kind === "ready" ? read.preference : defaultLandscapePreference());
  const loaded = Boolean(session || read?.kind === "ready");
  const pending = !read || read.kind !== "ready" || Boolean(session) || busy;
  useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);
  function change(next: LandscapePreference) {
    if (saving.current || !mounted.current || !loaded) return;
    setSession(previous => previous ? { ...previous, draft: next }
      : { source: load, service: landscapePreferenceService, domains: [...domains], draft: next });
    setSaved(null);
    setError("");
  }
  const ordered = orderLandscapeDomains(domains.filter(domain => domain.status === "active"), draft);
  function move(index: number, offset: number) {
    if (saving.current || index + offset < 0 || index + offset >= ordered.length) return;
    const ids = ordered.map(domain => domain.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    change({ ...draft, domainOrder: [...ids, ...draft.domainOrder.filter(id => !ids.includes(id))] });
  }
  async function save() {
    if (saving.current || !mounted.current || !loaded) return;
    const original = session ?? { source: load, service: landscapePreferenceService, domains: [...domains], draft };
    const request = currentRead.current;
    saving.current = true; setBusy(true); setError(""); setSaved(null);
    try {
      await original.service.save(original.draft);
      if (mounted.current) {
        if (currentRead.current.source === original.source &&
          currentRead.current.generation === request.generation) {
          readVersion.current++;
          setState({ source: original.source, generation: request.generation, kind: "ready",
            domains: original.domains, preference: original.draft });
        }
        setSession(null);
        setSaved(() => original.source);
      }
    }
    catch {
      if (mounted.current) {
        setSession(original);
        setError("景观设置保存失败，请重试。");
      }
    }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="settings-section" aria-labelledby="settings-landscape-title">
    <h2 id="settings-landscape-title">人生景观</h2>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {!read ? <p role="status">正在读取景观设置</p> : read.kind === "error" ? <div role="alert">
      <p>景观设置读取失败，请重试。</p>
      <button type="button" className="button-secondary" disabled={busy} onClick={retry}>重新读取</button>
    </div> : null}
    {saved ? <p role="status">{saved === load ? "已保存" : "原景观设置已保存"}</p> : null}
    {loaded ? <>
      <fieldset className="landscape-settings-fields" disabled={busy}>
        <legend className="sr-only">景观显示偏好</legend>
        <div className="landscape-settings-options">
          <label><input type="checkbox" checked={draft.showFocus} onChange={event => change({ ...draft, showFocus: event.target.checked })} />当下关注</label>
          <label><input type="checkbox" checked={draft.showReviews} onChange={event => change({ ...draft, showReviews: event.target.checked })} />最近回顾</label>
        </div>
        <ol className="landscape-settings-domains" aria-label="景观节点顺序">
          {ordered.map((domain, index) => <li key={domain.id}>
            <label><input type="checkbox" checked={!draft.hiddenDomainIds.includes(domain.id)}
              onChange={event => change({ ...draft, hiddenDomainIds: event.target.checked
                ? draft.hiddenDomainIds.filter(id => id !== domain.id) : [...draft.hiddenDomainIds, domain.id] })} />
              <span>{domain.name}</span></label>
            <div className="landscape-settings-controls">
              <select aria-label={`${domain.name}景观位置`}
                value={draft.domainPositions?.find(p => p.domainId === domain.id)
                  ? landscapeSlots.findIndex(slot => draft.domainPositions?.some(p =>
                    p.domainId === domain.id && p.x === slot.x && p.y === slot.y)) : ""}
                onChange={event => {
                  if (saving.current) return;
                  try { change(changeLandscapePosition(domains, draft,
                    domain.id, event.target.value === "" ? null : Number(event.target.value))); }
                  catch { setError("请选择可用的景观位置。"); }
                }}>
                <option value="">自动位置</option>
                {landscapeSlots.map((slot, index) => <option key={slot.label} value={index}>{slot.label}</option>)}
              </select>
              <div className="landscape-settings-move">
              <button type="button" className="icon-button" title={"上移" + domain.name} aria-label={"上移" + domain.name} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
              <button type="button" className="icon-button" title={"下移" + domain.name} aria-label={"下移" + domain.name} disabled={index === ordered.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
              </div>
            </div>
          </li>)}
        </ol>
        {!ordered.length ? <p>暂无启用的领域</p> : null}
        <div className="landscape-settings-actions">
          <button type="button" className="button-primary" onClick={() => void save()}><Save size={16} />保存</button>
          <button type="button" className="button-secondary" onClick={() => change(defaultLandscapePreference())}><RotateCcw size={16} />恢复默认</button>
          {session ? <button type="button" className="button-secondary" onClick={() => {
            if (!saving.current) { setSession(null); setError(""); }
          }}>撤销未保存修改</button> : null}
        </div>
      </fieldset>
    </> : null}
  </section>;
}
