import {
  isModulePathEnabled, moduleOptions, type ModulePreference,
} from "../domain/system/ModulePreference";

export interface SearchCommand {
  id: string;
  label: string;
  aliases: readonly string[];
  kind: "navigate" | "create" | "capture";
  to: string;
}

const createCommands: readonly SearchCommand[] = [
  { id: "capture", label: "快速记录", aliases: ["记录", "新建记录", "capture"], kind: "capture", to: "/inbox" },
  { id: "create-goal", label: "新建目标", aliases: ["创建目标", "新增目标", "goal"], kind: "create", to: "/goals?create=goal" },
  { id: "create-action", label: "新建行动", aliases: ["创建行动", "新增行动", "action"], kind: "create", to: "/goals?create=action" },
  { id: "create-review", label: "新建复盘", aliases: ["创建复盘", "新增复盘", "回顾", "review"], kind: "create", to: "/reviews?create=review" },
  { id: "create-issue", label: "新建问题", aliases: ["创建问题", "新增问题", "issue"], kind: "create", to: "/issues?create=issue" },
  { id: "create-decision", label: "新建决策", aliases: ["创建决策", "新增决策", "decision"], kind: "create", to: "/decisions?create=decision" },
  { id: "create-habit", label: "新建习惯", aliases: ["创建习惯", "新增习惯", "habit"], kind: "create", to: "/habits?create=habit" },
];
const navigationCommands: readonly SearchCommand[] = [
  { id: "open-landscape", label: "打开人生景观", aliases: ["首页", "home"], kind: "navigate", to: "/" },
  { id: "open-metrics", label: "打开每日状态与指标", aliases: ["指标", "状态", "metrics"], kind: "navigate", to: "/metrics" },
  ...moduleOptions.map(option => ({
    id: `open-${option.key}`, label: `打开${option.label}`,
    aliases: [option.label, option.key], kind: "navigate" as const, to: option.path,
  })),
  { id: "open-settings", label: "打开设置", aliases: ["settings"], kind: "navigate", to: "/settings" },
  { id: "open-templates", label: "打开模板", aliases: ["templates"], kind: "navigate", to: "/templates" },
  { id: "open-export", label: "打开上下文导出", aliases: ["导出", "export"], kind: "navigate", to: "/export" },
  { id: "open-backup", label: "打开备份与恢复", aliases: ["备份", "恢复", "backup"], kind: "navigate", to: "/backup" },
  { id: "open-roles", label: "打开身份角色", aliases: ["角色", "roles"], kind: "navigate", to: "/roles" },
];

export function findSearchCommands(query: string, preference: ModulePreference): {
  mode: "none" | "mixed" | "commands";
  commands: SearchCommand[];
} {
  const input = query.trim();
  const slash = input.startsWith("/");
  const actionWords = /^(新建|创建|新增|打开|前往|快速记录|记录)/u;
  if (!slash && !actionWords.test(input)) return { mode: "none", commands: [] };
  const text = (slash ? input.slice(1) : input).trim().toLocaleLowerCase();
  const verb = actionWords.exec(text)?.[1];
  const keyword = text.replace(actionWords, "").trim();
  const commands = [...createCommands, ...navigationCommands].filter(command => {
    if (!isModulePathEnabled(command.to.split("?")[0], preference)) return false;
    if (verb === "打开" || verb === "前往") {
      if (command.kind !== "navigate") return false;
    } else if (verb === "记录" || verb === "快速记录") {
      if (command.kind !== "capture") return false;
    } else if (verb) {
      if (command.kind === "navigate") return false;
    }
    const terms = keyword.split(/\s+/u).filter(Boolean);
    const haystack = [command.label, ...command.aliases].join(" ").toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  });
  return { mode: slash ? "commands" : "mixed", commands };
}

const domainPaths = new Set(["/goals", "/reviews", "/calendar", "/attention", "/inbox",
  "/issues", "/decisions", "/habits", "/people", "/timeline", "/skills", "/resources", "/analytics"]);

export function searchCommandTarget(command: SearchCommand, domainId: string): string {
  const [path, query = ""] = command.to.split("?");
  if (!domainId || !domainPaths.has(path)) return command.to;
  const params = new URLSearchParams(query);
  params.set("domain", domainId);
  return `${path}?${params.toString()}`;
}
