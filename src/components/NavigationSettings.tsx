import { ArrowDown, ArrowUp, PinOff, RotateCcw, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { defaultModulePreference, isModulePathEnabled } from "../domain/system/ModulePreference";
import { defaultNavigationPreference, movePinnedCapability, pinnableCapabilities,
  togglePinnedCapability } from "../domain/system/NavigationPreference";
import { useNavigationPreferenceCommand } from "./useNavigationPreferenceCommand";

export function NavigationSettings() {
  const { navigationPreference = defaultNavigationPreference(),
    modulePreference = defaultModulePreference() } = useLifeOS();
  const { run, disabled, error, saved, busy, retry, cancel } = useNavigationPreferenceCommand();
  return <section className="settings-section" aria-labelledby="settings-navigation-title">
    <h2 id="settings-navigation-title">常用入口</h2>
    <ol className="navigation-settings-list">
      {navigationPreference.pinnedCapabilities.map((key, index) => {
        const option = pinnableCapabilities.find(item => item.key === key)!;
        return <li key={key}>
          <span>{option.label}{!isModulePathEnabled(option.path, modulePreference)
            ? <span className="muted-text">（已停用）</span> : null}</span>
          <div className="navigation-settings-commands">
            <button type="button" className="icon-button" title={"上移" + option.label}
              aria-label={"上移" + option.label} disabled={disabled || index === 0}
              onClick={() => void run(current => movePinnedCapability(current, key, -1))}>
              <ArrowUp size={16} aria-hidden="true" /></button>
            <button type="button" className="icon-button" title={"下移" + option.label}
              aria-label={"下移" + option.label}
              disabled={disabled || index === navigationPreference.pinnedCapabilities.length - 1}
              onClick={() => void run(current => movePinnedCapability(current, key, 1))}>
              <ArrowDown size={16} aria-hidden="true" /></button>
            <button type="button" className="icon-button" title={"取消固定" + option.label}
              aria-label={"取消固定" + option.label} disabled={disabled}
              onClick={() => void run(current => ({ pinnedCapabilities:
                current.pinnedCapabilities.filter(item => item !== key) }))}>
              <PinOff size={16} aria-hidden="true" /></button>
          </div>
        </li>;
      })}
    </ol>
    <Link className="settings-link" to="/more">能力目录</Link>
    <fieldset className="module-settings-fields" disabled={disabled}>
      <legend className="sr-only">固定常用入口</legend>
      {pinnableCapabilities.filter(option => isModulePathEnabled(option.path, modulePreference)).map(option =>
        <label key={option.key}><input type="checkbox"
          checked={navigationPreference.pinnedCapabilities.includes(option.key)}
          onChange={() => void run(current => togglePinnedCapability(current, option.key))} />
          {option.label}</label>)}
    </fieldset>
    {error ? <>
      <p className="form-error" role="alert">{error}</p>
      <button type="button" disabled={busy} onClick={() => void retry()}>
        <RotateCcw size={16} aria-hidden="true" />重试导航设置
      </button>
      <button type="button" disabled={busy} onClick={cancel}>
        <X size={16} aria-hidden="true" />撤销导航选择
      </button>
    </> : null}
    {saved ? <p role="status">已保存</p> : null}
  </section>;
}
