import { isPlainDate } from "../planning/Goal";

interface LinkedDraft {
  domainIds: readonly string[];
}
interface Stored {
  id: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface PersonDraft extends LinkedDraft {
  name: string;
  relationshipType: string;
  state: string;
  importantDate: string | null;
  lastContact: string | null;
  sharedExperiences: string;
  notes: string;
  dates?: readonly PersonDate[];
}
export interface Person extends PersonDraft, Stored {}

export interface PersonDate {
  kind: "birthday" | "important";
  label: string;
  date: string;
}

export function normalizePersonDates(value: unknown, trimLabels = true): PersonDate[] {
  if (!Array.isArray(value) || value.length > 21) {
    throw new LifeRecordValidationError("最多保存一个生日和二十个重要日期。");
  }
  const seen = new Set<string>();
  let birthdays = 0;
  let important = 0;
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new LifeRecordValidationError("人物日期格式无效。");
    }
    const row = entry as Record<string, unknown>;
    if (Object.keys(row).length !== 3 || typeof row.kind !== "string" ||
      !["birthday", "important"].includes(row.kind) ||
      typeof row.label !== "string" || typeof row.date !== "string" || !isPlainDate(row.date)) {
      throw new LifeRecordValidationError("人物日期需要有效的名称和年月日。");
    }
    const label = trimLabels ? row.label.trim() : row.label;
    if (!label.trim() || label.length > 80 || (row.kind === "birthday" && label !== "生日")) {
      throw new LifeRecordValidationError("日期名称请填写 1 至 80 个字符，生日名称固定为“生日”。");
    }
    if (row.kind === "birthday") birthdays += 1;
    else important += 1;
    const key = JSON.stringify([row.kind, label, row.date]);
    if (birthdays > 1 || important > 20 || seen.has(key)) {
      throw new LifeRecordValidationError("生日只能保存一个，同名同日的重要日期不能重复。");
    }
    seen.add(key);
    return { kind: row.kind as PersonDate["kind"], label, date: row.date };
  });
}

export interface LifeEventDraft extends LinkedDraft {
  title: string;
  happenedOn: string;
  description: string;
  personId: string | null;
  goalId: string | null;
}
export interface LifeEvent extends LifeEventDraft, Stored {}

export interface SkillDraft extends LinkedDraft {
  name: string;
  currentLevel: number;
  targetLevel: number;
  learningPath: string;
  practice: string;
  reflection: string;
  goalId: string | null;
}
export interface Skill extends SkillDraft, Stored {}

export class LifeRecordValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifeRecordValidationError";
  }
}

export function selectPersonEvents(events: readonly LifeEvent[], personId: string,
  domainId = "", includeArchived = false): LifeEvent[] {
  if (!personId) return [];
  return events.filter((event) => event.personId === personId &&
    (includeArchived || !event.archived) &&
    (!domainId || event.domainIds.includes(domainId)))
    .sort((a, b) => b.happenedOn.localeCompare(a.happenedOn) || a.id.localeCompare(b.id));
}

function required(value: string, label: string): string {
  const text = value.trim();
  if (!text || text.length > 80) throw new LifeRecordValidationError(`${label}请填写 1 至 80 个字符。`);
  return text;
}
function short(value: string, label: string, max = 500): string {
  const text = value.trim();
  if (text.length > max) throw new LifeRecordValidationError(`${label}请控制在 ${max} 字以内。`);
  return text;
}
function optionalDate(value: string | null, label: string): string | null {
  if (!value) return null;
  if (!isPlainDate(value)) throw new LifeRecordValidationError(`${label}不是有效日期。`);
  return value;
}
function links(ids: readonly string[]): string[] {
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) {
    throw new LifeRecordValidationError("关联领域不能重复或为空。");
  }
  return [...ids];
}

export function normalizePerson(draft: PersonDraft): PersonDraft {
  return {
    name: required(draft.name, "人物姓名"),
    relationshipType: short(draft.relationshipType, "关系类型", 80),
    state: short(draft.state, "关系状态", 200),
    importantDate: optionalDate(draft.importantDate, "重要日期"),
    lastContact: optionalDate(draft.lastContact, "最近联系日期"),
    sharedExperiences: short(draft.sharedExperiences, "共同经历"),
    notes: short(draft.notes, "备注"),
    domainIds: links(draft.domainIds),
    dates: normalizePersonDates(draft.dates ?? []),
  };
}

export function normalizeEvent(draft: LifeEventDraft): LifeEventDraft {
  if (!isPlainDate(draft.happenedOn)) throw new LifeRecordValidationError("事件日期不是有效日期。");
  return {
    title: required(draft.title, "事件标题"), happenedOn: draft.happenedOn,
    description: short(draft.description, "事件说明", 1000),
    personId: draft.personId || null, goalId: draft.goalId || null,
    domainIds: links(draft.domainIds),
  };
}

export function normalizeSkill(draft: SkillDraft): SkillDraft {
  for (const level of [draft.currentLevel, draft.targetLevel]) {
    if (!Number.isInteger(level) || level < 0 || level > 5) {
      throw new LifeRecordValidationError("能力水平请填写 0 至 5 的整数。");
    }
  }
  return {
    name: required(draft.name, "能力名称"), currentLevel: draft.currentLevel,
    targetLevel: draft.targetLevel, learningPath: short(draft.learningPath, "学习路径"),
    practice: short(draft.practice, "练习或成果"), reflection: short(draft.reflection, "复盘"),
    goalId: draft.goalId || null, domainIds: links(draft.domainIds),
  };
}
