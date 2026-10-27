import { RotateCcw, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import { defaultModulePreference, moduleOptions, type ModuleKey, type ModulePreference } from "../domain/system/ModulePreference";
export function ModuleSettings({ onPendingChange }: { onPendingChange?(pending: boolean): void }) {
  const { modulePreference = defaultModulePreference(), setModulePreference } = useLifeOS();
  const [busy, setBusy] = useState(false);
  const source = useMemo(() => ({ save: setModulePreference }), [setModulePreference]);
  const current = useRef(source);
  const [command, setCommand] = useState<{
    source: typeof source; preference: ModulePreference; key: ModuleKey; enabled: boolean; failed: boolean;
  } | null>(null);
  const [savedSource, setSavedSource] = useState<typeof source | null>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => { current.current = source; }, [source]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { onPendingChange?.(busy || Boolean(command) || !setModulePreference); },
    [busy, command, setModulePreference, onPendingChange]);
  async function save(next: NonNullable<typeof command>) {
    if (saving.current || !mounted.current || !next.source.save) return;
    saving.current = true; setBusy(true); setSavedSource(null);
    setCommand({ ...next, failed: false });
    try {
      await next.source.save(next.preference);
      if (mounted.current) {
        setCommand(null);
        if (current.current === next.source) setSavedSource(next.source);
      }
    }
    catch { if (mounted.current) setCommand({ ...next, failed: true }); }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  function toggle(key: ModuleKey, enabled: boolean) {
    if (command && command.source !== source) return;
    const preference = { disabledModules: enabled ? modulePreference.disabledModules.filter(item => item !== key)
      : [...modulePreference.disabledModules, key] };
    void save({ source, preference, key, enabled, failed: false });
  }
  return <section className="settings-section" aria-labelledby="settings-modules-title">
    <h2 id="settings-modules-title">启用模块</h2>
    <fieldset className="module-settings-fields"
      disabled={busy || !setModulePreference || Boolean(command && command.source !== source)}>
      <legend className="sr-only">启用模块</legend>
      {moduleOptions.map(option => <label key={option.key}><input type="checkbox"
        checked={!modulePreference.disabledModules.includes(option.key)}
        onChange={event => toggle(option.key, event.target.checked)} />{option.label}</label>)}
    </fieldset>
    {command?.failed ? <>
      <p className="form-error" role="alert">模块设置保存失败，请重试。</p>
      <p>待保存：{command.enabled ? "启用" : "停用"}{moduleOptions.find(option => option.key === command.key)?.label}</p>
      <button type="button" disabled={busy} onClick={() => void save(command)}>
        <RotateCcw size={16} aria-hidden="true" />重试模块设置
      </button>
      <button type="button" disabled={busy} onClick={() => {
        if (!saving.current) setCommand(null);
      }}><X size={16} aria-hidden="true" />撤销模块选择</button>
    </> : null}
    {savedSource === source ? <p role="status">已保存</p> : null}
  </section>;
}
