import { Activity, Boxes, CalendarRange, ChartNoAxesColumn, CircleAlert, ClipboardCheck,
  Compass, DatabaseBackup, FileOutput, GitBranch, GraduationCap, Inbox, LayoutTemplate,
  Repeat2, Search, Settings, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import { pinnableCapabilities, type PinnedCapabilityKey } from "../domain/system/NavigationPreference";
import { reviewTypes, reviewTypeLabels } from "../domain/reviews/ReviewStructure";

export const capabilityIcons: Record<PinnedCapabilityKey, LucideIcon> = {
  habits: Repeat2, settings: Settings, navigation: Compass, metrics: Activity, people: Users,
  timeline: CalendarRange, skills: GraduationCap, resources: Boxes, assessment: ClipboardCheck,
  "data-quality": ShieldCheck, search: Search, templates: LayoutTemplate, backup: DatabaseBackup,
  inbox: Inbox, issues: CircleAlert, decisions: GitBranch, analytics: ChartNoAxesColumn, export: FileOutput,
};

const primaryModules = [
  { path: "/goals", label: "目标与行动", contextual: true },
  { path: "/reviews", label: "复盘", contextual: true },
  { path: "/calendar", label: "日历", contextual: true },
  { path: "/attention", label: "关注中心", contextual: false },
] as const;

export function currentNavigationModule(pathname: string) {
  return [...primaryModules, ...pinnableCapabilities,
    { path: "/roles", label: "身份角色", contextual: false },
    { path: "/history", label: "版本历史", contextual: false },
    { path: "/setup", label: "生活空间初始化", contextual: false },
  ].find(item => pathname === item.path || pathname.startsWith(item.path + "/"));
}

export interface SecondaryNavigationItem { label: string; to: string; active: boolean }

export function secondaryNavigation(pathname: string, search: string): SecondaryNavigationItem[] {
  const current = currentNavigationModule(pathname);
  if (!current) return [];
  const params = new URLSearchParams(search);
  const domain = current.contextual ? params.get("domain") : null;
  const make = (label: string, filters: Record<string, string>, active: boolean,
    includeDomain = true): SecondaryNavigationItem => {
    const next = new URLSearchParams(filters);
    if (domain && includeDomain) next.set("domain", domain);
    const query = next.toString();
    return { label, to: current.path + (query ? "?" + query : ""), active };
  };
  const items: SecondaryNavigationItem[] = [];
  if (current.path === "/goals") {
    const list = pathname === current.path;
    const status = params.get("goalStatus") ?? "ongoing";
    items.push(make("进行中", { goalStatus: "ongoing", actionStatus: "open" },
      list && status === "ongoing" && (params.get("actionStatus") ?? "open") === "open"),
    make("全部记录", { goalStatus: "all", actionStatus: "all" }, list && status === "all" &&
      params.get("actionStatus") === "all"),
    make("已完成", { goalStatus: "completed", actionStatus: "completed" },
      list && status === "completed" && params.get("actionStatus") === "completed"));
  } else if (current.path === "/reviews") {
    const cycle = params.get("cycle") ?? "";
    items.push(make("全部周期", {}, cycle === "" && !params.get("status")));
    for (const key of reviewTypes) {
      items.push(make(reviewTypeLabels[key], { cycle: key }, cycle === key && !params.get("status")));
    }
    items.push(make("草稿", { status: "draft" }, params.get("status") === "draft" && !cycle));
  } else if (current.path === "/calendar") {
    const view = params.get("view") ?? "agenda";
    for (const [key, label] of [["agenda", "议程"], ["week", "周视图"], ["month", "月视图"]] as const) {
      items.push(make(label, { view: key }, view === key));
    }
  } else if (current.path === "/analytics") {
    const compare = params.get("view") === "compare";
    const selected = params.getAll("compareDomain");
    const recordDomain = domain ?? (compare && selected.length === 1 ? selected[0] : null);
    const recordFilters: Record<string, string> = recordDomain ? { domain: recordDomain } : {};
    if (params.has("weeks")) recordFilters.weeks = params.get("weeks")!;
    if (!compare && params.has("goal")) recordFilters.goal = params.get("goal")!;
    items.push(make("记录分析", recordFilters, !compare, false));
    const next = new URLSearchParams({ view: "compare" });
    if (params.has("weeks")) next.set("weeks", params.get("weeks")!);
    if (compare && params.has("goal")) next.set("goal", params.get("goal")!);
    for (const id of [...new Set(compare ? selected : domain ? [domain] : [])]) next.append("compareDomain", id);
    items.push({ label: "多领域对比", to: "/analytics?" + next.toString(), active: compare });
  } else {
    items.push(make(domain ? "当前领域" : "全部记录", {}, pathname === current.path));
  }
  if (domain) {
    items.push(make("全部领域", {}, false, false),
      { label: "返回领域", to: "/domains/" + encodeURIComponent(domain), active: false });
  }
  if (current.path === "/settings") {
    items.push({ label: "身份角色", to: "/roles", active: false },
      { label: "生活空间初始化", to: "/setup", active: false });
  }
  return items;
}
