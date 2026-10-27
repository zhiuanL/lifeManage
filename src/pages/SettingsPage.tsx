import { ArrowUpRight, RotateCcw, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ModuleSettings } from "../components/ModuleSettings";
import { NavigationSettings } from "../components/NavigationSettings";
import { LandscapeSettings } from "../components/LandscapeSettings";
import { SetupDomains } from "../components/SetupDomains";
import { AttentionSettingsEditor } from "../components/AttentionSettingsEditor";
import { useLifeOS } from "../app/LifeOSContext";
import { themeOptions } from "../domain/life/ThemePreference";
import type { LifeDomain } from "../domain/life/LifeDomain";
import { useThemePreferenceCommand } from "../components/useThemePreferenceCommand";

export function SettingsPage() {
  const { theme, lifeDomainService } = useLifeOS();
  const themeCommand = useThemePreferenceCommand();
  const domainSource = useMemo(() => ({ service: lifeDomainService }), [lifeDomainService]);
  const [domainResult, setDomainResult] = useState<{
    source: typeof domainSource; domains: readonly LifeDomain[];
  }>();
  const onDomainsChanged = useCallback((domains: readonly LifeDomain[]) => {
    setDomainResult({ source: domainSource, domains });
  }, [domainSource]);
  const domains = domainResult?.source === domainSource ? domainResult.domains : undefined;
  return <div className="settings-page">
    <section className="planning-heading"><h1>设置</h1></section>
    <section className="settings-section" aria-labelledby="settings-theme-title">
      <h2 id="settings-theme-title">界面主题</h2>
      <div className="settings-themes" role="group" aria-label="界面主题">
        {themeOptions.map(option => <button type="button" key={option.key}
          className="theme-option" aria-pressed={theme === option.key} disabled={themeCommand.disabled}
          onClick={() => void themeCommand.select(option.key)}>
          <span className={"theme-swatch theme-swatch-" + option.key} aria-hidden="true" />
          <span>{option.label}</span>
        </button>)}
      </div>
      {themeCommand.error ? <>
        <p className="form-error" role="alert">{themeCommand.error}</p>
        <p>待保存：{themeOptions.find(option => option.key === themeCommand.pendingTheme)?.label}</p>
        <button type="button" disabled={themeCommand.busy} onClick={() => void themeCommand.retry()}>
          <RotateCcw size={16} aria-hidden="true" />重试主题
        </button>
        <button type="button" disabled={themeCommand.busy} onClick={themeCommand.cancel}>
          <X size={16} aria-hidden="true" />撤销主题选择
        </button>
      </> : null}
    </section>
    <SetupDomains onDomainsChanged={onDomainsChanged} />
    <LandscapeSettings domainsOverride={domains} />
    <AttentionSettingsEditor domainsOverride={domains} />
    <ModuleSettings />
    <NavigationSettings />
    <section className="settings-section" aria-labelledby="settings-life-title">
      <h2 id="settings-life-title">生活空间</h2>
      <nav aria-label="生活空间设置">
        {([["/", "人生领域与推荐领域"], ["/roles", "身份角色"], ["/navigation", "人生导航"],
          ["/metrics", "每日状态与指标"],
          ["/goals", "目标体系"], ["/templates", "模板中心"],
          ["/attention", "注意事项"], ["/export", "上下文导出配置"],
          ["/setup", "生活空间初始化"], ["/data-quality", "系统健康与数据质量"],
          ["/backup", "备份与恢复"]] as const).map(([to, label]) =>
          <Link className="settings-link" key={to} to={to}><span>{label}</span>
            <ArrowUpRight size={17} aria-hidden="true" /></Link>)}
      </nav>
    </section>
  </div>;
}
