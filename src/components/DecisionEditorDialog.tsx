import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import { DecisionValidationError, type Decision, type DecisionDraft } from "../domain/decisions/Decision";
import { decisionDraftDefaults } from "../domain/decisions/DecisionTemplate";
import type { Template } from "../domain/templates/Template";
import type { LifeDomain } from "../domain/life/LifeDomain";
import { navigationKinds, navigationLabels, type LifeNavigation } from "../domain/life/LifeNavigation";
import { resourceKindLabels, type ResourceNeed } from "../domain/resources/Resources";
import type { Person } from "../domain/records/LifeRecords";
import type { Goal } from "../domain/planning/Goal";

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function initialDraft(decision?: Decision, domainId?: string): DecisionDraft {
  return {
    title: decision?.title ?? "", decidedOn: decision?.decidedOn ?? localToday(),
    importance: decision?.importance ?? "ordinary", status: decision?.status ?? "considering",
    background: decision?.background ?? "", options: decision?.options ?? "",
    constraints: decision?.constraints ?? "", criteria: decision?.criteria ?? "",
    risks: decision?.risks ?? "", opportunityCost: decision?.opportunityCost ?? "",
    reversibility: decision?.reversibility ?? "unknown", choice: decision?.choice ?? "",
    rationale: decision?.rationale ?? "", executionConditions: decision?.executionConditions ?? "",
    outcome: decision?.outcome ?? "", reflection: decision?.reflection ?? "",
    resourceNeedIds: decision?.resourceNeedIds ?? [],
    personIds: decision?.personIds ?? [],
    navigationIds: decision?.navigationIds ?? [],
    goalId: decision?.goalId ?? null, domainIds: decision?.domainIds ?? (domainId ? [domainId] : []),
  };
}

const majorFields = [
  { key: "options", label: "可选方案" },
  { key: "constraints", label: "现实约束" },
  { key: "criteria", label: "评价维度" },
  { key: "risks", label: "风险" },
  { key: "opportunityCost", label: "机会成本" },
  { key: "rationale", label: "选择理由" },
  { key: "executionConditions", label: "执行条件" },
  { key: "outcome", label: "后续结果" },
  { key: "reflection", label: "复盘" },
] as const;

