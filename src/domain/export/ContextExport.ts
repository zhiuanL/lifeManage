import { isPlainDate } from "../planning/Goal";
import { actionDetailFields } from "../planning/ActionDetails";
import { exportGoalProgressFields, type ExportGoalProgress } from "./GoalExportProgress";

export const privacyTypes = [
  "domain", "goal", "action", "review", "inbox", "issue", "decision", "metric", "navigation", "person", "resource", "skill", "habit", "event",
] as const;
export type PrivacyRecordType = (typeof privacyTypes)[number];
export const exportPrivacyTypes = [...privacyTypes, "role"] as const;
export type ExportPrivacyRecordType = (typeof exportPrivacyTypes)[number];
export const exportTypes = [...exportPrivacyTypes, "plan-change", "metric-record", "habit-log", "progress-item"] as const;
export type ExportType = (typeof exportTypes)[number];
export const privacyLevels = ["normal", "private", "highly_sensitive"] as const;
export type PrivacyLevel = (typeof privacyLevels)[number];
export type ExportScenario =
  | "goal-analysis" | "period-review" | "life-domain"
  | "issue-diagnosis" | "major-decision" | "inbox-triage";
export type ExportFormat = "markdown" | "text" | "json";

export interface ExportFilter {
  from: string;
  to: string;
  domainId: string | null;
  goalId: string | null;
  types: readonly ExportType[];
  maxPrivacy: PrivacyLevel;
}

export interface ExportRecord {
  type: ExportType;
  id: string;
  title: string;
  date: string;
  domainIds: readonly string[];
  goalId: string | null;
  privacy: PrivacyLevel;
  goalProgress?: ExportGoalProgress;
  fields: readonly { label: string; value: string }[];
  links: readonly {
    type: "domain" | "goal" | "navigation" | "person" | "resource" | "decision" | "skill" | "issue" | "role" | "habit" | "event" | "metric";
    id: string;
    title: string;
    goalLabel?: "上层目标" | "下级目标" | "支持目标" | "被支持目标" | "依赖目标" | "被依赖目标" | "冲突目标" | "相关目标";
    domainLabel?: "满意度所属领域";
  }[];
}

export interface ExportSection {
  type: ExportType;
  label: string;
  records: readonly ExportRecord[];
}

export interface ContextDocument {
  scenario: ExportScenario;
  title: string;
  question: string;
  sections: readonly ExportSection[];
}

