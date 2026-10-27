import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import { IssueValidationError, type Issue, type IssueDraft } from "../domain/issues/Issue";
import { issueDraftDefaults } from "../domain/issues/IssueTemplate";
import type { Template } from "../domain/templates/Template";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { Goal } from "../domain/planning/Goal";

function localToday(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function initialDraft(issue?: Issue, domainId?: string): IssueDraft {
  return {
    title: issue?.title ?? "",
    description: issue?.description ?? "",
    firstSeen: issue?.firstSeen ?? localToday(),
    occurrenceCount: issue?.occurrenceCount ?? 1,
    causeHypothesis: issue?.causeHypothesis ?? "",
    attempts: issue?.attempts ?? "",
    followUp: issue?.followUp ?? "",
    status: issue?.status ?? "open",
    goalId: issue?.goalId ?? null,
    domainIds: issue?.domainIds ?? (domainId ? [domainId] : []),
  };
}

export function IssueEditorDialog({
  issue: initialIssue, template, domains: initialDomains, goals: initialGoals, defaultDomainId, onClose, onSaved,
}: {
  issue?: Issue;
  template?: Template;
  domains: readonly LifeDomain[];
  goals: readonly Goal[];
  defaultDomainId?: string;
  onClose(): void;
  onSaved(): void;
}) {
  const { issueService: currentService } = useLifeOS();
  const [{ issue, issueService, domains, goals }] = useState(() => ({
    issue: initialIssue, issueService: currentService, domains: initialDomains, goals: initialGoals,
  }));
  const [draft, setDraftState] = useState<IssueDraft>(() => ({
    ...initialDraft(issue, defaultDomainId),
    ...(!issue && template ? issueDraftDefaults(template.defaults) : {}),
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const savedCallback = useRef(onSaved);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { savedCallback.current = onSaved; }, [onSaved]);
  function setDraft(next: IssueDraft) {
    if (!savingRef.current) setDraftState(next);
  }
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !savingRef.current) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || !mounted.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      if (issue) await issueService.update(issue.id, draft);
      else await issueService.create(draft);
      if (mounted.current) savedCallback.current();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof IssueValidationError
        ? reason.message : "保存问题失败，请重试。");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !savingRef.current) onClose();
    }}>
      <section className="planning-dialog" role="dialog" aria-modal="true" aria-labelledby="issue-dialog-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">问题追踪</p>
            <h2 id="issue-dialog-title">{issue ? "更新问题" : "记录一个问题"}</h2>
          </div>
          <button className="icon-button" type="button" title="关闭" aria-label="关闭"
            disabled={saving} onClick={onClose}><X aria-hidden="true" size={19} /></button>
        </header>
        <form className="domain-form" aria-busy={saving} onSubmit={(event) => void submit(event)}>
          <fieldset className="template-instance-fields" disabled={saving}>
          <label className="form-field">
            <span>问题名称</span>
            <input autoFocus required maxLength={80} value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="例如：睡眠总被工作打断" />
          </label>
          <label className="form-field">
            <span>问题描述</span>
            <textarea rows={3} maxLength={1200} value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </label>
          <div className="planning-form-grid">
            <label className="form-field">
              <span>首次发现</span>
              <input type="date" required value={draft.firstSeen}
                onChange={(event) => setDraft({ ...draft, firstSeen: event.target.value })} />
            </label>
            <label className="form-field">
              <span>出现次数</span>
              <input type="number" min={1} max={999999} step={1} required
                value={draft.occurrenceCount}
                onChange={(event) => setDraft({ ...draft, occurrenceCount: event.target.valueAsNumber })} />
            </label>
            <label className="form-field">
              <span>状态</span>
              <select value={draft.status}
                onChange={(event) => setDraft({ ...draft, status: event.target.value as IssueDraft["status"] })}>
                <option value="open">跟进中</option>
                <option value="watching">观察中</option>
                <option value="resolved">已解决</option>
              </select>
            </label>
            <label className="form-field">
              <span>关联目标</span>
              <select value={draft.goalId ?? ""}
                onChange={(event) => setDraft({ ...draft, goalId: event.target.value || null })}>
                <option value="">暂不关联</option>
                {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
              </select>
            </label>
          </div>
          <fieldset className="form-field">
            <legend>相关生活领域</legend>
            {domains.length ? (
              <div className="issue-domain-options">
                {domains.map((domain) => <label key={domain.id} className="issue-domain-option">
                  <input type="checkbox" checked={draft.domainIds.includes(domain.id)}
                    onChange={(event) => setDraft({
                      ...draft,
                      domainIds: event.target.checked
                        ? [...draft.domainIds, domain.id]
                        : draft.domainIds.filter((id) => id !== domain.id),
                    })} />
                  <span className={`domain-meta domain-color-${domain.color}`}>
                    <i aria-hidden="true" />{domain.name}
                  </span>
                </label>)}
              </div>
            ) : <p className="context-summary-empty">也可以不关联领域。</p>}
          </fieldset>
          <label className="form-field">
            <span>原因假设</span>
            <textarea rows={2} maxLength={800} value={draft.causeHypothesis}
              onChange={(event) => setDraft({ ...draft, causeHypothesis: event.target.value })} />
          </label>
          <label className="form-field">
            <span>尝试过的方案</span>
            <textarea rows={2} maxLength={1200} value={draft.attempts}
              onChange={(event) => setDraft({ ...draft, attempts: event.target.value })} />
          </label>
          <label className="form-field">
            <span>后续回看</span>
            <textarea rows={2} maxLength={1200} value={draft.followUp}
              onChange={(event) => setDraft({ ...draft, followUp: event.target.value })} />
          </label>
          </fieldset>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <footer className="dialog-actions">
            <button className="button-secondary" type="button" disabled={saving} onClick={onClose}>取消</button>
            <button className="button-primary" type="submit" disabled={saving}>
              {saving ? "保存中" : issue ? "保存修改" : "保存问题"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