export function DecisionEditorDialog({
  decision: initialDecision, template, domains: initialDomains, goals: initialGoals,
  navigation: initialNavigation = [], people: initialPeople = [], resourceNeeds: initialResources = [],
  defaultDomainId, onClose, onSaved,
}: {
  decision?: Decision;
  template?: Template;
  domains: readonly LifeDomain[];
  goals: readonly Goal[];
  navigation?: readonly LifeNavigation[];
  people?: readonly Person[];
  resourceNeeds?: readonly ResourceNeed[];
  defaultDomainId?: string;
  onClose(): void;
  onSaved(): void;
}) {
  const { decisionService: currentService } = useLifeOS();
  const [{ decision, decisionService, domains, goals, navigation, people, resourceNeeds }] = useState(() => ({
    decision: initialDecision, decisionService: currentService, domains: initialDomains, goals: initialGoals,
    navigation: initialNavigation, people: initialPeople, resourceNeeds: initialResources,
  }));
  const [draft, setDraftState] = useState<DecisionDraft>(() => ({
    ...initialDraft(decision, defaultDomainId),
    ...(!decision && template ? decisionDraftDefaults(template.defaults) : {}),
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
  function setDraft(next: DecisionDraft) {
    if (!savingRef.current) setDraftState(next);
  }
  const showAdvanced = draft.importance === "major" ||
    majorFields.some(({ key }) => Boolean(draft[key])) || draft.reversibility !== "unknown";

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
      if (decision) await decisionService.update(decision.id, draft);
      else await decisionService.create(draft);
      if (mounted.current) savedCallback.current();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof DecisionValidationError
        ? reason.message : "保存决策失败，请重试。");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !savingRef.current) onClose();
    }}>
      <section className="planning-dialog decision-dialog" role="dialog" aria-modal="true"
        aria-labelledby="decision-dialog-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">决策记录</p>
            <h2 id="decision-dialog-title">{decision ? "编辑决策" : "记录一个选择"}</h2>
          </div>
          <button className="icon-button" type="button" title="关闭" aria-label="关闭"
            disabled={saving} onClick={onClose}><X aria-hidden="true" size={19} /></button>
        </header>
        <form className="domain-form" aria-busy={saving} onSubmit={(event) => void submit(event)}>
          <fieldset className="template-instance-fields" disabled={saving}>
          <label className="form-field">
            <span>决策议题</span>
            <input autoFocus required maxLength={80} value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="例如：是否调整工作节奏" />
          </label>
          <div className="planning-form-grid">
            <label className="form-field">
              <span>记录日期</span>
              <input type="date" required value={draft.decidedOn}
                onChange={(event) => setDraft({ ...draft, decidedOn: event.target.value })} />
            </label>
            <label className="form-field">
              <span>状态</span>
              <select value={draft.status} onChange={(event) =>
                setDraft({ ...draft, status: event.target.value as DecisionDraft["status"] })}>
                <option value="considering">考虑中</option>
                <option value="decided">已选择</option>
              </select>
            </label>
          </div>
          <label className="decision-major-toggle">
            <input type="checkbox" checked={draft.importance === "major"}
              disabled={decision?.importance === "major"}
              onChange={(event) => setDraft({
                ...draft, importance: event.target.checked ? "major" : "ordinary",
              })} />
            <span>重大决策档案</span>
          </label>
          <label className="form-field">
            <span>背景</span>
            <textarea rows={3} maxLength={2000} value={draft.background}
              onChange={(event) => setDraft({ ...draft, background: event.target.value })} />
          </label>
          {showAdvanced ? (
            <>
              {majorFields.slice(0, 5).map(({ key, label }) => (
                <label className="form-field" key={key}>
                  <span>{label}</span>
                  <textarea rows={2} maxLength={2000} value={draft[key]}
                    onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
                </label>
              ))}
              <label className="form-field">
                <span>可逆性</span>
                <select value={draft.reversibility} onChange={(event) => setDraft({
                  ...draft, reversibility: event.target.value as DecisionDraft["reversibility"],
                })}>
                  <option value="unknown">尚未判断</option>
                  <option value="reversible">可以回退</option>
                  <option value="difficult">难以回退</option>
                </select>
              </label>
            </>
          ) : null}
          <label className="form-field">
            <span>最终选择{draft.status === "decided" ? "（必填）" : ""}</span>
            <textarea rows={2} maxLength={2000} required={draft.status === "decided"}
              value={draft.choice}
              onChange={(event) => setDraft({ ...draft, choice: event.target.value })} />
          </label>
          {showAdvanced ? majorFields.slice(5).map(({ key, label }) => (
            <label className="form-field" key={key}>
              <span>{label}</span>
              <textarea rows={2} maxLength={2000} value={draft[key]}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
            </label>
          )) : null}
          <label className="form-field">
            <span>关联目标</span>
            <select value={draft.goalId ?? ""}
              onChange={(event) => setDraft({ ...draft, goalId: event.target.value || null })}>
              <option value="">暂不关联</option>
              {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
            </select>
          </label>
          <fieldset className="form-field">
            <legend>相关生活领域</legend>
            {domains.length ? <div className="issue-domain-options">
              {domains.map((domain) => <label key={domain.id} className="issue-domain-option">
                <input type="checkbox" checked={draft.domainIds.includes(domain.id)}
                  onChange={(event) => setDraft({ ...draft, domainIds: event.target.checked
                    ? [...draft.domainIds, domain.id]
                    : draft.domainIds.filter((id) => id !== domain.id) })} />
                <span className={`domain-meta domain-color-${domain.color}`}>
                  <i aria-hidden="true" />{domain.name}
                </span>
              </label>)}
            </div> : <p className="context-summary-empty">也可以不关联领域。</p>}
          </fieldset>
          <details className="issue-details">
            <summary>人生导航依据（{draft.navigationIds?.length ?? 0}）</summary>
            {!navigation.some((item) => !item.archivedAt || decision?.navigationIds?.includes(item.id)) ?
              <p className="context-summary-empty">暂无可引用的人生导航记录。</p> : null}
            {navigationKinds.map((kind) => {
              const references = navigation.filter((item) => item.kind === kind &&
                (!item.archivedAt || decision?.navigationIds?.includes(item.id)));
              return references.length ? <fieldset className="form-field" key={kind}>
                <legend>{navigationLabels[kind]}</legend>
                <div className="issue-domain-options">{references.map((item) =>
                  <label className="issue-domain-option" key={item.id}>
                    <input type="checkbox" checked={draft.navigationIds?.includes(item.id) ?? false}
                      disabled={saving} onChange={(event) => setDraft({ ...draft,
                        navigationIds: event.target.checked ? [...(draft.navigationIds ?? []), item.id]
                          : (draft.navigationIds ?? []).filter((id) => id !== item.id),
                      })} />
                    <span>{item.title}{item.archivedAt ? "（已归档）" : ""}</span>
                  </label>)}</div>
              </fieldset> : null;
            })}
          </details>
          <details className="issue-details">
            <summary>关联人物（{draft.personIds?.length ?? 0}）</summary>
            <div className="issue-domain-options">{people.filter((item) =>
              !item.archived || decision?.personIds?.includes(item.id)).map((item) => (
              <label className="issue-domain-option" key={item.id}>
                <input type="checkbox" checked={draft.personIds?.includes(item.id) ?? false}
                  disabled={saving} onChange={(event) => setDraft({ ...draft,
                    personIds: event.target.checked ? [...(draft.personIds ?? []), item.id]
                      : (draft.personIds ?? []).filter((id) => id !== item.id),
                  })} />
                <span>{item.name}{item.archived ? "（已归档）" : ""}</span>
              </label>
            ))}</div>
            {!people.some((item) => !item.archived || decision?.personIds?.includes(item.id)) ?
              <p className="context-summary-empty">暂无可关联的人物。</p> : null}
          </details>
          <details className="issue-details">
            <summary>关联资源需求（{draft.resourceNeedIds?.length ?? 0}）</summary>
            <div className="issue-domain-options">{resourceNeeds.map((need) => (
              <label className="issue-domain-option" key={need.id}>
                <input type="checkbox" checked={draft.resourceNeedIds?.includes(need.id) ?? false}
                  disabled={saving} onChange={(event) => setDraft({ ...draft,
                    resourceNeedIds: event.target.checked ? [...(draft.resourceNeedIds ?? []), need.id]
                      : (draft.resourceNeedIds ?? []).filter((id) => id !== need.id),
                  })} />
                <span>{resourceKindLabels[need.kind]} · {need.description} · {need.met ? "已具备" : "缺口"}
                  {goals.find((goal) => goal.id === need.goalId) ? `（${goals.find((goal) => goal.id === need.goalId)?.title}）` : ""}</span>
              </label>
            ))}</div>
            {!resourceNeeds.length ? <p className="context-summary-empty">暂无资源需求。</p> : null}
          </details>
          </fieldset>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <footer className="dialog-actions">
            <button className="button-secondary" type="button" disabled={saving} onClick={onClose}>取消</button>
            <button className="button-primary" type="submit" disabled={saving}>
              {saving ? "保存中" : "保存决策"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