export const typeLabels: Record<ExportType, string> = {
  role: "身份角色",
  skill: "能力成长", resource: "资源需求",
  person: "关联人物", navigation: "人生导航", domain: "生活领域", goal: "目标", action: "行动", review: "回顾",
  inbox: "待整理信息", issue: "问题", decision: "重大决策",
  metric: "领域指标", "metric-record": "指标记录", "plan-change": "行动改期",
  habit: "习惯", "habit-log": "习惯打卡",
  event: "重要事件",
  "progress-item": "目标进度项",
};
export const fieldPresets: Record<ExportType, readonly string[]> = {
  role: ["说明", "状态", "关联目标", "关联领域"],
  skill: ["当前水平", "目标水平", "学习路径", "练习或成果", "复盘", "状态", "关联目标", "关联领域"],
  resource: ["资源类型", "需求说明", "具备情况", "关联目标", "所属决策", "关联人物", "关联能力"],
  person: ["关系类型", "关系状态", "重要日期", "生日", "其他重要日期", "最近联系日期", "共同经历", "备注", "状态",
    "记录更新时间", "关联领域", "关联事件"],
  event: ["发生日期", "事件说明", "状态", "记录更新时间", "关联领域", "关联目标", "关联人物"],
  navigation: ["导航类型", "内容", "状态"],
  domain: ["领域说明", "当前状态", "长期期待", "当前关注", "状态", "满意度指标"],
  goal: ["说明", "状态", "状态原因", "目标周期", "优先级", "进度方式", "贡献权重",
    "当前进度", "进度依据", "进度计算日期", "习惯进度配置", "目标日期", "完成日期", "记录更新时间",
    "上层目标", "下级目标", "支持目标", "被支持目标", "依赖目标", "被依赖目标", "冲突目标", "相关目标",
    "长期方向", "关联领域", "资源需求", "身份角色"],
  action: ["备注", "状态", "当前安排日期", "完成日期",
    ...actionDetailFields.map(([, label]) => label), "投入时间（分钟）", "贡献权重", "关联目标", "关联领域"],
  "progress-item": ["进度项类型", "目标值", "当前值", "权重", "记录更新时间", "关联目标", "关联领域"],
  "plan-change": ["原安排", "新安排", "调整原因", "补充说明", "关联目标", "关联领域"],
  review: ["复盘周期", "周期开始", "周期结束", "复盘状态", "书写模式", "复盘模板", "复盘正文", "回看", "发现", "下一处关注", "关联领域", "关联目标", "关联问题"],
  inbox: ["状态", "规则建议分类", "建议依据"],
  issue: ["描述", "已记出现次数", "原因假设", "已尝试", "后续回看",
    "状态", "关联目标", "关联领域"],
  decision: ["重要程度", "背景", "可选方案", "现实约束", "评价维度", "风险",
    "机会成本", "可逆性", "最终选择", "选择理由", "执行条件", "后续结果",
    "复盘", "关联人物", "人生导航依据", "关联目标", "关联领域", "资源需求"],
  metric: ["计量单位", "状态", "关联领域", "满意度所属领域"],
  "metric-record": ["数值", "计量单位", "记录说明", "关联领域", "满意度所属领域"],
  habit: ["意图", "当前每周期望次数", "开始日期", "稳定情境", "触发条件", "阻碍", "调整",
    "状态", "定义更新时间", "关联目标", "关联领域"],
  "habit-log": ["打卡状态", "阻碍", "调整", "记录更新时间", "关联习惯", "关联目标", "关联领域"],
};
export const privacyLabels: Record<PrivacyLevel, string> = {
  normal: "普通", private: "私密", highly_sensitive: "高度敏感",
};

export const scenarioPresets: Record<ExportScenario, {
  title: string; sections: readonly ExportType[]; question: string;
}> = {
  "goal-analysis": {
    title: "目标分析", sections: ["goal", "progress-item", "action", "plan-change", "habit", "habit-log", "issue", "review", "event", "navigation", "resource", "person", "skill", "role"],
    question: "请区分已有事实和推测，梳理目标的行动进展与仍需补充的背景。",
  },
  "period-review": {
    title: "周／月复盘",
    sections: ["review", "action", "plan-change", "habit", "habit-log", "metric-record", "goal", "progress-item", "issue", "decision", "event", "person", "skill", "role"],
    question: "这段时间发生了什么？哪些变化有记录支持，下一周期值得回看什么？",
  },
  "life-domain": {
    title: "人生领域",
    sections: ["domain", "navigation", "metric", "metric-record", "goal", "progress-item", "action", "plan-change", "habit", "habit-log", "issue", "review", "event", "person", "skill", "role"],
    question: "请根据现有记录整理该领域的现状、关注点和信息缺口。",
  },
  "issue-diagnosis": {
    title: "问题诊断", sections: ["issue", "action", "habit", "habit-log", "review", "event", "goal", "progress-item", "role"],
    question: "请区分已发生的情况、原因假设和仍缺失的证据，不要直接下结论。",
  },
  "major-decision": {
    title: "重大决策", sections: ["decision", "navigation", "goal", "progress-item", "issue", "action", "resource", "person", "skill", "role"],
    question: "请比较已记录的选项、约束和风险，并指出还需要澄清的信息。",
  },
  "inbox-triage": {
    title: "收集箱整理", sections: ["inbox", "domain", "goal", "person", "issue"],
    question: "这些未整理的信息可能分别属于哪类记录？请标注不确定之处，不替我直接修改数据。",
  },
};

