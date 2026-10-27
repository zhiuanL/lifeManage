import { GoalRelationsEditor } from "./GoalRelationsEditor";
import { goalPriorities, goalPriorityLabels, type GoalPriority } from "../domain/planning/GoalPriority";
import { ProgressWeightEditor } from "./ProgressWeightEditor";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import { useSearchParams } from "react-router-dom";
import {
  GoalValidationError, goalStatuses, goalStatusLabels,
  type Goal,
  type GoalDraft,
  type GoalStatus,
} from "../domain/planning/Goal";
import type { LifeDomain } from "../domain/life/LifeDomain";
import { ProgressItemValidationError, type GoalProgressItemDraft } from "../domain/progress/GoalProgressItem";
import { ProgressItemsEditor } from "./ProgressItemsEditor";
import { GoalProgressModeEditor } from "./GoalProgressModeEditor";
import type { Habit } from "../domain/habits/Habit";
import { HabitGoalSettingsEditor } from "./HabitGoalSettingsEditor";
import type { Template } from "../domain/templates/Template";
import { goalDraftDefaults } from "../domain/planning/GoalTemplate";

import { GoalDirectionEditor } from "./GoalDirectionEditor";

const goalStatusOptions = goalStatuses.map((value) => ({ value, label: goalStatusLabels[value] }));

interface GoalEditorDialogProps {
  goal?: Goal;
  template?: Template;
  goals: readonly Goal[];
  domains: readonly LifeDomain[];
  habits?: readonly Habit[];
  defaultDomainId?: string;
  onClose(): void;
  onSaved(goal: Goal): void;
  onTemplateReady?(): void;
}

function createDraft(goal?: Goal, defaultDomainId?: string): GoalDraft {
  return {
    title: goal?.title ?? "",
    description: goal?.description ?? "",
    domainId: goal ? goal.domainId : defaultDomainId || null,
    parentId: goal?.parentId ?? null,
    horizon: goal?.horizon ?? null,
    directionId: goal?.directionId ?? null,
    progressWeight: goal?.progressWeight ?? 1,
    priority: goal?.priority ?? "medium",
    relations: goal?.relations ?? [],
    domainIds: goal?.domainIds ?? (defaultDomainId ? [defaultDomainId] : []),
    status: goal?.status ?? "active",
    statusReason: goal?.statusReason ?? null,
    progressMode: goal?.progressMode ?? "automatic",
    habitProgress: goal?.habitProgress ?? null,
    targetDate: goal?.targetDate ?? null,
  };
}

