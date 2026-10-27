export type InboxSource = "quick-capture" | "inbox";
export class InboxValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxValidationError";
  }
}
export type InboxStatus = "unprocessed" | "processing" | "organized" | "archived";
export type InboxTarget = "goal" | "action" | "review" | "issue" | "decision" | "event" | "person";
export const inboxTargetLabels: Record<InboxTarget, string> = {
  goal: "目标", action: "行动", review: "回顾", issue: "问题",
  decision: "决策", event: "事件", person: "人物",
};
const inboxTargetPaths: Record<InboxTarget, string> = {
  goal: "/goals", action: "/goals", review: "/reviews", issue: "/issues",
  decision: "/decisions", event: "/timeline", person: "/people",
};
export function inboxTargetHref(type: InboxTarget, id: string): string {
  return `${inboxTargetPaths[type]}#${type}-${encodeURIComponent(id)}`;
}

export interface InboxItem {
  id: string;
  content: string;
  source: InboxSource;
  status: InboxStatus;
  targetType: InboxTarget | null;
  targetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function validateInboxContent(content: string): void {
  if (!content.trim()) {
    throw new InboxValidationError("先写下一点想法，再保存到收集箱。");
  }
  if (content.length > 4000) {
    throw new InboxValidationError("单条记录请控制在 4000 个字符以内。");
  }
}

export function suggestInboxTarget(content: string): { type: InboxTarget; reason: string } | null {
  if (/(决定|抉择|要不要|选择|权衡)/.test(content)) {
    return { type: "decision", reason: "文字中提到了需要权衡的选择" };
  }
  if (/(回顾|复盘|反思)/.test(content)) {
    return { type: "review", reason: "文字中提到了回顾或发现" };
  }
  if (/(问题|反复|总是|阻碍|卡住)/.test(content)) {
    return { type: "issue", reason: "文字中提到了反复出现的困扰或阻碍" };
  }
  if (/(人物|联系人|新朋友|认识了)/.test(content)) {
    return { type: "person", reason: "文字中提到了人物或认识的关系" };
  }
  if (/(重要事件|发生了|毕业|入职|搬家|纪念日)/.test(content)) {
    return { type: "event", reason: "文字中提到了事件或经历" };
  }
  if (/(感受到|发现了)/.test(content)) {
    return { type: "review", reason: "文字中提到了回顾或发现" };
  }
  if (/(目标|希望|长期|计划)/.test(content)) {
    return { type: "goal", reason: "文字中提到了目标或计划" };
  }
  if (/(记得|需要|预约|安排|明天|下周|去做)/.test(content)) {
    return { type: "action", reason: "文字中提到了待办或时间" };
  }
  return null;
}