export function buildContextDocument(
  records: readonly ExportRecord[],
  scenario: ExportScenario,
  filter: ExportFilter,
  sectionOrder: readonly ExportType[],
  question: string,
  fieldOrder: Partial<Record<ExportType, readonly string[]>> = {},
): ContextDocument {
  if (typeof question !== "string" || question.length > 1000) {
    throw new Error("希望讨论的问题不能超过 1000 字。");
  }
  if ((filter.from && !isPlainDate(filter.from)) || (filter.to && !isPlainDate(filter.to)) ||
      (filter.from && filter.to && filter.from > filter.to)) {
    throw new Error("请选择有效的时间范围。");
  }
  if (!privacyLevels.includes(filter.maxPrivacy)) throw new Error("隐私级别无效。");
  if (filter.types.some((type) => !exportTypes.includes(type))) throw new Error("对象类型无效。");
  if (sectionOrder.some((type) => !exportTypes.includes(type)) ||
      new Set(sectionOrder).size !== sectionOrder.length) {
    throw new Error("导出字段顺序无效。");
  }
  const preset = scenarioPresets[scenario];
  if (!preset || sectionOrder.some((type) => !preset.sections.includes(type))) {
    throw new Error("请选择有效的导出场景。");
  }
  for (const type of exportTypes) {
    const order = fieldOrder[type];
    if (order && (new Set(order).size !== order.length ||
        order.some((field) => !fieldPresets[type].includes(field)))) {
      throw new Error("模板字段无效。");
    }
  }
  const privacyRank = privacyLevels.indexOf(filter.maxPrivacy);
  const visible = records.filter((record) =>
    privacyLevels.includes(record.privacy) &&
    privacyLevels.indexOf(record.privacy) <= privacyRank);
  const inScope = (record: ExportRecord) =>
    sectionOrder.includes(record.type) &&
    filter.types.includes(record.type) &&
    (!filter.from || record.date >= filter.from) &&
    (!filter.to || record.date <= filter.to) &&
    (!filter.domainId || (record.type === "domain" && record.id === filter.domainId) ||
      record.domainIds.includes(filter.domainId)) &&
    (!filter.goalId || (record.type === "goal" && record.id === filter.goalId) ||
      record.goalId === filter.goalId || ((record.type === "review" || record.type === "role" ||
        record.type === "habit" || record.type === "habit-log") &&
        record.links.some(link => link.type === "goal" && link.id === filter.goalId))) &&
    (scenario !== "major-decision" || record.type !== "decision" ||
      record.fields.some((field) => field.label === "重要程度" && field.value === "重大")) &&
    (record.type !== "inbox" || record.fields.some((field) =>
      field.label === "状态" && field.value === "待整理"));
  const scopedFacts = visible.filter(inScope);
  const resourceIds = new Set(scopedFacts
    .filter((record) => record.type === "goal" || record.type === "decision")
    .flatMap((record) => record.links.filter((link) => link.type === "resource").map((link) => link.id)));
  const resources = visible.filter((record) => record.type === "resource" &&
    sectionOrder.includes("resource") && filter.types.includes("resource") &&
    resourceIds.has(record.id) &&
    (!filter.from || record.date >= filter.from) && (!filter.to || record.date <= filter.to));
  // Navigation is global; scoped exports include only references from included goals and decisions.
  const directions = new Set(scopedFacts.filter((record) => (record.type === "goal" || record.type === "decision"))
    .flatMap((record) => record.links.filter((link) => link.type === "navigation").map((link) => link.id)));
  const people = new Set([...scopedFacts.filter((record) => record.type === "decision" || record.type === "event"), ...resources]
    .flatMap((record) => record.links.filter((link) => link.type === "person").map((link) => link.id)));
  const skillIds = new Set(resources.flatMap((record) =>
    record.links.filter((link) => link.type === "skill").map((link) => link.id)));
  const scoped = visible.filter((record) => record.type === "resource"
    ? resources.includes(record)
    : record.type === "skill"
    ? sectionOrder.includes("skill") && filter.types.includes("skill") &&
      (!filter.from || record.date >= filter.from) && (!filter.to || record.date <= filter.to) &&
      (skillIds.has(record.id) || (scenario !== "major-decision" && inScope(record)))
    : record.type === "person"
    ? sectionOrder.includes("person") && filter.types.includes("person") &&
      (people.has(record.id) || ((scenario === "inbox-triage" || scenario === "life-domain" ||
        scenario === "period-review") && inScope(record))) &&
      (!filter.from || record.date >= filter.from) && (!filter.to || record.date <= filter.to)
    : record.type === "navigation"
    ? sectionOrder.includes("navigation") && filter.types.includes("navigation") &&
      (!filter.from || record.date >= filter.from) && (!filter.to || record.date <= filter.to) &&
      (!(filter.domainId || filter.goalId) || directions.has(record.id))
    : inScope(record));
  const allowed = new Set(scoped.map((record) => `${record.type}:${record.id}`));

  return {
    scenario,
    title: preset.title,
    question: question.trim(),
    sections: sectionOrder.map((type) => ({
      type,
      label: typeLabels[type],
      records: scoped.filter((record) => record.type === type).map((record) => {
        const { goalProgress, ...original } = record;
        // A visible child must not reveal the title or id of a withheld parent.
        const safeFields = [...record.fields,
          ...(goalProgress ? exportGoalProgressFields(goalProgress, allowed) : []), ...record.links
          .filter((link) => allowed.has(`${link.type}:${link.id}`))
          .map((link) => ({
            label: link.type === "goal" && link.goalLabel ? link.goalLabel :
              link.type === "metric" ? "满意度指标" :
              link.type === "domain" && link.domainLabel ? link.domainLabel :
              link.type === "event" ? "关联事件" : link.type === "habit" ? "关联习惯" : link.type === "role" ? "身份角色" : link.type === "issue" ? "关联问题" : link.type === "skill" ? "关联能力" : link.type === "resource" ? "资源需求" : link.type === "decision" ? "所属决策" :
              link.type === "person" ? "关联人物" : link.type === "domain" ? "关联领域" : link.type === "navigation" ? (record.type === "decision" ? "人生导航依据" : "长期方向") : "关联目标",
            value: link.title,
          }))];
        const order = fieldOrder[type];
        return {
          ...original,
          fields: order ? order.flatMap((label) =>
            safeFields.filter((field) => field.label === label)) : safeFields,
          links: [],
        };
      }),
    })),
  };
}