export function GoalEditorDialog({
  goal: initialGoal,
  template,
  goals: initialGoals,
  domains: initialDomains,
  habits: initialHabits = [],
  defaultDomainId,
  onClose,
  onSaved,
  onTemplateReady,
}: GoalEditorDialogProps) {
  const { goalService: currentGoalService, templateService: currentTemplateService } = useLifeOS();
  const [{ goal, goals, domains, habits, goalService, templateService }] = useState(() => ({
    goal: initialGoal, goals: initialGoals, domains: initialDomains, habits: initialHabits,
    goalService: currentGoalService, templateService: currentTemplateService,
  }));
  const [params] = useSearchParams();
  const [openingTemplate] = useState(() => goal ? undefined : template);
  const [templateId] = useState(() => goal || template ? null : params.get("template"));
  const [draft, setDraftState] = useState<GoalDraft>(() => createDraft(goal, defaultDomainId));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const savedCallback = useRef(onSaved);
  const [progressItems, setProgressItems] = useState<GoalProgressItemDraft[]>([]);
  const [habitEnabled, setHabitEnabled] = useState(Boolean(goal?.habitProgress?.length));
  const [habitSettings, setHabitSettings] = useState(() => [...(goal?.habitProgress ?? [])]);
  const [templateState, setTemplateState] = useState<"loading" | "ready" | "error">(
    !goal ? "loading" : "ready");
  const [appliedTemplate, setAppliedTemplate] = useState(Boolean(templateId || openingTemplate));
  const [templateError, setTemplateError] = useState("");
  const [templateAttempt, setTemplateAttempt] = useState(0);
  const isEditing = Boolean(goal);
  function setDraft(next: GoalDraft) {
    if (!submitting.current && templateState === "ready") setDraftState(next);
  }
  const byId = new Map(goals.map((item) => [item.id, item]));
  const parentOptions = goals.filter((candidate) => {
    const visited = new Set<string>();
    let current: Goal | undefined = candidate;
    while (current && !visited.has(current.id)) {
      if (current.id === goal?.id) return false;
      visited.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return true;
  });
  useEffect(() => {
    if (goal) return;
    let active = true;
    const reading = openingTemplate ? Promise.resolve(openingTemplate) :
      templateId ? templateService.find(templateId) : templateService.getDefaultTemplate?.("goal") ?? Promise.resolve(null);
    void reading.then((template) => {
      if (!active) return;
      if (!template && !templateId) { setTemplateState("ready"); return; }
      if (!template || template.category !== "goal") {
        setTemplateState("error");
        setTemplateError("目标模板已不存在或类型不符，请在模板中心重新选择。");
        return;
      }
      let defaults: ReturnType<typeof goalDraftDefaults>;
      try { defaults = goalDraftDefaults(template.defaults); }
      catch {
        setTemplateState("error");
        setTemplateError("目标模板内容无法应用，请先在模板中心检查说明长度、进度方式与进度项。");
        return;
      }
      setDraftState((current) => ({
        ...current, description: defaults.description, progressMode: defaults.progressMode,
      }));
      setHabitEnabled(defaults.habitEnabled);
      setProgressItems(defaults.progressItems);
      setAppliedTemplate(true);
      setTemplateState("ready");
      setTemplateError("");
    }).catch(() => {
      if (!active) return;
      setTemplateState("error");
      setTemplateError("无法读取目标模板，请重试。");
    });
    return () => { active = false; };
  }, [goal, openingTemplate, templateId, templateService, templateAttempt]);

  useEffect(() => {
    if (templateState === "ready") onTemplateReady?.();
  }, [templateState, onTemplateReady]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { savedCallback.current = onSaved; }, [onSaved]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting.current) {
        onClose();
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !mounted.current || templateState !== "ready") return;
    submitting.current = true;
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const submittedDraft = { ...draft, habitProgress: habitEnabled ? habitSettings : null };
      const savedGoal = goal
        ? await goalService.update(goal.id, submittedDraft)
        : await goalService.create(submittedDraft, progressItems);
      if (mounted.current) savedCallback.current(savedGoal);
    } catch (error) {
      if (mounted.current) setErrorMessage(error instanceof GoalValidationError || error instanceof ProgressItemValidationError
        ? error.message : "保存失败，请重试。");
    } finally {
      submitting.current = false;
      if (mounted.current) setIsSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting.current) {
          onClose();
        }
      }}
    >
      <section
        className="planning-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="goal-dialog-title"
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">{isEditing ? "编辑目标" : "新建目标"}</p>
            <h2 id="goal-dialog-title">{isEditing ? "调整方向" : "留下一段想抵达的方向"}</h2>
          </div>
          <button className="icon-button" type="button" disabled={isSaving}
            onClick={() => { if (!submitting.current) onClose(); }} title="关闭">
            <X aria-hidden="true" size={19} strokeWidth={1.8} />
            <span className="sr-only">关闭</span>
          </button>
        </header>

        <form className="domain-form" onSubmit={(event) => void handleSubmit(event)}>
          {templateState === "loading" ? <p role="status">正在读取目标模板…</p> : null}
          {templateState === "error" ? <div>
            <p className="form-error" role="alert">{templateError}</p>
            <button className="button-secondary" type="button" onClick={() => {
              setTemplateState("loading");
              setTemplateAttempt((current) => current + 1);
            }}>重试读取模板</button>
          </div> : null}
          <fieldset className="template-instance-fields" disabled={isSaving || templateState !== "ready"}>
          <label className="form-field">
            <span>目标名称</span>
            <input
              autoFocus
              maxLength={80}
              required
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="例如：恢复稳定睡眠、完成职业转型准备"
            />
          </label>

          <label className="form-field">
            <span>目标说明</span>
            <textarea
              disabled={templateState !== "ready" || isSaving}
              maxLength={600}
              rows={4}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="你想在这段方向里慢慢做到什么？"
            />
          </label>

          <fieldset className="form-field">
            <legend>关联生活领域</legend>
            {domains.length ? <div className="issue-domain-options">
              {domains.map((domain) => <label key={domain.id} className="issue-domain-option">
                <input type="checkbox" checked={draft.domainIds?.includes(domain.id) ?? false}
                  onChange={(event) => setDraft({
                    ...draft,
                    domainIds: event.target.checked
                      ? [...(draft.domainIds ?? []), domain.id]
                      : (draft.domainIds ?? []).filter((id) => id !== domain.id),
                  })} />
                <span className={`domain-meta domain-color-${domain.color}`}>
                  <i aria-hidden="true" />{domain.name}
                </span>
              </label>)}
            </div> : <p className="context-summary-empty">也可以暂不关联领域。</p>}
          </fieldset>
          <GoalDirectionEditor draft={draft} disabled={isSaving}
            allowMissingDirection={goal?.horizon === "annual" && !goal.directionId}
            onChange={(patch) => setDraft({ ...draft, ...patch })} />
          <label className="form-field">
            <span>上级目标</span>
            <select value={draft.parentId ?? ""}
              onChange={(event) => setDraft({ ...draft, parentId: event.target.value || null })}>
              <option value="">无上级目标</option>
              {parentOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>
          {draft.parentId ? <ProgressWeightEditor value={draft.progressWeight ?? 1}
            label="计入上级的权重" disabled={isSaving}
            onChange={(progressWeight) => setDraft({ ...draft, progressWeight })} /> : null}
          <div className="planning-form-grid">
            <label className="form-field">
              <span>目标日期</span>
              <input
                type="date"
                value={draft.targetDate ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, targetDate: event.target.value || null })
                }
              />
            </label>
          </div>

          <label className="form-field">
            <span>优先级</span>
            <select value={draft.priority ?? "medium"} disabled={isSaving}
              onChange={(event) => setDraft({ ...draft, priority: event.target.value as GoalPriority })}>
              {goalPriorities.map((value) => <option key={value} value={value}>{goalPriorityLabels[value]}</option>)}
            </select>
          </label>

          <label className="form-field">
            <span>当前状态</span>
            <select
              value={draft.status}
              onChange={(event) =>
                setDraft({ ...draft, status: event.target.value as GoalStatus })
              }
            >
              {goalStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {draft.status === "paused" || draft.status === "abandoned" ||
            (draft.status === "archived" && draft.statusReason) ? <label className="form-field">
            <span>{draft.status === "paused" ? "暂停原因" : draft.status === "abandoned" ? "放弃原因" : "状态原因"}</span>
            <textarea rows={3} maxLength={600} value={draft.statusReason ?? ""}
              required={(draft.status === "paused" || draft.status === "abandoned") &&
                !(goal?.status === draft.status && !goal.statusReason)}
              onChange={(event) => setDraft({ ...draft, statusReason: event.target.value })} />
          </label> : null}

          <GoalRelationsEditor goalId={goal?.id} goals={goals} relations={draft.relations ?? []}
            disabled={isSaving} onChange={(relations) => setDraft({ ...draft, relations })} />

          <GoalProgressModeEditor value={draft.progressMode ?? "automatic"}
            expanded={Boolean(appliedTemplate && templateState === "ready" && habitEnabled)}
            onChange={(progressMode) => setDraft({ ...draft, progressMode })}
            habitEnabled={habitEnabled} onHabitEnabledChange={(enabled) => {
              if (!submitting.current && templateState === "ready") setHabitEnabled(enabled);
            }}
            disabled={isSaving || templateState !== "ready"}>
            <HabitGoalSettingsEditor settings={habitSettings} habits={habits} onChange={(settings) => {
              if (!submitting.current && templateState === "ready") setHabitSettings(settings);
            }}
              disabled={isSaving || templateState !== "ready"} />
          </GoalProgressModeEditor>

          {!isEditing ? <details className="goal-initial-progress"
            onInvalidCapture={(event) => { event.currentTarget.open = true; }}
            open={appliedTemplate && templateState === "ready" && progressItems.length > 0 ? true : undefined}>
            <summary>初始进度项{progressItems.length ? `（${progressItems.length}）` : ""}</summary>
            <ProgressItemsEditor items={progressItems} onChange={(items) => {
              if (!submitting.current && templateState === "ready") setProgressItems(items);
            }}
              disabled={isSaving || templateState !== "ready"} />
          </details> : null}

          </fieldset>
          {errorMessage ? <p className="form-error" role="alert">{errorMessage}</p> : null}

          <footer className="dialog-actions">
            <button className="button-secondary" type="button" disabled={isSaving}
              onClick={() => { if (!submitting.current) onClose(); }}>
              取消
            </button>
            <button className="button-primary" type="submit" disabled={isSaving || templateState !== "ready"}>
              {isSaving ? "正在保存" : isEditing ? "保存修改" : "创建目标"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
