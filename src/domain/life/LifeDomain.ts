export const domainColorKeys = ["ocean", "fern", "coral", "gold", "violet"] as const;

export type DomainColorKey = (typeof domainColorKeys)[number];

export const domainIconKeys = [
  "heart",
  "briefcase",
  "users",
  "wallet",
  "sprout",
  "home",
  "book-open",
  "sparkles",
] as const;

export type DomainIconKey = (typeof domainIconKeys)[number];

export const domainStatuses = ["active", "paused", "archived"] as const;
export type DomainStatus = (typeof domainStatuses)[number];

export interface LifeDomainDraft {
  name: string;
  description: string;
  focus: string;
  color: DomainColorKey;
  icon: DomainIconKey;
  currentState?: string;
  longTermExpectation?: string;
  status?: DomainStatus;
}

export interface LifeDomain extends LifeDomainDraft {
  id: string;
  currentState: string;
  longTermExpectation: string;
  status: DomainStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export class LifeDomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifeDomainValidationError";
  }
}

export function normalizeLifeDomainDraft(draft: LifeDomainDraft): Required<LifeDomainDraft> {
  const name = draft.name.trim();
  const description = draft.description.trim();
  const focus = draft.focus.trim();
  const currentState = (draft.currentState ?? "").trim();
  const longTermExpectation = (draft.longTermExpectation ?? "").trim();
  const status = draft.status ?? "active";

  if (!name) {
    throw new LifeDomainValidationError("请为这个生活领域填写名称。");
  }

  if (name.length > 28) {
    throw new LifeDomainValidationError("领域名称请控制在 28 个字符以内。");
  }

  if (description.length > 280) {
    throw new LifeDomainValidationError("领域说明请控制在 280 个字符以内。");
  }

  if (focus.length > 120) {
    throw new LifeDomainValidationError("当下关注请控制在 120 个字符以内。");
  }

  if (currentState.length > 500) {
    throw new LifeDomainValidationError("当前状态请控制在 500 个字符以内。");
  }

  if (longTermExpectation.length > 500) {
    throw new LifeDomainValidationError("长期期待请控制在 500 个字符以内。");
  }

  if (!domainStatuses.includes(status)) {
    throw new LifeDomainValidationError("请选择可用的领域状态。");
  }

  if (!domainColorKeys.includes(draft.color)) {
    throw new LifeDomainValidationError("请选择可用的领域色彩。");
  }

  if (!domainIconKeys.includes(draft.icon)) {
    throw new LifeDomainValidationError("请选择可用的领域图标。");
  }

  return {
    name,
    description,
    focus,
    color: draft.color,
    icon: draft.icon,
    currentState,
    longTermExpectation,
    status,
  };
}
