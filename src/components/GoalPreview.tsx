import { visibleGoalRelations } from "../domain/planning/GoalRelation";
import { goalPriorityLabels } from "../domain/planning/GoalPriority";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { goalStatusLabels, type Goal } from "../domain/planning/Goal";
import type { Action } from "../domain/planning/Action";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { GoalProgress } from "../domain/progress/GoalProgress";

interface Props {
  goal: Goal;
  goals: readonly Goal[];
  actions: readonly Action[];
  domains: readonly LifeDomain[];
  progress?: GoalProgress;
  suspended?: boolean;
  onClose(): void;
  onSelectGoal?(id: string): void;
  onSelectAction?(): void;
}

export function GoalPreview({ goal, goals, actions, domains, progress, suspended = false, onClose, onSelectGoal, onSelectAction }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (suspended) return;
    heading.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [goal.id, onClose, suspended]);
  const relations = visibleGoalRelations(goal, goals);
  const parent = goals.find((item) => item.id === goal.parentId);
  const children = goals.filter((item) => item.parentId === goal.id);
  const linkedActions = actions.filter((item) => item.goalId === goal.id);
  return <aside className="goal-preview" aria-labelledby="goal-preview-title">
    <header className="goal-preview-heading">
      <div><p className="eyebrow">目标详情</p>
        <h2 id="goal-preview-title" ref={heading} tabIndex={-1}>{goal.title}</h2></div>
      <button className="icon-button" type="button" title="关闭目标预览"
        aria-label="关闭目标预览" onClick={onClose}><X size={18} aria-hidden="true" /></button>
    </header>
    <dl className="goal-preview-facts">
      <div><dt>当前状态</dt><dd>{goalStatusLabels[goal.status]}</dd></div>
      <div><dt>优先级</dt><dd>{goalPriorityLabels[goal.priority ?? "medium"]}</dd></div>
      <div><dt>上级方向</dt><dd>{parent?.title ?? "暂无"}</dd></div>
      <div><dt>目标日期</dt><dd>{goal.targetDate ?? "未设置"}</dd></div>
      <div><dt>当前进度</dt><dd>{progress?.percent == null ? "暂无可用进度" : progress.percent + "%"}</dd></div>
      {goal.parentId ? <div><dt>贡献权重</dt><dd>{goal.progressWeight ?? 1}</dd></div> : null}
      <div><dt>生活领域</dt><dd>{domains.filter((item) => goal.domainIds.includes(item.id)).map((item) => item.name).join("、") || "未关联"}</dd></div>
    </dl>
    {goal.description ? <section className="goal-preview-section"><h3>目标说明</h3><p>{goal.description}</p></section> : null}
    {goal.statusReason ? <section className="goal-preview-section"><h3>状态原因</h3><p>{goal.statusReason}</p></section> : null}
    <section className="goal-preview-section"><h3>目标关系 <span>{relations.length}</span></h3>
      {relations.length ? <ul>{relations.map((relation) => <li key={relation.goalId + relation.type + relation.label}>
        <Link to={"/goals#goal-" + encodeURIComponent(relation.goalId)} onClick={() => onSelectGoal?.(relation.goalId)}>
          {goals.find((item) => item.id === relation.goalId)?.title ?? "目标已不可用"}</Link>
        <span>{relation.label}</span>
      </li>)}</ul> : <p className="context-summary-empty">暂无目标关系</p>}
    </section>
    <section className="goal-preview-section"><h3>下级目标 <span>{children.length}</span></h3>
      {children.length ? <ul>{children.map((item) => <li key={item.id}>
        <Link to={"/goals#goal-" + encodeURIComponent(item.id)} onClick={() => onSelectGoal?.(item.id)}>{item.title}</Link>
        <span>{goalStatusLabels[item.status]}</span>
      </li>)}</ul> : <p className="context-summary-empty">暂无下级目标</p>}
    </section>
    <section className="goal-preview-section"><h3>关联行动 <span>{linkedActions.length}</span></h3>
      {linkedActions.length ? <ul>{linkedActions.map((item) => <li key={item.id}>
        <Link to={"/goals#action-" + encodeURIComponent(item.id)} onClick={() => onSelectAction?.()}>{item.title}</Link>
        <span>{item.status === "completed" ? "已完成" : "未完成"}</span>
      </li>)}</ul> : <p className="context-summary-empty">暂无关联行动</p>}
    </section>
    <footer className="goal-preview-section"><Link className="history-link"
      to={"/goals/" + encodeURIComponent(goal.id)}>打开完整详情</Link><Link className="history-link"
      to={"/history?type=goal&id=" + encodeURIComponent(goal.id)}>版本历史</Link></footer>
  </aside>;
}
