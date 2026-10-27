import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Pencil } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { GoalSectionEditor } from "../components/GoalSectionEditor";
import { goalStatusLabels, type Goal } from "../domain/planning/Goal";
import { goalHorizonLabels } from "../domain/planning/GoalHorizon";
import type { LifeNavigation } from "../domain/life/LifeNavigation";
import { goalPriorityLabels } from "../domain/planning/GoalPriority";
import { goalSectionLabels, type GoalSection } from "../domain/planning/GoalSection";
import { visibleGoalRelations } from "../domain/planning/GoalRelation";
import { calculateGoalProgress } from "../domain/progress/GoalProgress";
import type { GoalProgressItem } from "../domain/progress/GoalProgressItem";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { Action } from "../domain/planning/Action";
import { localDate, type Habit, type HabitLog } from "../domain/habits/Habit";
import { GoalProgressSectionEditor } from "../components/GoalProgressSectionEditor";

interface Data { navigation: readonly LifeNavigation[]; goals: readonly Goal[]; actions: readonly Action[]; domains: readonly LifeDomain[];
  items: readonly GoalProgressItem[]; habits: readonly Habit[]; logs: readonly HabitLog[]; }

export function GoalDetailPage() {
  const { goalId } = useParams();
  const { goalService, actionService, lifeDomainService, goalProgressItemService, habitService, lifeNavigationService } = useLifeOS();
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const load = useCallback(async () => {
    const [goals, actions, domains, items, habits, logs, navigation] = await Promise.all([
      goalService.list(), actionService.list(), lifeDomainService.list(),
      goalProgressItemService.list(), habitService.list(), habitService.listLogs(), lifeNavigationService.list(),
    ]);
    return { goals, actions, domains, items, habits, logs, navigation };
  }, [goalService, actionService, lifeDomainService, goalProgressItemService, habitService, lifeNavigationService]);
  const [attempt, setAttempt] = useState(0);
  type ReadResult = { source: typeof load; goalId: string | undefined; attempt: number;
    data: Data | null; error: string | null };
  type EditSession = { source: typeof load; goalId: string; data: Data; section: GoalSection | "items" };
  const [result, setResult] = useState<ReadResult | null>(null);
  const [editor, setEditor] = useState<EditSession | null>(null);
  const editorRef = useRef<EditSession | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    const request = ++generation.current;
    void load().then((next) => {
      if (active && request === generation.current) {
        setResult({ source: load, goalId, attempt, data: next, error: null });
      }
    }).catch(() => {
      if (active && request === generation.current) {
        setResult({ source: load, goalId, attempt, data: null, error: "无法读取目标详情，请重试。" });
      }
    });
    return () => { active = false; };
  }, [goalId, load, attempt]);
  const currentResult = result?.source === load && result.goalId === goalId && result.attempt === attempt ? result : null;
  const data = editor?.data ?? currentResult?.data ?? null;
  const error = currentResult?.error ?? null;
  const editing = editor?.section ?? null;
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (editing === null && restoreFocus.current) {
      restoreFocus.current = false; editTrigger.current?.focus();
    }
  }, [editing]);
  const close = () => {
    restoreFocus.current = true; editorRef.current = null; setEditor(null);
  };
  function open(section: GoalSection | "items", trigger: HTMLButtonElement) {
    if (editorRef.current || !data || !goalId) return;
    const session = { source: load, goalId, data, section };
    editorRef.current = session;
    editTrigger.current = trigger;
    setEditor(session);
  }
  function applySaved(session: EditSession, update: (before: Data) => Data) {
    if (!mounted.current || editorRef.current !== session) return;
    if (session.source === load && session.goalId === goalId) {
      ++generation.current;
      setResult((before) => ({ source: load, goalId, attempt, error: null,
        data: update(before?.source === load && before.goalId === goalId && before.data
          ? before.data : session.data) }));
    } else {
      setAttempt((value) => value + 1);
    }
    close();
  }
  if (error && !editor) return <section className="not-found-page"><h1>暂时无法打开目标详情</h1>
    <p role="alert">{error}</p><button type="button" className="button-secondary"
      onClick={() => setAttempt((value) => value + 1)}>重试</button></section>;
  if (!data) return <p className="context-loading" role="status">正在读取目标详情</p>;
  const goal = data.goals.find((item) => item.id === (editor?.goalId ?? goalId));
  if (!goal) return <section className="not-found-page"><h1>目标已不存在</h1>
    <Link to="/goals">返回目标与行动</Link></section>;
  const progress = calculateGoalProgress(data.goals, data.actions, data.items,
    { habits: data.habits, logs: data.logs, today: localDate(new Date()) }).get(goal.id);
  const relations = visibleGoalRelations(goal, data.goals);
  const direction = data.navigation.find((item) => item.id === goal.directionId);
  const parent = data.goals.find((item) => item.id === goal.parentId);
  const children = data.goals.filter((item) => item.parentId === goal.id);
  const actions = data.actions.filter((item) => item.goalId === goal.id);
  const items = data.items.filter((item) => item.goalId === goal.id);
  function section(key: GoalSection, content: ReactNode) {
    return <section className="goal-detail-section" aria-labelledby={"detail-" + key}>
      <header className="section-heading"><h2 id={"detail-" + key}>{goalSectionLabels[key]}</h2>
        <button type="button" className="icon-button" title={"编辑" + goalSectionLabels[key]}
          aria-label={"编辑" + goalSectionLabels[key]} disabled={editing !== null} onClick={(event) => {
            open(key, event.currentTarget);
          }}><Pencil size={17} aria-hidden="true" /></button>
      </header>
      {editing === key && editor ? <GoalSectionEditor key={goal!.id + key} goal={goal!} section={key}
        goals={data!.goals} domains={data!.domains} habits={data!.habits} onCancel={close}
        onSaved={(saved) => applySaved(editor, (before) => ({
          ...before, goals: before.goals.map((item) => item.id === saved.id ? saved : item),
        }))} />
        : content}
    </section>;
  }
  return <article className="goal-detail-page">
    <nav className="goal-detail-navigation"><Link to={"/goals#goal-" + encodeURIComponent(goal.id)}><ArrowLeft size={16} />目标与行动</Link>
      <Link to={"/history?type=goal&id=" + encodeURIComponent(goal.id)}>版本历史</Link>
      <Link to={"/roles?goalId=" + encodeURIComponent(goal.id)}>身份角色</Link></nav>
    <header className="goal-detail-heading"><p className="eyebrow">目标</p><h1>{goal.title}</h1></header>
    {editor && (editor.source !== load || editor.goalId !== goalId) ?
      <p role="status">当前草稿仍属于“{goal.title}”。</p> : null}
    {editor && error ? <p role="alert">{error}<button type="button" className="button-secondary"
      onClick={() => setAttempt((value) => value + 1)}>重试读取</button></p> : null}
    {section("basics", <><p className="goal-detail-text">{goal.description || "暂无目标说明"}</p>
      <dl className="goal-preview-facts"><div><dt>目标日期</dt><dd>{goal.targetDate ?? "未设置"}</dd></div>
        <div><dt>优先级</dt><dd>{goalPriorityLabels[goal.priority ?? "medium"]}</dd></div></dl></>)}
    {section("context", <dl className="goal-preview-facts">
      <div><dt>目标周期</dt><dd>{goal.horizon ? goalHorizonLabels[goal.horizon] : "未分类"}</dd></div>
      <div><dt>长期方向</dt><dd>{direction ? <Link to={"/navigation#navigation-" + encodeURIComponent(direction.id)}>{direction.title}{direction.archivedAt ? "（已归档）" : ""}</Link> : "未关联"}</dd></div>
      <div><dt>生活领域</dt><dd>{data.domains.filter((item) => goal.domainIds.includes(item.id)).map((item) => item.name).join("、") || "未关联"}</dd></div>
      <div><dt>上级目标</dt><dd>{parent ? <Link to={"/goals/" + encodeURIComponent(parent.id)}>{parent.title}</Link> : "无上级目标"}</dd></div>
      {parent ? <div><dt>计入上级的权重</dt><dd>{goal.progressWeight ?? 1}</dd></div> : null}
    </dl>)}
    {section("lifecycle", <><p>{goalStatusLabels[goal.status]}</p>
      {goal.statusReason ? <p className="goal-detail-text">{goal.statusReason}</p> : null}
      {goal.completedAt ? <p>完成时间 {goal.completedAt.slice(0, 10)}</p> : null}
      {goal.archivedAt ? <p>归档时间 {goal.archivedAt.slice(0, 10)}</p> : null}</>)}
    {section("relations", relations.length ? <ul className="goal-detail-links">{relations.map((item) =>
      <li key={item.goalId + item.type + item.label}><Link to={"/goals/" + encodeURIComponent(item.goalId)}>
        {data.goals.find((other) => other.id === item.goalId)?.title ?? "目标已不可用"}</Link><span>{item.label}</span></li>)}</ul>
      : <p className="context-summary-empty">暂无目标关系</p>)}
    {section("progress", <><p>当前进度 {progress?.percent == null ? "暂无可用进度" : progress.percent + "%"}</p>
      <p>{goal.habitProgress?.length ? "习惯型进度" : goal.progressMode === "exploration" ? "探索型 · 不显示百分比"
        : goal.progressMode === "exploration_percent" ? "探索型 · 显示百分比" : "自动汇总"}</p>
      {goal.habitProgress?.length ? <ul className="goal-detail-links">{goal.habitProgress.map((setting) => {
        const fact = progress?.habitContributions?.find((item) => item.habitId === setting.habitId);
        return <li key={setting.habitId}><Link to={"/habits#habit-" + encodeURIComponent(setting.habitId)}>
          {data.habits.find((habit) => habit.id === setting.habitId)?.title ?? "习惯已不可用"}</Link>
          <span>{setting.startOn} 至 {setting.endOn} · 每周 {setting.weeklyTarget} 次 · 权重 {setting.weight}</span>
          <span>{fact?.expected ? fact.completed + "/" + fact.expected : "暂无完整周记录"}</span></li>;
      })}</ul> : null}</>)}
    {!goal.habitProgress?.length ? <section className="goal-detail-section" aria-labelledby="detail-items">
      <header className="section-heading"><h2 id="detail-items">进度项</h2>
        <button type="button" className="icon-button" title="编辑进度项" aria-label="编辑进度项"
          disabled={editing !== null} onClick={(event) => { open("items", event.currentTarget); }}>
          <Pencil size={17} aria-hidden="true" /></button></header>
      {editing === "items" && editor ? <GoalProgressSectionEditor goal={goal} items={items} onCancel={close}
        onSaved={(saved) => applySaved(editor, (before) => ({
          ...before, items: [...before.items.filter((item) => item.goalId !== editor.goalId), ...saved],
        }))} />
        : items.length ? <ul className="goal-detail-links">{items.map((item) => <li key={item.id}>
          <span>{item.title}</span><span>{item.currentValue} / {item.targetValue} · 权重 {item.weight}</span></li>)}</ul>
          : <p className="context-summary-empty">暂无进度项</p>}
    </section> : null}
    <section className="goal-detail-section"><h2>下级目标</h2>{children.length ? <ul className="goal-detail-links">
      {children.map((item) => <li key={item.id}><Link to={"/goals/" + encodeURIComponent(item.id)}>{item.title}</Link>
        <span>{goalStatusLabels[item.status]}</span></li>)}</ul> : <p className="context-summary-empty">暂无下级目标</p>}</section>
    <section className="goal-detail-section"><h2>关联行动</h2>{actions.length ? <ul className="goal-detail-links">
      {actions.map((item) => <li key={item.id}><Link to={"/goals#action-" + encodeURIComponent(item.id)}>{item.title}</Link>
        <span>{item.status === "completed" ? "已完成" : "未完成"}</span></li>)}</ul> : <p className="context-summary-empty">暂无关联行动</p>}</section>
  </article>;
}
