import { reviewTypeLabels } from "../domain/reviews/ReviewStructure";
import { goalRelationLabels, type GoalRelationType } from "../domain/planning/GoalRelation";
import { actionDetailFields, parseActionDetails } from "../domain/planning/ActionDetails";
import { goalPriorityLabels, type GoalPriority } from "../domain/planning/GoalPriority";
import { goalHorizonLabels, type GoalHorizon } from "../domain/planning/GoalHorizon";
import { navigationLabels, type NavigationKind } from "../domain/life/LifeNavigation";
import { validateIdentityRoleHistorySnapshot } from "../domain/backup/IdentityRoleBackup";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { goalStatusLabels, type GoalStatus } from "../domain/planning/Goal";
import { goalProgressModeLabels, type GoalProgressMode } from "../domain/progress/GoalProgressMode";
import {
  reviewHistoryStructure, versionLabels, versionTypes, type ObjectVersion, type VersionType,
} from "../services/history/VersionHistoryService";

const fieldLabels: Record<string, string> = {
  kind: "导航类型", title: "标题", description: "说明", reflection: "回看", insight: "发现",
  next_focus: "下一处关注", status: "状态", target_date: "目标日期",
  domain_id: "关联领域", domain_ids: "关联领域 ID", navigation_ids: "人生导航依据 ID", person_ids: "关联人物 ID", resource_need_ids: "关联资源需求 ID", first_seen: "首次发现",
  occurrence_count: "出现次数", cause_hypothesis: "原因假设", attempts: "已尝试",
  follow_up: "后续回看", background: "背景", options: "可选方案",
  constraints_text: "现实约束", criteria: "评价维度", risks: "风险",
  opportunity_cost: "机会成本", reversibility: "可逆性", choice: "最终选择",
  rationale: "选择理由", execution_conditions: "执行条件",
  outcome: "后续结果", decided_on: "记录日期", reviewed_on: "回顾日期",
  goal_ids: "关联目标 ID", issue_ids: "关联问题 ID",
  goal_id: "关联目标 ID", importance: "重要程度",
  status_reason: "状态原因", archived_at: "归档时间", completed_at: "完成时间",
  horizon: "目标周期", direction_id: "长期方向 ID",
  priority: "优先级", progress_mode: "进度方式", progress_weight: "贡献权重",
  habit_progress: "习惯型进度设置", relations: "目标关系",
};
const paths: Record<VersionType, string> = {
  action: "/goals?actionStatus=all", goal: "/goals", review: "/reviews", issue: "/issues", decision: "/decisions", navigation: "/navigation", role: "/roles",
};

export function VersionHistoryPage() {
  const { versionHistoryService, goalService, reviewService, issueService, decisionService, lifeNavigationService, actionService, identityRoleService } = useLifeOS();
  const [params] = useSearchParams();
  const type = params.get("type") as VersionType | null;
  const id = params.get("id") ?? "";
  const valid = Boolean(type && versionTypes.includes(type) && id);
  const [attempt, setAttempt] = useState(0);
  const objectService = type && versionTypes.includes(type) ? {
    goal: goalService, review: reviewService, issue: issueService, decision: decisionService,
    navigation: lifeNavigationService, action: actionService, role: identityRoleService,
  }[type] : null;
  const source = useMemo(() => ({ type, id, attempt, versionHistoryService, objectService }),
    [type, id, attempt, versionHistoryService, objectService]);
  const [result, setResult] = useState<{
    source: typeof source; history: readonly ObjectVersion[] | null; title: string; error: string;
  } | null>(null);
  const current = result?.source === source ? result : null;
  const history = current?.history ?? null;
  const title = current?.title ?? "";
  const error = current?.error ?? "";
  useEffect(() => {
    if (!source.type || !versionTypes.includes(source.type) || !source.id || !source.objectService) return;
    let active = true;
    void Promise.all([source.versionHistoryService.list(source.type, source.id), source.objectService.findById(source.id)])
      .then(([items, object]) => {
        if (active) setResult({ source, history: items,
          title: object ? ("title" in object ? object.title : object.name) : "记录已不可用", error: "" });
      })
      .catch(() => { if (active) setResult({ source, history: null,
        title: "", error: "修改历史读取失败，请重试。" }); });
    return () => { active = false; };
  }, [source]);

  return <section className="search-page">
    <header className="planning-heading"><div>
      <p className="eyebrow">修改记录</p><h1>版本历史</h1>
    </div></header>
    {!valid || !type ? <p>请选择要查看历史的记录。</p> :
      <><p>{versionLabels[type]} · {title}</p>
        <Link to={`${paths[type]}#${type}-${encodeURIComponent(id)}`}>返回原记录</Link>
        {error ? <div><p role="alert">{error}</p><button type="button" className="button-secondary"
          onClick={() => setAttempt(value => value + 1)}>重试</button></div> : history === null ? <p>正在读取修改记录…</p> :
          history.length === 0 ? <p>尚无修改记录。</p> :
            <ol className="version-list">{history.map((version) => <li key={version.id}>
              <details><summary><time dateTime={version.changedAt}>{new Date(version.changedAt).toLocaleString("zh-CN")}</time>
                <span>{type === "role" ? "修改前版本 v" + version.id : "修改前版本"}</span></summary>
                {type === "role" ? <RoleHistorySnapshot snapshot={version.snapshot} version={version.id} />
                  : type === "action" ? <ActionHistorySnapshot snapshot={version.snapshot} /> : type === "review" ? <ReviewHistorySnapshot snapshot={version.snapshot} /> : <dl>{Object.entries(version.snapshot).filter(([key]) => key in fieldLabels)
                  .map(([key, value]) => <div key={key}>
                    <dt>{fieldLabels[key]}</dt><dd>{type === "navigation" && key === "kind" &&
                      typeof value === "string" && value in navigationLabels
                      ? navigationLabels[value as NavigationKind] : type === "goal" && key === "status" &&
                      typeof value === "string" && value in goalStatusLabels
                      ? goalStatusLabels[value as GoalStatus] : type === "goal" && key === "horizon" &&
                      typeof value === "string" && value in goalHorizonLabels
                      ? goalHorizonLabels[value as GoalHorizon] : type === "goal" && key === "priority" &&
                      typeof value === "string" && value in goalPriorityLabels
                      ? goalPriorityLabels[value as GoalPriority] : type === "goal" && key === "progress_mode" &&
                      typeof value === "string" && value in goalProgressModeLabels
                      ? goalProgressModeLabels[value as GoalProgressMode] : key === "relations" && Array.isArray(value)
                      ? value.length ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)).map((item) =>
                        `${goalRelationLabels[item.relation_type as GoalRelationType] ?? "未知关系"}：${item.target_goal_id}`).join("；") : "未关联目标"
                      : key === "habit_progress" && Array.isArray(value)
                      ? value.length ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)).map((item) =>
                        `${item.habit_id}：${item.start_on} 至 ${item.end_on}，每周 ${item.weekly_target} 次，权重 ${item.weight}`).join("；")
                        : "未关联习惯" : Array.isArray(value) ? value.join("、") :
                      String(value ?? "未填写")}</dd>
                  </div>)}</dl>}
              </details>
            </li>)}</ol>}
      </>}
  </section>;
}

