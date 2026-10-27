import { Check, ListChecks, Pencil, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { ActionEditorDialog } from "../components/ActionEditorDialog";
import { ConsumeCreateRequest } from "../components/ConsumeCreateRequest";
import { GoalPreview } from "../components/GoalPreview";
import { GoalEditorDialog } from "../components/GoalEditorDialog";
import { GoalProgressDialog } from "../components/GoalProgressDialog";
import { useTemplateEditorRequest } from "../components/useTemplateEditorRequest";
import { TemplateRequestNotice } from "../components/TemplateRequestNotice";
import type { LifeDomain } from "../domain/life/LifeDomain";
import { ActionValidationError, isActionInDomain, type Action } from "../domain/planning/Action";
import { actionDetailFields } from "../domain/planning/ActionDetails";
import { goalStatuses, goalStatusLabels, type Goal } from "../domain/planning/Goal";
import { calculateGoalProgress } from "../domain/progress/GoalProgress";
import type { GoalProgressItem } from "../domain/progress/GoalProgressItem";
import { localDate, type Habit, type HabitLog } from "../domain/habits/Habit";

interface PlanningData {
  domains: readonly LifeDomain[];
  goals: readonly Goal[];
  actions: readonly Action[];
  progressItems: readonly GoalProgressItem[];
  habits: readonly Habit[];
  habitLogs: readonly HabitLog[];
}

type PageState =
  | { kind: "loading" }
  | { kind: "ready"; data: PlanningData }
  | { kind: "error"; message: string };

export function GoalsPage() {
  const { lifeDomainService, goalService, actionService, goalProgressItemService, habitService } = useLifeOS();
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [editingAction, updateEditingAction] = useState<Action | null | undefined>(undefined);
  const actionEditorOpen = useRef<Action | null | undefined>(undefined);
  const [actionRequest, setActionRequest] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const actionSubmitting = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const sourceEpoch = useRef(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [previewGoalId, setPreviewGoalId] = useState<string | null>(null);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const closePreview = useCallback(() => {
    setPreviewGoalId(null);
    previewTrigger.current?.focus();
  }, []);
  const [progressGoal, updateProgressGoal] = useState<Goal | null>(null);
  const progressEditorOpen = useRef<Goal | null>(null);
  const [goalTemplateReady, setGoalTemplateReady] = useState(false);
  const markGoalTemplateReady = useCallback(() => setGoalTemplateReady(true), []);
  const requestedDomainId = params.get("domain");
  const requestedGoalStatus = params.get("goalStatus");
  const requestedActionStatus = params.get("actionStatus");
  const goalStatus = requestedGoalStatus ?? (hash.startsWith("#goal-") ? "all" : "ongoing");
  const actionStatus = requestedActionStatus ?? (hash.startsWith("#action-") ? "all" : "open");
  const loadPlanningData = useCallback(async (): Promise<PageState> => {
    try {
      const [domains, goals, actions, progressItems, habits, habitLogs] = await Promise.all([
        lifeDomainService.list(), goalService.list(), actionService.list(),
        goalProgressItemService.list(), habitService.list(), habitService.listLogs(),
      ]);
      return { kind: "ready", data: { domains, goals, actions, progressItems, habits, habitLogs } };
    } catch {
      return { kind: "error", message: "无法读取目标与行动，请重试。" };
    }
  }, [actionService, goalService, goalProgressItemService, lifeDomainService, habitService]);
  const [result, setResult] = useState<{ source: typeof loadPlanningData; state: PageState } | null>(null);
  const state = useMemo<PageState>(() =>
    result?.source === loadPlanningData ? result.state : { kind: "loading" }, [result, loadPlanningData]);
  const validDomain = !params.has("domain") ||
    (state.kind === "ready" && state.data.domains.some(domain => domain.id === requestedDomainId));
  const validStatus = ["all", "ongoing", ...goalStatuses].includes(goalStatus) &&
    ["all", "open", "completed"].includes(actionStatus);
  const contextReady = state.kind === "ready" &&
    validDomain && validStatus;
  const { editing: goalEditor, setEditing: setGoalEditor, editorOpen: goalEditorOpen, templateId, templateError,
    retryTemplate, cancelRequest, dismissEditor } = useTemplateEditorRequest<Goal>(
      "goal", contextReady, editingAction !== undefined || progressGoal !== null || actionBusy, goalTemplateReady);
  const editingGoal = goalEditor ? goalEditor.object ?? null : undefined;
  const modalBusy = editingGoal !== undefined || editingAction !== undefined ||
    progressGoal !== null || actionBusy || Boolean(templateId);
  function editorLocked() {
    return Boolean(goalEditorOpen.current) || actionEditorOpen.current !== undefined ||
      Boolean(progressEditorOpen.current) || actionSubmitting.current;
  }
  function setEditingAction(value: Action | null | undefined) {
    if (value !== undefined && (editorLocked() || templateId || !contextReady)) return;
    actionEditorOpen.current = value;
    updateEditingAction(value);
  }
  function setProgressGoal(value: Goal | null) {
    if (value && (editorLocked() || templateId || !contextReady)) return;
    progressEditorOpen.current = value;
    updateProgressGoal(value);
  }
  function setEditingGoal(value: Goal | null | undefined) {
    if (value !== undefined && (editorLocked() || templateId || !contextReady)) return;
    setGoalTemplateReady(false);
    if (value === undefined) dismissEditor();
    else setGoalEditor({ object: value ?? undefined });
  }
  useEffect(() => {
    if (!contextReady || templateId || goalEditor || editingAction !== undefined || progressGoal || actionBusy ||
        params.get("create") !== "action") return;
    if (goalEditorOpen.current || actionEditorOpen.current !== undefined || progressEditorOpen.current ||
        actionSubmitting.current) return;
    setActionRequest(params.toString());
    actionEditorOpen.current = null;
    updateEditingAction(null);
  }, [contextReady, templateId, goalEditor, editingAction, progressGoal, actionBusy, params, goalEditorOpen]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);
  useEffect(() => {
    sourceEpoch.current += 1;
    const request = ++generation.current;
    void loadPlanningData().then(next => {
      if (mounted.current && request === generation.current) setResult({ source: loadPlanningData, state: next });
    });
    return () => { sourceEpoch.current += 1; generation.current += 1; };
  }, [loadPlanningData]);

  useEffect(() => {
    if (state.kind === "ready" && hash && !(previewGoalId && hash.startsWith("#goal-"))) {
      try { document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "center" }); }
      catch { /* An invalid fragment must not prevent reading the page. */ }
    }
  }, [hash, state, previewGoalId]);

  const reloadPlanningData = useCallback(() => {
    if (!mounted.current) return;
    const request = ++generation.current;
    setResult({ source: loadPlanningData, state: { kind: "loading" } });
    void loadPlanningData().then(next => {
      if (mounted.current && request === generation.current) setResult({ source: loadPlanningData, state: next });
    });
  }, [loadPlanningData]);

  const toggleAction = async (action: Action) => {
    if (editorLocked() || templateId || !contextReady) return;
    const epoch = sourceEpoch.current;
    actionSubmitting.current = true;
    setActionBusy(true);
    setActionError(null);
    try {
      await actionService.toggleCompletion(action.id);
      if (mounted.current && epoch === sourceEpoch.current) reloadPlanningData();
    } catch (error) {
      if (mounted.current && epoch === sourceEpoch.current) setActionError(error instanceof ActionValidationError
        ? error.message : "无法更新行动状态，请重试。");
    } finally {
      actionSubmitting.current = false;
      if (mounted.current) setActionBusy(false);
    }
  };

  function changeFilters(values: Record<string, string | null>, recovery = false) {
    if (editorLocked() || (templateId && !recovery)) return;
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    void navigate({ pathname, search: next.toString(), hash }, { preventScrollReset: true });
  }

  function renderContent() {
  if (state.kind === "loading") {
    return <div className="context-loading" aria-live="polite">正在整理你的目标与行动</div>;
  }

  if (state.kind === "error") {
    return (
      <section className="not-found-page">
        <p className="eyebrow">读取失败</p>
        <h1>暂时无法打开目标与行动</h1>
        <p className="page-intro">{state.message}</p>
        <button className="button-secondary" type="button" onClick={reloadPlanningData}>
          重试
        </button>
      </section>
    );
  }

  const { domains, goals, actions, progressItems, habits, habitLogs } = state.data;
  const progressByGoal = calculateGoalProgress(goals, actions, progressItems,
    { habits, logs: habitLogs, today: localDate(new Date()) });
  if (!validDomain) {
    return <section className="not-found-page">
      <h1>无法按当前领域查看目标与行动</h1>
      <p className="page-intro">这个领域已不存在或筛选为空。清除筛选后可查看全局记录。</p>
      <button type="button" className="button-secondary"
        disabled={editingGoal !== undefined || editingAction !== undefined || progressGoal !== null || actionBusy}
        onClick={() => changeFilters({ domain: null }, true)}>清除失效筛选</button>
    </section>;
  }
  const domainId = requestedDomainId ?? "";
  if (!validStatus) {
    return <section className="not-found-page">
      <h1>无法按当前状态查看目标与行动</h1>
      <p className="page-intro">当前状态筛选不可用，记录未被修改。</p>
      <button type="button" className="button-secondary"
        disabled={editingGoal !== undefined || editingAction !== undefined || progressGoal !== null || actionBusy}
        onClick={() => changeFilters({ goalStatus: null, actionStatus: null }, true)}>清除失效状态筛选</button>
    </section>;
  }
  const previewGoal = goals.find((goal) => goal.id === previewGoalId);
  const domainsById = new Map(domains.map((domain) => [domain.id, domain]));
  const goalsById = new Map(goals.map((goal) => [goal.id, goal]));
  const domainGoals = goals.filter((goal) => !domainId || goal.domainIds.includes(domainId));
  const visibleGoals = domainGoals.filter((goal) => goalStatus === "all" ||
    (goalStatus === "ongoing" ? !["completed", "abandoned", "archived"].includes(goal.status)
      : goal.status === goalStatus));
  const visibleById = new Map(visibleGoals.map((goal) => [goal.id, goal]));
  const goalDepth = (goal: Goal) => {
    let depth = 0;
    let parentId = goal.parentId;
    const seen = new Set([goal.id]);
    while (parentId && visibleById.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      depth++;
      parentId = visibleById.get(parentId)!.parentId;
    }
    return depth;
  };
  const orderedGoals: Goal[] = [];
  const appendGoal = (goal: Goal) => {
    orderedGoals.push(goal);
    visibleGoals.filter((child) => child.parentId === goal.id).forEach(appendGoal);
  };
  visibleGoals.filter((goal) => !goal.parentId || !visibleById.has(goal.parentId))
    .forEach(appendGoal);
  const domainActions = actions.filter((action) =>
    !domainId || isActionInDomain(action, domainId, goalsById));
  const visibleActions = domainActions.filter((action) =>
    actionStatus === "all" || action.status === actionStatus);
  const openActions = visibleActions.filter((action) => action.status === "open");
  const completedActions = visibleActions.filter((action) => action.status === "completed");

  return (
    <>
      <section className="planning-heading">
        <div>
          <p className="eyebrow">目标与行动</p>
          <h1>把方向落成下一步</h1>
        </div>
        <div className="planning-heading-actions">
          <button
            className="button-secondary"
            type="button"
            disabled={modalBusy}
            onClick={() => setEditingGoal(null)}
          >
            <Plus aria-hidden="true" size={17} strokeWidth={2} />
            新建目标
          </button>
          <button
            className="button-primary"
            type="button"
            disabled={modalBusy}
            onClick={() => setEditingAction(null)}
          >
            <Plus aria-hidden="true" size={17} strokeWidth={2} />
            新增行动
          </button>
        </div>
      </section>
      {templateId && !goalEditor && editingAction === undefined && !progressGoal ? (
        <TemplateRequestNotice label="目标" category="goal" message={templateError}
          onRetry={retryTemplate} onCancel={cancelRequest} />
      ) : null}
      {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}

      <div className="issue-filters">
        <label className="issue-filter-domain">
          <span className="sr-only">按生活领域筛选</span>
          <select aria-label="按生活领域筛选" value={domainId} disabled={modalBusy}
            onChange={(event) => changeFilters({ domain: event.target.value })}>
            <option value="">全部领域</option>
            {domains.map((domain) =>
              <option key={domain.id} value={domain.id}>{domain.name}</option>)}
          </select>
        </label>
        <div className="planning-status-filters">
          <label className="issue-filter-domain">
            <span className="sr-only">目标状态</span>
            <select aria-label="目标状态" value={goalStatus} disabled={modalBusy}
              onChange={(event) => changeFilters({ goalStatus: event.target.value })}>
              <option value="ongoing">未结束目标</option>
              <option value="all">全部目标</option>
              {goalStatuses.map((status) => <option key={status} value={status}>
                {goalStatusLabels[status]}
              </option>)}
            </select>
          </label>
          <label className="issue-filter-domain">
            <span className="sr-only">行动状态</span>
            <select aria-label="行动状态" value={actionStatus} disabled={modalBusy}
              onChange={(event) => changeFilters({ actionStatus: event.target.value })}>
              <option value="open">未完成行动</option>
              <option value="all">全部行动</option>
              <option value="completed">已完成行动</option>
            </select>
          </label>
        </div>
      </div>

      <div className="planning-layout">
        <section className="planning-section" aria-labelledby="goals-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">方向</p>
              <h2 id="goals-heading">目标</h2>
            </div>
            <span className="section-count">{visibleGoals.length}</span>
          </div>

          {visibleGoals.length === 0 ? (
            <EmptyList
              message={domainGoals.length ? "当前筛选下没有目标。" : "尚未记录目标。"}
              onCreate={() => setEditingGoal(null)}
              buttonLabel="新建目标"
              disabled={modalBusy}
            />
          ) : (
            <ol className="goal-list">
              {orderedGoals.map((goal) => {
                const progress = progressByGoal.get(goal.id);
                return (
                  <li className="goal-row" id={`goal-${goal.id}`} key={goal.id}
                    style={{ paddingInlineStart: `${Math.min(goalDepth(goal), 5) * 18}px` }}>
                    <div className="goal-row-main">
                      {goal.parentId && goalsById.has(goal.parentId) ?
                        <span className="goal-parent-label">上级：{goalsById.get(goal.parentId)!.title}</span> : null}
                      <div className="goal-title-line">
                        <span className={`goal-status status-${goal.status}`}>
                          {goalStatusLabels[goal.status]}
                        </span>
                        <h3><button type="button" className="goal-title-button"
                          aria-label={`查看目标：${goal.title}`} aria-expanded={previewGoalId === goal.id}
                          disabled={modalBusy}
                          onClick={(event) => { previewTrigger.current = event.currentTarget; setPreviewGoalId(goal.id); }}>
                          {goal.title}
                        </button></h3>
                      </div>
                      {goal.description ? <p>{goal.description}</p> : null}
                      {goal.statusReason ? <p>状态原因：{goal.statusReason}</p> : null}
                      {progress?.percent != null && goal.status !== "completed" ? (
                        <div className="goal-progress">
                          <span>{goal.habitProgress ? "习惯型进度" : progress.itemCount ? "目标进度" : "关联事项进展"}</span>
                          <strong>{progress.percent}%</strong>
                          <progress aria-label={`${goal.title}${goal.habitProgress ? "习惯型进度" : "关联事项进展"}`}
                            value={progress.percent} max={100} />
                        </div>
                      ) : null}
                      {goal.habitProgress ? <details className="goal-habit-facts">
                        <summary>习惯记录{progress?.percent == null ? " · 暂无进度" : ""}</summary>
                        <ul>{goal.habitProgress.map((setting) => {
                          const fact = progress?.habitContributions?.find((item) => item.habitId === setting.habitId);
                          return <li key={setting.habitId}>
                            <Link to={`/habits#habit-${encodeURIComponent(setting.habitId)}`}>
                              {habits.find((habit) => habit.id === setting.habitId)?.title ?? "习惯已不可用"}
                            </Link>
                            <span>{setting.startOn} 至 {setting.endOn}</span>
                            <span>每周 {setting.weeklyTarget} 次 · 权重 {setting.weight}</span>
                            <span>{fact?.expected ? `${fact.completed}/${fact.expected} · ${fact.recordedWeeks} 个已记录完整周` : "暂无完整周记录"}</span>
                          </li>;
                        })}</ul>
                      </details> : null}
                      <div className="planning-meta">
                        {goal.domainIds.map((id) => {
                          const domain = domainsById.get(id);
                          return domain ? <span key={id} className={`domain-meta domain-color-${domain.color}`}>
                            <i aria-hidden="true" />{domain.name}
                          </span> : null;
                        })}
                        {goal.targetDate ? <span>目标日期 {formatDate(goal.targetDate)}</span> : null}
                      </div>
                    </div>
                    <Link className="history-link" to={`/history?type=goal&id=${encodeURIComponent(goal.id)}`}
                      title={`查看${goal.title}的历史`}>历史</Link>
                    {!goal.habitProgress ? <button className="icon-button" type="button" title="编辑进度项"
                      disabled={modalBusy}
                      aria-label={`编辑进度项：${goal.title}`} onClick={() => setProgressGoal(goal)}>
                      <ListChecks aria-hidden="true" size={17} strokeWidth={1.8} />
                    </button> : null}
                    <button
                      className="icon-button"
                      type="button"
                      disabled={modalBusy}
                      title="编辑目标"
                      aria-label={`编辑目标：${goal.title}`}
                      onClick={() => setEditingGoal(goal)}
                    >
                      <Pencil aria-hidden="true" size={17} strokeWidth={1.8} />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {previewGoal ? <GoalPreview goal={previewGoal} goals={goals} actions={actions}
          domains={domains} progress={progressByGoal.get(previewGoal.id)}
          suspended={editingGoal !== undefined || editingAction !== undefined || progressGoal !== null}
          onClose={closePreview}
          onSelectGoal={setPreviewGoalId} onSelectAction={() => setPreviewGoalId(null)} /> : (
        <section className="planning-section actions-section" aria-labelledby="actions-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">下一步</p>
              <h2 id="actions-heading">行动清单</h2>
            </div>
            <span className="section-count">{visibleActions.length}</span>
          </div>

          {visibleActions.length === 0 ? (
            <EmptyList
              message={domainActions.length ? "当前筛选下没有行动。" : "尚未记录行动。"}
              onCreate={() => setEditingAction(null)}
              buttonLabel="新增行动"
              disabled={modalBusy}
            />
          ) : (
            <ol className="action-list">
              {openActions.map((action) => (
                <ActionRow
                  key={action.id}
                  action={action}
                  domains={actionDomains(action, goalsById, domainsById)}
                  goal={action.goalId ? goalsById.get(action.goalId) : undefined}
                  disabled={modalBusy}
                  onEdit={() => setEditingAction(action)}
                  onToggle={() => void toggleAction(action)}
                />
              ))}
              {completedActions.length > 0 ? (
                <li className="completed-divider">
                  <span>已完成</span>
                </li>
              ) : null}
              {completedActions.map((action) => (
                <ActionRow
                  key={action.id}
                  action={action}
                  domains={actionDomains(action, goalsById, domainsById)}
                  goal={action.goalId ? goalsById.get(action.goalId) : undefined}
                  disabled={modalBusy}
                  onEdit={() => setEditingAction(action)}
                  onToggle={() => void toggleAction(action)}
                />
              ))}
            </ol>
          )}
        </section>
        )}
      </div>
    </>
  );
  }
  const data = state.kind === "ready" ? state.data : null;
  return <>
      {renderContent()}
      {editingGoal !== undefined ? (
          <GoalEditorDialog
            goal={editingGoal ?? undefined}
            template={goalEditor?.template}
            onTemplateReady={markGoalTemplateReady}
            goals={data?.goals ?? []}
            domains={data?.domains ?? []}
            habits={data?.habits ?? []}
            defaultDomainId={requestedDomainId ?? ""}
            onClose={() => setEditingGoal(undefined)}
            onSaved={() => {
              setEditingGoal(undefined);
              reloadPlanningData();
            }}
          />
      ) : null}

      {editingAction !== undefined ? (
        <ConsumeCreateRequest capability="goals"
          enabled={editingAction === null && actionRequest === params.toString()}>
          <ActionEditorDialog
            action={editingAction ?? undefined}
            goals={data?.goals ?? []}
            domains={data?.domains ?? []}
            defaultDomainId={requestedDomainId ?? ""}
            onClose={() => setEditingAction(undefined)}
            onSaved={() => {
              setEditingAction(undefined);
              reloadPlanningData();
            }}
          />
        </ConsumeCreateRequest>
      ) : null}
      {progressGoal ? <GoalProgressDialog goal={progressGoal}
        items={data?.progressItems.filter((item) => item.goalId === progressGoal.id) ?? []}
        onClose={() => setProgressGoal(null)}
        onSaved={() => { setProgressGoal(null); reloadPlanningData(); }} /> : null}
    </>;
}

function ActionRow({
  action,
  domains,
  goal,
  onEdit,
  onToggle,
  disabled,
}: {
  action: Action;
  domains: readonly LifeDomain[];
  goal?: Goal;
  onEdit(): void;
  onToggle(): void;
  disabled: boolean;
}) {
  const isCompleted = action.status === "completed";

  return (
    <li id={`action-${action.id}`} className={`action-row${isCompleted ? " is-completed" : ""}`}>
      <button
        className="action-complete-button"
        type="button"
        title={isCompleted ? "恢复为未完成" : "标记为完成"}
        aria-label={`${isCompleted ? "恢复为未完成" : "标记为完成"}：${action.title}`}
        onClick={onToggle}
        disabled={disabled}
      >
        {isCompleted ? <Check aria-hidden="true" size={15} strokeWidth={2.4} /> : null}
      </button>
      <div className="action-row-main">
        <div className="action-title-line">
          <h3>{action.title}</h3>
          {action.scheduledFor ? <span>{formatDate(action.scheduledFor)}</span> : null}
        </div>
        {action.notes ? <p>{action.notes}</p> : null}
        <Link className="history-link" to={`/history?type=action&id=${encodeURIComponent(action.id)}`}
          aria-label={`查看行动反馈历史：${action.title}`}>反馈历史</Link>
        {action.details && (actionDetailFields.some(([key]) => action.details?.[key]) || action.details.actualMinutes != null) ?
          <details className="action-optional">
            <summary>行动记录</summary>
            <dl>
              {actionDetailFields.filter(([key]) => action.details?.[key]).map(([key, label]) => (
                <div key={key}><dt>{label}</dt><dd>{action.details?.[key]}</dd></div>
              ))}
              {action.details.actualMinutes != null ? <div><dt>投入时间</dt><dd>{action.details.actualMinutes} 分钟</dd></div> : null}
            </dl>
          </details> : null}
        <div className="planning-meta">
          {goal ? <span>{goal.title}</span> : null}
          {domains.map((domain) => <span key={domain.id} className={`domain-meta domain-color-${domain.color}`}>
            <i aria-hidden="true" />{domain.name}
          </span>)}
        </div>
      </div>
      <button
        className="icon-button action-edit-button"
        type="button"
        title="编辑行动"
        aria-label={`编辑行动：${action.title}`}
        onClick={onEdit}
        disabled={disabled}
      >
        <Pencil aria-hidden="true" size={16} strokeWidth={1.8} />
      </button>
    </li>
  );
}

function actionDomains(action: Action, goals: ReadonlyMap<string, Goal>,
  domains: ReadonlyMap<string, LifeDomain>): LifeDomain[] {
  const ids = [...action.domainIds, ...(action.goalId ? goals.get(action.goalId)?.domainIds ?? [] : [])];
  return [...new Set(ids)].flatMap((id) => id && domains.has(id) ? [domains.get(id)!] : []);
}

function EmptyList({
  message,
  onCreate,
  buttonLabel,
  disabled,
}: {
  message: string;
  onCreate(): void;
  buttonLabel: string;
  disabled: boolean;
}) {
  return (
    <div className="planning-empty">
      <p>{message}</p>
      <button className="button-secondary" type="button" onClick={onCreate} disabled={disabled}>
        <Plus aria-hidden="true" size={16} strokeWidth={2} />
        {buttonLabel}
      </button>
    </div>
  );
}

function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(parsed);
}
