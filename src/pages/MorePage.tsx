import { ArrowUpRight, Pin, PinOff, RotateCcw, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { capabilityIcons } from "../app/NavigationCatalog";
import { useNavigationPreferenceCommand } from "../components/useNavigationPreferenceCommand";
import { defaultModulePreference, isModulePathEnabled } from "../domain/system/ModulePreference";
import { defaultNavigationPreference, pinnableCapabilities, togglePinnedCapability } from "../domain/system/NavigationPreference";

export function MorePage() {
  const { modulePreference = defaultModulePreference(),
    navigationPreference = defaultNavigationPreference() } = useLifeOS();
  const { run, disabled, error, saved, busy, retry, cancel } = useNavigationPreferenceCommand();
  return (
    <section className="more-page">
      <p className="eyebrow">能力目录</p>
      <h1>更多</h1>
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
      <nav aria-label="更多能力">
        {pinnableCapabilities.filter(item => isModulePathEnabled(item.path, modulePreference)).map(option => {
          const Icon = capabilityIcons[option.key];
          const pinned = navigationPreference.pinnedCapabilities.includes(option.key);
          const title = (pinned ? "取消固定" : "固定") + option.label;
          return <div className="more-entry" key={option.key}>
            <Link className="more-link" to={option.path}>
              <Icon aria-hidden="true" size={19} /><span>{option.label}</span>
              <ArrowUpRight aria-hidden="true" size={17} />
            </Link>
            <button type="button" className="icon-button" aria-label={title} title={title}
              aria-pressed={pinned} disabled={disabled}
              onClick={() => void run(current => togglePinnedCapability(current, option.key))}>
              {pinned ? <PinOff size={17} aria-hidden="true" /> : <Pin size={17} aria-hidden="true" />}
            </button>
          </div>;
        })}
      </nav>
    </section>
  );
}