function RoleHistorySnapshot({ snapshot, version }: { snapshot: Record<string, unknown>; version: number }) {
  try { validateIdentityRoleHistorySnapshot(snapshot, version); }
  catch { return <p role="alert">身份角色历史数据不完整，无法展示。</p>; }
  const privacy = { normal: "普通", private: "私密", highly_sensitive: "高度敏感" };
  return <dl>
    <div><dt>名称</dt><dd>{String(snapshot.name)}</dd></div>
    <div><dt>说明</dt><dd>{String(snapshot.description || "未填写")}</dd></div>
    <div><dt>启用状态</dt><dd>{snapshot.active === 1 ? "已启用" : "已停用"}</dd></div>
    <div><dt>隐私级别</dt><dd>{privacy[snapshot.privacy_level as keyof typeof privacy]}</dd></div>
    <div><dt>归档时间</dt><dd>{snapshot.archived_at
      ? new Date(String(snapshot.archived_at)).toLocaleString("zh-CN") : "未归档"}</dd></div>
    {(["domain", "goal"] as const).map(type => <div key={type}>
      <dt>{type === "domain" ? "关联领域 ID" : "关联目标 ID"}</dt>
      <dd>{(snapshot[type + "_ids"] as string[]).join("、") || "未关联"}</dd>
    </div>)}
  </dl>;
}

function ActionHistorySnapshot({ snapshot }: { snapshot: Record<string, unknown> }) {
  let details;
  try { details = parseActionDetails(String(snapshot.details_json)); }
  catch { return <p role="alert">这份行动历史数据不完整，无法展示正文。</p>; }
  return <dl>
    <div><dt>标题</dt><dd>{String(snapshot.title)}</dd></div>
    <div><dt>完成状态</dt><dd>{snapshot.status === "completed" ? "已完成" : "未完成"}</dd></div>
    <div><dt>计划日期</dt><dd>{String(snapshot.scheduled_for ?? "未安排")}</dd></div>
    <div><dt>完成时间</dt><dd>{String(snapshot.completed_at ?? "未完成")}</dd></div>
    {actionDetailFields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{details[key] || "未填写"}</dd></div>)}
    <div><dt>投入时间</dt><dd>{details.actualMinutes === null ? "未填写" : details.actualMinutes + " 分钟"}</dd></div>
  </dl>;
}

function ReviewHistorySnapshot({ snapshot }: { snapshot: Record<string, unknown> }) {
  let structure;
  try { structure = reviewHistoryStructure(snapshot); }
  catch { return <p role="alert">这份复盘历史数据不完整，无法展示正文。</p>; }
  return <dl>
    <div><dt>标题</dt><dd>{String(snapshot.title ?? "未填写")}</dd></div>
    <div><dt>记录日期</dt><dd>{String(snapshot.reviewed_on ?? "未记录")}</dd></div>
    {structure && <>
      <div><dt>复盘周期</dt><dd>{reviewTypeLabels[structure.type]}</dd></div>
      <div><dt>周期范围</dt><dd>{structure.start} 至 {structure.end}</dd></div>
      <div><dt>复盘状态</dt><dd>{structure.status === "completed" ? "已完成" : "草稿"}</dd></div>
      <div><dt>书写模式</dt><dd>{structure.mode === "narrative" ? "叙事" : "结构化"}</dd></div>
      <div><dt>复盘模板</dt><dd>{structure.template.name} · v{structure.template.version}</dd></div>
      {structure.template.fields.map(field => <div key={field.key}><dt>{field.label}</dt>
        <dd>{structure.answers[field.key] || "未填写"}</dd></div>)}
    </>}
    {["reflection", "insight", "next_focus", "domain_ids", "goal_ids", "issue_ids"].filter(key => key in snapshot).map(key =>
      <div key={key}><dt>{fieldLabels[key]}</dt><dd>{Array.isArray(snapshot[key])
        ? snapshot[key].join("、") || "未关联" : String(snapshot[key] || "未填写")}</dd></div>)}
  </dl>;
}
