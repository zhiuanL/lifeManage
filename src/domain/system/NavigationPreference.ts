export const pinnableCapabilities = [
  { key: "habits", label: "习惯", path: "/habits", contextual: true },
  { key: "settings", label: "设置", path: "/settings", contextual: false },
  { key: "navigation", label: "人生导航", path: "/navigation", contextual: false },
  { key: "metrics", label: "每日状态与指标", path: "/metrics", contextual: true },
  { key: "people", label: "人物", path: "/people", contextual: true },
  { key: "timeline", label: "重要事件与时间线", path: "/timeline", contextual: true },
  { key: "skills", label: "能力成长", path: "/skills", contextual: true },
  { key: "resources", label: "资源总览", path: "/resources", contextual: true },
  { key: "assessment", label: "系统成效评估", path: "/assessment", contextual: false },
  { key: "data-quality", label: "系统健康与数据质量", path: "/data-quality", contextual: false },
  { key: "search", label: "全局搜索", path: "/search", contextual: false },
  { key: "templates", label: "模板中心", path: "/templates", contextual: false },
  { key: "backup", label: "备份与恢复", path: "/backup", contextual: false },
  { key: "inbox", label: "收集箱", path: "/inbox", contextual: false },
  { key: "issues", label: "问题", path: "/issues", contextual: true },
  { key: "decisions", label: "决策", path: "/decisions", contextual: true },
  { key: "analytics", label: "分析", path: "/analytics", contextual: true },
  { key: "export", label: "上下文导出", path: "/export", contextual: true },
] as const;

export type PinnedCapabilityKey = typeof pinnableCapabilities[number]["key"];
export interface NavigationPreference { pinnedCapabilities: readonly PinnedCapabilityKey[] }
export type NavigationPreferenceUpdate = (current: NavigationPreference) => NavigationPreference;

export function defaultNavigationPreference(): NavigationPreference {
  return { pinnedCapabilities: [] };
}

export function validateNavigationPreference(value: unknown): NavigationPreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("导航设置格式无效。");
  const keys = (value as Record<string, unknown>).pinnedCapabilities;
  if (!Array.isArray(keys) || keys.length > pinnableCapabilities.length ||
    keys.some(key => !pinnableCapabilities.some(option => option.key === key)) ||
    new Set(keys).size !== keys.length) throw new Error("导航设置包含无效或重复的能力。");
  return { pinnedCapabilities: [...keys] as PinnedCapabilityKey[] };
}

export function togglePinnedCapability(current: NavigationPreference, key: PinnedCapabilityKey): NavigationPreference {
  return validateNavigationPreference({ pinnedCapabilities: current.pinnedCapabilities.includes(key)
    ? current.pinnedCapabilities.filter(item => item !== key) : [...current.pinnedCapabilities, key] });
}

export function movePinnedCapability(current: NavigationPreference, key: PinnedCapabilityKey,
  direction: -1 | 1): NavigationPreference {
  const keys = [...current.pinnedCapabilities];
  const index = keys.indexOf(key);
  const target = index + direction;
  if (index >= 0 && target >= 0 && target < keys.length) {
    [keys[index], keys[target]] = [keys[target], keys[index]];
  }
  return validateNavigationPreference({ pinnedCapabilities: keys });
}