export function serializeContext(document: ContextDocument, format: ExportFormat): string {
  if (format === "json") {
    return JSON.stringify({
      format: "lifeos-context-v1",
      scenario: document.scenario,
      title: document.title,
      sections: document.sections.map(({ type, label, records }) => ({
        type, label, records: records.map(({ title, date, fields }) => ({ title, date, fields })),
      })),
      question: document.question,
    }, null, 2);
  }
  const markdown = format === "markdown";
  const lines = [markdown ? `# ${document.title}` : document.title];
  for (const section of document.sections) {
    lines.push("", markdown ? `## ${section.label}` : `【${section.label}】`);
    if (!section.records.length) {
      lines.push("本次没有纳入相关记录。");
    } else {
      for (const record of section.records) {
        lines.push("", markdown ? `### ${oneLine(record.title)}` : oneLine(record.title));
        lines.push(`日期：${record.date}`);
        for (const field of record.fields) {
          if (field.value.trim()) {
            lines.push(`${field.label}：${field.value.trim().replace(/\r?\n/g, "\n  ")}`);
          }
        }
      }
    }
  }
  if (document.question) {
    lines.push("", markdown ? "## 希望讨论的问题" : "【希望讨论的问题】",
      document.question);
  }
  return `${lines.join("\n")}\n`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
