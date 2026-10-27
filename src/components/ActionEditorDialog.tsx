import { ProgressWeightEditor } from "./ProgressWeightEditor";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import type { LifeDomain } from "../domain/life/LifeDomain";
import { ActionValidationError, type Action, type ActionDraft } from "../domain/planning/Action";
import { planReasonLabels, planReasons, type PlanReason } from "../domain/planning/ActionPlanChange";
import type { Goal } from "../domain/planning/Goal";
import { actionFeedbackFields, actionIntentionFields, normalizeActionDetails } from "../domain/planning/ActionDetails";

interface ActionEditorDialogProps {
  action?: Action;
  goals: readonly Goal[];
  domains: readonly LifeDomain[];
  defaultDomainId?: string;
  onClose(): void;
  onSaved(action: Action): void;
}

function createDraft(action?: Action, defaultDomainId?: string): ActionDraft {
  return {
    title: action?.title ?? "",
    details: normalizeActionDetails(action?.details),
    notes: action?.notes ?? "",
    domainId: action ? action.domainId : defaultDomainId || null,
    domainIds: action?.domainIds ?? (defaultDomainId ? [defaultDomainId] : []),
    goalId: action?.goalId ?? null,
    progressWeight: action?.progressWeight ?? 1,
    scheduledFor: action?.scheduledFor ?? null,
  };
}

export function ActionEditorDialog({
  action: initialAction,
  goals: initialGoals,
  domains: initialDomains,
  defaultDomainId,
  onClose,
  onSaved,
}: ActionEditorDialogProps) {
  const { actionService: currentService } = useLifeOS();
  const [{ action, actionService, goals, domains }] = useState(() => ({
    action: initialAction, actionService: currentService, goals: initialGoals, domains: initialDomains,
  }));
  const [draft, setDraftState] = useState<ActionDraft>(() => createDraft(action, defaultDomainId));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const savedCallback = useRef(onSaved);
  const [reason, setReason] = useState<PlanReason | "">("");
  const [reasonNote, setReasonNote] = useState("");
  const isEditing = Boolean(action);
  const scheduleChanged = Boolean(action && draft.scheduledFor !== action.scheduledFor);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { savedCallback.current = onSaved; }, [onSaved]);

  function setDraft(next: ActionDraft) {
    if (!submitting.current) setDraftState(next);
  }

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
    if (submitting.current || !mounted.current) return;
    submitting.current = true;
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const savedAction = action
        ? await actionService.update(action.id, draft,
          scheduleChanged && reason ? { reason, note: reasonNote } : undefined)
        : await actionService.create(draft);
      if (mounted.current) savedCallback.current(savedAction);
    } catch (error) {
      if (mounted.current) setErrorMessage(error instanceof ActionValidationError
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
        aria-labelledby="action-dialog-title"
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">{isEditing ? "编辑行动" : "新增行动"}</p>
            <h2 id="action-dialog-title">{isEditing ? "调整下一步" : "把想法落成下一步"}</h2>
          </div>
          <button className="icon-button" type="button" disabled={isSaving}
            onClick={() => { if (!submitting.current) onClose(); }} title="关闭">
            <X aria-hidden="true" size={19} strokeWidth={1.8} />
            <span className="sr-only">关闭</span>
          </button>
        </header>

        <form className="domain-form" onSubmit={(event) => void handleSubmit(event)}>
          <fieldset className="template-instance-fields" disabled={isSaving}>
          <label className="form-field">
            <span>行动名称</span>
            <input
              autoFocus
              maxLength={120}
              required
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="例如：预约牙科检查、整理项目作品集"
            />
          </label>

          <label className="form-field">
            <span>备注</span>
            <textarea
              maxLength={800}
              rows={3}
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              placeholder="只留下此刻做这一步需要的信息。"
            />
          </label>

          <div className="planning-form-grid">
            <label className="form-field">
              <span>关联目标</span>
              <select
                value={draft.goalId ?? ""}
                onChange={(event) => setDraft({ ...draft, goalId: event.target.value || null })}
              >
                <option value="">暂不关联</option>
                {goals.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.title}
                  </option>
                ))}
              </select>
            </label>

          </div>

          {draft.goalId ? <ProgressWeightEditor value={draft.progressWeight ?? 1}
            label="计入目标的权重" disabled={isSaving}
            onChange={(progressWeight) => setDraft({ ...draft, progressWeight })} /> : null}
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

          <label className="form-field">
            <span>安排日期</span>
            <input
              type="date"
              value={draft.scheduledFor ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, scheduledFor: event.target.value || null })
              }
            />
          </label>

          {scheduleChanged ? <>
            <label className="form-field">
              <span>调整原因</span>
              <select required value={reason}
                onChange={(event) => { if (!submitting.current) setReason(event.target.value as PlanReason | ""); }}>
                <option value="">选择原因</option>
                {planReasons.map((value) => <option key={value} value={value}>
                  {planReasonLabels[value]}
                </option>)}
              </select>
            </label>
            <label className="form-field">
              <span>补充说明（可选）</span>
              <textarea maxLength={500} rows={2} value={reasonNote}
                onChange={(event) => { if (!submitting.current) setReasonNote(event.target.value); }} />
            </label>
          </> : null}

          {([ ["行动反馈（可选）", actionFeedbackFields], ["实施意图（可选）", actionIntentionFields] ] as const).map(([title, fields]) => (
            <details className="action-optional" key={title}>
              <summary>{title}</summary>
              {fields.map(([key, label]) => (
                <label className="form-field" key={key}>
                  <span>{label}</span>
                  <textarea rows={2} maxLength={2000} value={draft.details?.[key] ?? ""}
                    onChange={(event) => setDraft({ ...draft, details: { ...draft.details, [key]: event.target.value } })} />
                </label>
              ))}
              {title === "行动反馈（可选）" ? <label className="form-field">
                <span>投入时间（分钟）</span>
                <input type="number" min={0} step={1} value={draft.details?.actualMinutes ?? ""}
                  onChange={(event) => setDraft({ ...draft, details: { ...draft.details,
                    actualMinutes: event.target.value === "" ? null : Number(event.target.value) } })} />
              </label> : null}
            </details>
          ))}
          </fieldset>
          {errorMessage ? <p className="form-error" role="alert">{errorMessage}</p> : null}

          <footer className="dialog-actions">
            <button className="button-secondary" type="button" disabled={isSaving}
              onClick={() => { if (!submitting.current) onClose(); }}>
              取消
            </button>
            <button className="button-primary" type="submit" disabled={isSaving}>
              {isSaving ? "正在保存" : isEditing ? "保存修改" : "创建行动"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
