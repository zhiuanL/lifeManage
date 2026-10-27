import type { DataQualityFacts, QualityCategory, QualityFinding } from "./DataQuality";
import type { IdentityRole } from "../life/IdentityRole";
import type { MetricDefinition, MetricRecord } from "../life/DomainMetric";
import { normalizePersonDates, type Person, type Skill, type LifeEvent } from "../records/LifeRecords";
import type { Issue } from "../issues/Issue";
import type { Decision } from "../decisions/Decision";
import type { Review } from "../reviews/Review";
import { normalizeReviewStructure } from "../reviews/ReviewStructure";
import { normalizeNeed, type ResourceNeed } from "../resources/Resources";
import { isPlainDate } from "../planning/Goal";

export interface LinkedQualityFacts {
  roles: readonly IdentityRole[];
  metrics: readonly MetricDefinition[];
  metricRecords: readonly MetricRecord[];
  people: readonly Person[];
  skills: readonly Skill[];
  events: readonly LifeEvent[];
  issues: readonly Issue[];
  decisions: readonly Decision[];
  reviews: readonly Review[];
  resources: readonly ResourceNeed[];
}

export function inspectLinkedRecordQuality(core: DataQualityFacts, facts: LinkedQualityFacts): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const domains = new Set(core.domains.map(row => row.id));
  const goals = new Set(core.goals.map(row => row.id));
  const people = new Set(facts.people.map(row => row.id));
  const skills = new Set(facts.skills.map(row => row.id));
  const issues = new Set(facts.issues.map(row => row.id));
  const decisions = new Set(facts.decisions.map(row => row.id));
  const navigation = new Set(core.navigation.map(row => row.id));
  const resources = new Set(facts.resources.map(row => row.id));
  const metrics = new Map(facts.metrics.map(row => [row.id, row]));
  const metricIds = new Set(metrics.keys());
  const source = (type: string, id: string, title: string, path: string | null) => {
    const add = (category: QualityCategory, code: string, message: string) =>
      findings.push({ key: JSON.stringify([type, id, code]), category,
        sourceType: type, sourceTitle: title, sourcePath: path, message });
    return {
      add,
      links(ids: readonly string[], targets: ReadonlySet<string>, code: string, label: string) {
        if (ids.some(target => !targets.has(target))) {
          add("reference", code, "已保存的" + label + "关联指向不存在的记录。");
        }
      },
      date(value: string | null, code: string, label: string) {
        if (value !== null && !isPlainDate(value)) add("date", code, label + "不是有效的年月日。");
      },
    };
  };
  const optional = (id: string | null | undefined) => id == null ? [] : [id];
  for (const role of facts.roles) {
    const check = source("身份角色", role.id, role.name, "/roles#role-" + encodeURIComponent(role.id));
    check.links(role.domainIds, domains, "domain", "领域");
    check.links(role.goalIds, goals, "goal", "目标");
  }
  for (const person of facts.people) {
    const check = source("人物", person.id, person.name, "/people#person-" + encodeURIComponent(person.id));
    check.links(person.domainIds, domains, "domain", "领域");
    check.date(person.importantDate, "important", "重要日期");
    check.date(person.lastContact, "contact", "最近联系日期");
    try { normalizePersonDates(person.dates ?? [], false); }
    catch { check.add("date", "named-dates", "已保存的生日或命名重要日期不符合保存规则。"); }
  }
  for (const skill of facts.skills) {
    const check = source("能力", skill.id, skill.name, "/skills#skill-" + encodeURIComponent(skill.id));
    check.links(skill.domainIds, domains, "domain", "领域");
    check.links(optional(skill.goalId), goals, "goal", "目标");
    if ([skill.currentLevel, skill.targetLevel].some(value => !Number.isInteger(value) || value < 0 || value > 5)) {
      check.add("value", "level", "能力水平须为 0 至 5 的整数。");
    }
  }
  for (const event of facts.events) {
    const check = source("重要事件", event.id, event.title, "/timeline#event-" + encodeURIComponent(event.id));
    check.links(event.domainIds, domains, "domain", "领域");
    check.links(optional(event.goalId), goals, "goal", "目标");
    check.links(optional(event.personId), people, "person", "人物");
    check.date(event.happenedOn, "happened", "事件日期");
  }
  for (const issue of facts.issues) {
    const check = source("问题", issue.id, issue.title, "/issues#issue-" + encodeURIComponent(issue.id));
    check.links(issue.domainIds, domains, "domain", "领域");
    check.links(optional(issue.goalId), goals, "goal", "目标");
    check.date(issue.firstSeen, "first-seen", "首次发现日期");
    if (!Number.isSafeInteger(issue.occurrenceCount) || issue.occurrenceCount < 1 || issue.occurrenceCount > 999999) {
      check.add("value", "occurrences", "出现次数须为 1 至 999999 的整数。");
    }
  }
  for (const review of facts.reviews) {
    const check = source("复盘", review.id, review.title, "/reviews#review-" + encodeURIComponent(review.id));
    check.links(review.domainIds, domains, "domain", "领域");
    check.links(review.goalIds ?? [], goals, "goal", "目标");
    check.links(review.issueIds ?? [], issues, "issue", "问题");
    check.date(review.reviewedOn, "reviewed", "复盘日期");
    if (review.structure != null) {
      try { normalizeReviewStructure(review.structure); }
      catch { check.add("value", "structure", "已保存的复盘周期、模板快照或答案不符合保存规则。"); }
    }
  }
  for (const decision of facts.decisions) {
    const check = source("决策", decision.id, decision.title, "/decisions#decision-" + encodeURIComponent(decision.id));
    check.links(decision.domainIds, domains, "domain", "领域");
    check.links(optional(decision.goalId), goals, "goal", "目标");
    check.links(decision.navigationIds ?? [], navigation, "navigation", "人生导航");
    check.links(decision.personIds ?? [], people, "person", "人物");
    check.links(decision.resourceNeedIds ?? [], resources, "resource", "资源需求");
    check.date(decision.decidedOn, "decided", "决策记录日期");
  }
  for (const need of facts.resources) {
    const ownerExists = (need.goalId != null && goals.has(need.goalId)) ||
      (need.decisionId != null && decisions.has(need.decisionId));
    const check = source("资源需求", need.id, need.description,
      ownerExists ? "/resources#resource-" + encodeURIComponent(need.id) : null);
    check.links(optional(need.goalId), goals, "goal", "所属目标");
    check.links(optional(need.decisionId), decisions, "decision", "所属决策");
    check.links(optional(need.personId), people, "person", "人物");
    check.links(optional(need.skillId), skills, "skill", "能力");
    try { normalizeNeed(need); }
    catch { check.add("value", "ownership", "资源需求的唯一归属、类型或引用不符合保存规则。"); }
  }
  for (const metric of facts.metrics) {
    source("指标", metric.id, metric.name, "/metrics#metric-" + encodeURIComponent(metric.id))
      .links(metric.domainIds, domains, "domain", "领域");
  }
  for (const record of facts.metricRecords) {
    const metric = metrics.get(record.metricId);
    const check = source("指标记录", record.id, metric?.name ?? "指标记录",
      metric ? "/metrics#metric-record-" + encodeURIComponent(record.id) : null);
    check.links([record.metricId], metricIds, "metric", "所属指标");
    check.date(record.recordedOn, "recorded", "指标日期");
    if (!Number.isFinite(record.value) || Math.abs(record.value) > 1e9) {
      check.add("value", "value", "指标数值须为有限数且绝对值不超过十亿。");
    }
  }
  return findings;
}
