export const moduleOptions = [
  { key: "navigation", label: "人生导航", path: "/navigation" },
  { key: "goals", label: "目标与行动", path: "/goals" },
  { key: "reviews", label: "复盘", path: "/reviews" },
  { key: "calendar", label: "日历", path: "/calendar" },
  { key: "attention", label: "关注中心", path: "/attention" },
  { key: "inbox", label: "收集箱", path: "/inbox" },
  { key: "issues", label: "问题", path: "/issues" },
  { key: "decisions", label: "决策", path: "/decisions" },
  { key: "habits", label: "习惯", path: "/habits" },
  { key: "people", label: "人物", path: "/people" },
  { key: "timeline", label: "重要事件与时间线", path: "/timeline" },
  { key: "skills", label: "能力成长", path: "/skills" },
  { key: "resources", label: "资源总览", path: "/resources" },
  { key: "assessment", label: "系统成效评估", path: "/assessment" },
  { key: "analytics", label: "分析", path: "/analytics" },
] as const;
export type ModuleKey = typeof moduleOptions[number]["key"];
export interface ModulePreference { disabledModules: readonly ModuleKey[] }
export function defaultModulePreference(): ModulePreference {
  return { disabledModules: [] };
}
export function validateModulePreference(value: unknown): ModulePreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("模块设置格式无效。");
  const modules = (value as Record<string, unknown>).disabledModules;
  if (!Array.isArray(modules) || modules.length > moduleOptions.length ||
    modules.some(key => !moduleOptions.some(option => option.key === key)) ||
    new Set(modules).size !== modules.length) throw new Error("模块设置包含无效或重复的模块。");
  return { disabledModules: [...modules] as ModuleKey[] };
}
export function isModulePathEnabled(path: string, preference: ModulePreference): boolean {
  const option = moduleOptions.find(item => path === item.path || path.startsWith(item.path + "/"));
  return !option || !preference.disabledModules.includes(option.key);
}
