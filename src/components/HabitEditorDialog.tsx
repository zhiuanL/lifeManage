import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import { HabitValidationError, localDate, type Habit, type HabitDraft } from "../domain/habits/Habit";
import { habitDraftDefaults, normalizeHabitTemplateDefaults } from "../domain/habits/HabitTemplate";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { Template } from "../domain/templates/Template";

export function HabitEditorDialog({ habit: initialHabit, template, domains, defaultDomainId, onClose, onSaved }: {
  habit?: Habit;
  template?: Template;
  domains: readonly LifeDomain[];
  defaultDomainId: string;
  onClose(): void;
  onSaved(): void;
}) {
  const { habitService: currentService } = useLifeOS();
  const [{ habit, habitService, candidates }] = useState(() => ({
    habit: initialHabit, habitService: currentService, candidates: domains,
  }));
  const [draft, setDraftState] = useState<HabitDraft>(() => ({
    title: habit?.title ?? "", intention: habit?.intention ?? "",
    weeklyTarget: habit?.weeklyTarget ?? 3, stableContext: habit?.stableContext ?? "",
    triggerCondition: habit?.triggerCondition ?? "", obstacle: habit?.obstacle ?? "",
    adjustment: habit?.adjustment ?? "", startOn: habit?.startOn ?? localDate(new Date()),
    domainIds: habit?.domainIds ?? (defaultDomainId ? [defaultDomainId] : []),
    ...(!habit && template ? habitDraftDefaults(template.defaults) : {}),
  }));
  const [templateFrequency] = useState(() => !habit && template
    ? normalizeHabitTemplateDefaults(template.defaults).frequency ?? "" : "");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const savedCallback = useRef(onSaved);
  const [error, setError] = useState("");

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { savedCallback.current = onSaved; }, [onSaved]);
  function setDraft(next: HabitDraft) {
    if (!savingRef.current) setDraftState(next);
  }

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || !mounted.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      if (habit) await habitService.update(habit.id, draft);
      else await habitService.create(draft);
      if (mounted.current) savedCallback.current();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof HabitValidationError
        ? reason.message : "保存习惯失败，请重试。");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !savingRef.current) onClose();
  }}>
    <section className="planning-dialog" role="dialog" aria-modal="true" aria-labelledby="habit-dialog-title">
      <header className="dialog-header">
        <div><p className="eyebrow">习惯</p>
          <h2 id="habit-dialog-title">{habit ? "编辑习惯" : "建立习惯"}</h2></div>
        <button className="icon-button" type="button" title="关闭" aria-label="关闭"
          disabled={saving} onClick={onClose}><X size={19} aria-hidden="true" /></button>
      </header>
      <form className="domain-form" aria-busy={saving} onSubmit={(event) => void submit(event)}>
        <fieldset disabled={saving} className="habit-editor-fields">
        <label className="form-field"><span>习惯名称</span>
          <input autoFocus required maxLength={80} value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <div className="planning-form-grid">
          <label className="form-field"><span>每周期望次数</span>
            <input type="number" min={1} max={7} step={1} required
              title={templateFrequency || undefined} value={draft.weeklyTarget}
              onChange={(event) => setDraft({ ...draft, weeklyTarget: event.target.valueAsNumber })} />
          </label>
          <label className="form-field"><span>开始日期</span>
            <input type="date" required max={localDate(new Date())} value={draft.startOn}
              onChange={(event) => setDraft({ ...draft, startOn: event.target.value })} />
          </label>
        </div>
        {templateFrequency ? <p className="context-summary-empty">期望节奏：{templateFrequency}</p> : null}
        <label className="form-field"><span>养成意图</span>
          <textarea rows={2} maxLength={500} value={draft.intention}
            onChange={(event) => setDraft({ ...draft, intention: event.target.value })} /></label>
        <fieldset className="form-field"><legend>相关生活领域</legend>
          {candidates.length ? <div className="issue-domain-options">
            {candidates.map((domain) => <label className="issue-domain-option" key={domain.id}>
              <input type="checkbox" checked={draft.domainIds.includes(domain.id)}
                onChange={(event) => setDraft({
                  ...draft, domainIds: event.target.checked
                    ? [...draft.domainIds, domain.id]
                    : draft.domainIds.filter((id) => id !== domain.id),
                })} />
              <span className={`domain-meta domain-color-${domain.color}`}>
                <i aria-hidden="true" />{domain.name}</span>
            </label>)}
          </div> : <p className="context-summary-empty">暂不关联领域。</p>}
        </fieldset>
        <details className="habit-optional"><summary>情境与调整</summary>
          <label className="form-field"><span>稳定情境</span>
            <textarea rows={2} maxLength={500} value={draft.stableContext}
              onChange={(event) => setDraft({ ...draft, stableContext: event.target.value })} /></label>
          <label className="form-field"><span>触发条件</span>
            <textarea rows={2} maxLength={500} value={draft.triggerCondition}
              onChange={(event) => setDraft({ ...draft, triggerCondition: event.target.value })} /></label>
          <label className="form-field"><span>可能的阻碍</span>
            <textarea rows={2} maxLength={500} value={draft.obstacle}
              onChange={(event) => setDraft({ ...draft, obstacle: event.target.value })} /></label>
          <label className="form-field"><span>调整方式</span>
            <textarea rows={2} maxLength={500} value={draft.adjustment}
              onChange={(event) => setDraft({ ...draft, adjustment: event.target.value })} /></label>
        </details>
        </fieldset>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <footer className="dialog-actions">
          <button type="button" className="button-secondary" disabled={saving} onClick={onClose}>取消</button>
          <button type="submit" className="button-primary" disabled={saving}>
            {saving ? "保存中" : "保存习惯"}</button>
        </footer>
      </form>
    </section>
  </div>;
}
