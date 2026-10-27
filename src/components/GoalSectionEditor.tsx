import { useEffect, useRef, useState, type FormEvent } from "react";
import { Save, X } from "lucide-react";
import { useLifeOS } from "../app/LifeOSContext";
import { GoalValidationError, goalStatuses, goalStatusLabels, type Goal, type GoalDraft, type GoalStatus } from "../domain/planning/Goal";
import { goalPriorities, goalPriorityLabels, type GoalPriority } from "../domain/planning/GoalPriority";
import { goalSectionLabels, type GoalSection } from "../domain/planning/GoalSection";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { Habit } from "../domain/habits/Habit";
import { GoalRelationsEditor } from "./GoalRelationsEditor";
import { GoalProgressModeEditor } from "./GoalProgressModeEditor";
import { HabitGoalSettingsEditor } from "./HabitGoalSettingsEditor";
import { GoalDirectionEditor } from "./GoalDirectionEditor";
import { ProgressWeightEditor } from "./ProgressWeightEditor";

export function GoalSectionEditor({ goal: initialGoal, section: initialSection, goals: initialGoals,
  domains: initialDomains, habits: initialHabits, onCancel, onSaved }: {
  goal: Goal; section: GoalSection; goals: readonly Goal[]; domains: readonly LifeDomain[];
  habits: readonly Habit[]; onCancel(): void; onSaved(goal: Goal): void;
}) {
  const { goalService: currentService } = useLifeOS();
  const [{ goal, section, goals, domains, habits, goalService }] = useState(() => ({
    goal: initialGoal, section: initialSection, goals: initialGoals, domains: initialDomains,
    habits: initialHabits, goalService: currentService,
  }));
  const [draft, setDraftState] = useState<GoalDraft>(() => ({ ...goal, domainIds: [...goal.domainIds],
    relations: goal.relations?.map((item) => ({ ...item })),
    habitProgress: goal.habitProgress?.map((item) => ({ ...item })) ?? null }));
  const [habitEnabled, setHabitEnabled] = useState(Boolean(goal.habitProgress?.length));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const savedCallback = useRef(onSaved);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { savedCallback.current = onSaved; }, [onSaved]);
  function setDraft(next: GoalDraft) {
    if (!submitting.current) setDraftState(next);
  }
  function cancel() {
    if (!submitting.current) onCancel();
  }
  const parentOptions = goals.filter((candidate) => {
    const seen = new Set<string>();
    let current: Goal | undefined = candidate;
    while (current && !seen.has(current.id)) {
      if (current.id === goal.id) return false;
      seen.add(current.id);
      current = goals.find((item) => item.id === current?.parentId);
    }
    return true;
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !mounted.current) return;
    submitting.current = true;
    setSaving(true); setError(null);
    try {
      const saved = await goalService.updateSection(goal.id, section, { ...draft,
        habitProgress: habitEnabled ? draft.habitProgress ?? [] : null });
      if (mounted.current) savedCallback.current(saved);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof GoalValidationError
        ? reason.message : "保存失败，请重试。");
    } finally {
      submitting.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return <form className="domain-form goal-section-form" aria-label={"编辑" + goalSectionLabels[section]}
    onSubmit={(event) => void submit(event)} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); cancel(); }
    }}>
    <fieldset disabled={saving} className="goal-section-fields">
      {section === "basics" ? <>
        <label className="form-field"><span>目标名称</span><input autoFocus required maxLength={80} value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className="form-field"><span>目标说明</span><textarea rows={4} maxLength={600} value={draft.description}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <label className="form-field"><span>目标日期</span><input type="date" value={draft.targetDate ?? ""}
          onChange={(event) => setDraft({ ...draft, targetDate: event.target.value || null })} /></label>
        <label className="form-field"><span>优先级</span><select value={draft.priority ?? "medium"}
          onChange={(event) => setDraft({ ...draft, priority: event.target.value as GoalPriority })}>
          {goalPriorities.map((value) => <option key={value} value={value}>{goalPriorityLabels[value]}</option>)}
        </select></label>
      </> : null}
      {section === "context" ? <>
        <GoalDirectionEditor draft={draft} disabled={saving}
          allowMissingDirection={goal.horizon === "annual" && !goal.directionId}
          onChange={(patch) => setDraft({ ...draft, ...patch })} />
        <fieldset className="form-field"><legend>关联生活领域</legend><div className="issue-domain-options">
          {domains.map((domain) => <label className="issue-domain-option" key={domain.id}>
            <input type="checkbox" checked={draft.domainIds?.includes(domain.id) ?? false}
              onChange={(event) => setDraft({ ...draft, domainIds: event.target.checked
                ? [...(draft.domainIds ?? []), domain.id] : draft.domainIds?.filter((id) => id !== domain.id) })} />{domain.name}
          </label>)}
        </div></fieldset>
        <label className="form-field"><span>上级目标</span><select autoFocus value={draft.parentId ?? ""}
          onChange={(event) => setDraft({ ...draft, parentId: event.target.value || null })}>
          <option value="">无上级目标</option>
          {parentOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>
        {draft.parentId ? <ProgressWeightEditor value={draft.progressWeight ?? 1} label="计入上级的权重"
          onChange={(progressWeight) => setDraft({ ...draft, progressWeight })} /> : null}
      </> : null}
      {section === "lifecycle" ? <>
        <label className="form-field"><span>当前状态</span><select autoFocus value={draft.status}
          onChange={(event) => setDraft({ ...draft, status: event.target.value as GoalStatus })}>
          {goalStatuses.map((value) => <option key={value} value={value}>{goalStatusLabels[value]}</option>)}
        </select></label>
        {["paused", "abandoned", "archived"].includes(draft.status) ? <label className="form-field">
          <span>状态原因</span><textarea rows={3} maxLength={600} value={draft.statusReason ?? ""}
            required={["paused", "abandoned"].includes(draft.status) && !(goal.status === draft.status && !goal.statusReason)}
            onChange={(event) => setDraft({ ...draft, statusReason: event.target.value })} /></label> : null}
      </> : null}
      {section === "relations" ? <GoalRelationsEditor goalId={goal.id} goals={goals} relations={draft.relations ?? []}
        disabled={saving} onChange={(relations) => setDraft({ ...draft, relations })} /> : null}
      {section === "progress" ? <GoalProgressModeEditor value={draft.progressMode ?? "automatic"} expanded
        habitEnabled={habitEnabled} onHabitEnabledChange={(enabled) => {
          if (!submitting.current) setHabitEnabled(enabled);
        }}
        onChange={(progressMode) => setDraft({ ...draft, progressMode })} disabled={saving}>
        <HabitGoalSettingsEditor settings={draft.habitProgress ?? []} habits={habits} disabled={saving}
          onChange={(habitProgress) => setDraft({ ...draft, habitProgress })} />
      </GoalProgressModeEditor> : null}
    </fieldset>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <footer className="dialog-actions">
      <button type="button" className="button-secondary" disabled={saving} onClick={cancel}><X size={16} />取消</button>
      <button type="submit" className="button-primary" disabled={saving}><Save size={16} />{saving ? "正在保存" : "保存区块"}</button>
    </footer>
  </form>;
}
