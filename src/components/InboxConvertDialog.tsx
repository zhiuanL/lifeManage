import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import { InboxValidationError, inboxTargetLabels, suggestInboxTarget, type InboxItem, type InboxTarget } from "../domain/inbox/InboxItem";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { Goal } from "../domain/planning/Goal";
import type { Person, PersonDate } from "../domain/records/LifeRecords";
import type { InboxConversion } from "../services/inbox/InboxService";
import { InboxSuggestions } from "./InboxSuggestions";
import { PersonDatesEditor } from "./PersonDatesEditor";

const targets: { type: InboxTarget; label: string }[] = [
  { type: "action", label: "行动" },
  { type: "goal", label: "目标" },
  { type: "review", label: "回顾" },
  { type: "issue", label: "问题" },
  { type: "decision", label: "决策" },
  { type: "event", label: "事件" },
  { type: "person", label: "人物" },
];

function detailLimitFor(type: InboxTarget): number {
  return type === "action" ? 800 : type === "goal" ? 600 :
    type === "decision" ? 2000 : type === "event" ? 1000 : type === "person" ? 500 : 1200;
}

export function InboxConvertDialog({
  item: currentItem, domains: currentDomains, goals: currentGoals, onClose, onSaved, onStatusChanged,
}: {
  item: InboxItem;
  domains: readonly LifeDomain[];
  goals: readonly Goal[];
  onClose(): void;
  onSaved(): void;
  onStatusChanged(item: InboxItem): void;
}) {
  const { inboxService: currentService, lifeRecordsService: currentRecords } = useLifeOS();
  const [{ originalItem, inboxService, lifeRecordsService, domains, goals }] = useState(() => ({
    originalItem: currentItem, inboxService: currentService, lifeRecordsService: currentRecords,
    domains: currentDomains, goals: currentGoals,
  }));
  const item = currentItem.id === originalItem.id ? currentItem : originalItem;
  const [type, setType] = useState<InboxTarget>(
    () => item.targetType ?? suggestInboxTarget(item.content)?.type ?? "action",
  );
  const [title, setTitle] = useState(() => item.content.trim().split("\n")[0].slice(0, type === "action" ? 120 : 80));
  const [details, setDetails] = useState(() => item.content.length <= detailLimitFor(type) ? item.content : "");
  const [domainId, setDomainId] = useState<string | null>(null);
  const [domainIds, setDomainIds] = useState<string[]>([]);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [occurrenceCount, setOccurrenceCount] = useState(1);
  const [majorDecision, setMajorDecision] = useState(false);
  const [personId, setPersonId] = useState<string | null>(null);
  const [personFields, setPersonFields] = useState({
    relationshipType: "", state: "", importantDate: "", lastContact: "", sharedExperiences: "",
  });
  const [personDates, setPersonDates] = useState<PersonDate[]>([]);
  const [people, setPeople] = useState<readonly Person[]>([]);
  const [peopleError, setPeopleError] = useState("");
  const [peopleAttempt, setPeopleAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const callbacks = useRef({ onSaved, onStatusChanged });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { callbacks.current = { onSaved, onStatusChanged }; }, [onSaved, onStatusChanged]);
  const [recoveryCheck, setRecoveryCheck] = useState<{
    id: string;
    state: "created" | "missing" | "error";
    message?: string;
  } | null>(null);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const activeType = item.targetType ?? type;
  const recovery = item.status === "processing"
    ? recoveryCheck?.id === item.id ? recoveryCheck.state : "checking"
    : "new";
  const hasMultipleDomains = activeType === "issue" || activeType === "decision" ||
    activeType === "event" || activeType === "person";

  useEffect(() => {
    if (activeType !== "event" || (recovery !== "new" && recovery !== "missing")) return;
    let active = true;
    void lifeRecordsService.listPeople().then(items => {
      if (!active) return;
      setPeople(items);
      setPeopleError("");
    }).catch(() => {
      if (active) setPeopleError("无法读取已有的人物，请重试；也可以暂不关联人物。");
    });
    return () => { active = false; };
  }, [activeType, recovery, lifeRecordsService, peopleAttempt]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !savingRef.current) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (item.status !== "processing") return;
    let active = true;
    void inboxService.hasReservedTarget(item.id)
      .then((created) => {
        if (active) setRecoveryCheck({ id: item.id, state: created ? "created" : "missing" });
      })
      .catch((reason) => {
        if (active) setRecoveryCheck({
          id: item.id, state: "error",
          message: reason instanceof InboxValidationError ? reason.message : "无法核对整理状态，请重试。",
        });
      });
    return () => { active = false; };
  }, [inboxService, item.id, item.status, recoveryAttempt]);

  function chooseType(next: InboxTarget) {
    if (savingRef.current) return;
    setType(next);
    setTitle(item.content.trim().split("\n")[0].slice(0, next === "action" ? 120 : 80));
    const limit = detailLimitFor(next);
    setDetails(item.content.length <= limit ? item.content : "");
    setError(null);
  }

  async function reportFailure(reason: unknown) {
    if (!mounted.current) return;
    setError(reason instanceof InboxValidationError ? reason.message : "整理失败，请重试。");
    try {
      const current = (await inboxService.list()).find((entry) => entry.id === item.id);
      if (!mounted.current) return;
      if (current?.status === "organized") {
        callbacks.current.onSaved();
      } else if (current) {
        callbacks.current.onStatusChanged(current);
        setRecoveryCheck(null);
        setRecoveryAttempt((attempt) => attempt + 1);
      }
    } catch {
      // Keep the original failure visible; the record can be checked again later.
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || !mounted.current ||
      (recovery !== "new" && recovery !== "missing")) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const conversion: InboxConversion = activeType === "action"
      ? { type: activeType, draft: { title, notes: details, domainId, goalId, scheduledFor: date || null } }
      : activeType === "goal"
        ? { type: activeType, draft: { title, description: details, domainId, status: "active", targetDate: date || null } }
        : activeType === "issue"
          ? { type: activeType, draft: { title, description: details, firstSeen: date || localToday(),
              occurrenceCount, status: "open", goalId, domainIds,
              causeHypothesis: "", attempts: "", followUp: "" } }
          : activeType === "decision"
            ? { type: activeType, draft: { title, decidedOn: date || localToday(),
                importance: majorDecision ? "major" : "ordinary", status: "considering",
                background: details, options: "", constraints: "", criteria: "", risks: "",
                opportunityCost: "", reversibility: "unknown", choice: "", rationale: "",
                executionConditions: "", outcome: "", reflection: "", goalId, domainIds } }
            : activeType === "event"
              ? { type: activeType, draft: { title, description: details,
                  happenedOn: date || localToday(), personId, goalId, domainIds } }
              : activeType === "person"
                ? { type: activeType, draft: { name: title, notes: details, domainIds,
                    relationshipType: personFields.relationshipType, state: personFields.state,
                    importantDate: personFields.importantDate || null, lastContact: personFields.lastContact || null,
                    sharedExperiences: personFields.sharedExperiences,
                    ...(personDates.length ? { dates: personDates } : {}) } }
                : { type: activeType, draft: { title, reflection: details, insight: "", nextFocus: "", domainId,
                    reviewedOn: date || localToday() } };
    try {
      await inboxService.convert(item.id, conversion);
      if (mounted.current) callbacks.current.onSaved();
    } catch (reason) {
      await reportFailure(reason);
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  async function finish() {
    if (savingRef.current || !mounted.current || recovery !== "created") return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await inboxService.finishProcessing(item.id);
      if (mounted.current) callbacks.current.onSaved();
    } catch (reason) {
      await reportFailure(reason);
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const detailLimit = detailLimitFor(activeType);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !savingRef.current) onClose();
    }}>
      <section className="planning-dialog inbox-dialog" role="dialog" aria-modal="true"
        aria-labelledby="inbox-dialog-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">收集箱</p>
            <h2 id="inbox-dialog-title">整理这条记录</h2>
          </div>
          <button className="icon-button" type="button" title="关闭" aria-label="关闭"
            disabled={saving} onClick={onClose}><X aria-hidden="true" size={19} /></button>
        </header>
        <div className="inbox-original">
          <span className="eyebrow">原始记录</span>
          <p>{item.content}</p>
        </div>
        {recovery === "checking" ? (
          <p className="inbox-recovery" aria-live="polite">正在核对正式记录…</p>
        ) : recovery === "error" ? (
          <div className="inbox-recovery">
            <p className="form-error" role="alert">{recoveryCheck?.message}</p>
            <button className="button-secondary" type="button" onClick={() => {
              setRecoveryCheck(null);
              setRecoveryAttempt((attempt) => attempt + 1);
            }}>重新核对</button>
          </div>
        ) : recovery === "created" ? (
          <div className="inbox-recovery">
            <p>正式{inboxTargetLabels[activeType]}已经保存。完成整理只会更新收集箱状态，不会新增或修改正式记录。</p>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <footer className="dialog-actions">
              <button className="button-secondary" type="button" disabled={saving} onClick={onClose}>取消</button>
              <button className="button-primary" type="button" disabled={saving} onClick={() => void finish()}>
                {saving ? "整理中" : "完成整理"}
              </button>
            </footer>
          </div>
        ) : (
        <form className="domain-form" aria-busy={saving} onSubmit={(event) => void submit(event)}
          onChangeCapture={(event) => { if (savingRef.current) event.stopPropagation(); }}>
          {recovery === "missing" ? (
            <p className="inbox-hint">上次未完成创建，请确认下方内容后继续。</p>
          ) : null}
          <fieldset className="inbox-conversion-fields" disabled={saving}>
          <InboxSuggestions key={item.id} item={item} type={activeType} date={date}
            domainIds={hasMultipleDomains ? domainIds : domainId ? [domainId] : []}
            availableDomainIds={domains.map(domain => domain.id)}
            availableGoalIds={goals.map(goal => goal.id)} availablePersonIds={people.map(person => person.id)}
            goalId={goalId} personId={personId} disabled={saving} onDate={setDate}
            onDomain={id => {
              if (hasMultipleDomains) setDomainIds(ids => ids.includes(id) ? ids : [...ids, id]);
              else setDomainId(id);
            }}
            onGoal={setGoalId} onPerson={setPersonId} onOpen={onClose} />
          <fieldset className="form-field">
            <legend>整理为</legend>
            <div className="inbox-type-switch" role="group" aria-label="整理为">
              {targets.map((target) => <button type="button" key={target.type}
                disabled={Boolean(item.targetType) && item.targetType !== target.type}
                className={activeType === target.type ? "selected" : ""}
                aria-pressed={activeType === target.type} onClick={() => chooseType(target.type)}>
                {target.label}
              </button>)}
            </div>
          </fieldset>
          <label className="form-field">
            <span>{activeType === "review" ? "回顾标题" : activeType === "goal" ? "目标名称"
              : activeType === "issue" ? "问题名称"
                : activeType === "decision" ? "决策议题" : activeType === "event" ? "事件标题"
                  : activeType === "person" ? "人物姓名" : "行动名称"}</span>
            <input autoFocus required maxLength={activeType === "action" ? 120 : 80}
              value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="form-field">
            <span>{activeType === "review" ? "回看" : activeType === "goal" ? "目标说明"
              : activeType === "issue" ? "问题描述"
                : activeType === "decision" ? "背景" : activeType === "event" ? "事件说明"
                  : activeType === "person" ? "人物备注" : "行动备注"}</span>
            <textarea rows={4} maxLength={detailLimit} value={details}
              onChange={(event) => setDetails(event.target.value)} />
          </label>
          <div className="planning-form-grid">
            {!hasMultipleDomains ? (
              <label className="form-field">
                <span>关联生活领域</span>
                <select value={domainId ?? ""} onChange={(event) => setDomainId(event.target.value || null)}>
                  <option value="">暂不关联</option>
                  {domains.map((domain) => <option value={domain.id} key={domain.id}>{domain.name}</option>)}
                </select>
              </label>
            ) : null}
            {activeType === "action" || activeType === "issue" || activeType === "decision" || activeType === "event" ? (
              <label className="form-field">
                <span>关联目标</span>
                <select value={goalId ?? ""} onChange={(event) => setGoalId(event.target.value || null)}>
                  <option value="">暂不关联</option>
                  {goals.map((goal) => <option value={goal.id} key={goal.id}>{goal.title}</option>)}
                </select>
              </label>
            ) : null}
            {activeType !== "person" ? <label className="form-field">
              <span>{activeType === "review" ? "回顾日期" : activeType === "goal" ? "目标日期"
                : activeType === "issue" ? "首次发现"
                  : activeType === "decision" ? "记录日期" : activeType === "event" ? "发生日期" : "安排日期"}</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label> : null}
            {activeType === "issue" ? (
              <label className="form-field">
                <span>出现次数</span>
                <input type="number" min={1} max={999999} step={1} required
                  value={occurrenceCount}
                  onChange={(event) => setOccurrenceCount(event.target.valueAsNumber)} />
              </label>
            ) : null}
          </div>
          {activeType === "event" ? <label className="form-field">
            <span>相关人物</span>
            <select value={personId ?? ""} onChange={event => setPersonId(event.target.value || null)}>
              <option value="">暂不关联</option>
              {people.map(person => <option value={person.id} key={person.id}>
                {person.name}{person.archived ? "（已归档）" : ""}
              </option>)}
            </select>
            {peopleError ? <span role="alert">{peopleError}
              <button className="button-secondary" type="button"
                onClick={() => setPeopleAttempt(attempt => attempt + 1)}>重新读取</button>
            </span> : null}
          </label> : null}
          {activeType === "person" ? <details className="habit-optional">
            <summary>关系与重要日期</summary>
            <div className="planning-form-grid">
              <label className="form-field"><span>关系类型</span>
                <input maxLength={80} value={personFields.relationshipType}
                  onChange={event => setPersonFields({ ...personFields, relationshipType: event.target.value })} />
              </label>
              <label className="form-field"><span>关系状态</span>
                <input maxLength={200} value={personFields.state}
                  onChange={event => setPersonFields({ ...personFields, state: event.target.value })} />
              </label>
              <label className="form-field"><span>重要日期</span>
                <input type="date" value={personFields.importantDate}
                  onChange={event => setPersonFields({ ...personFields, importantDate: event.target.value })} />
              </label>
              <label className="form-field"><span>最近联系</span>
                <input type="date" value={personFields.lastContact}
                  onChange={event => setPersonFields({ ...personFields, lastContact: event.target.value })} />
              </label>
            </div>
            <label className="form-field"><span>共同经历</span>
              <textarea rows={3} maxLength={500} value={personFields.sharedExperiences}
                onChange={event => setPersonFields({ ...personFields, sharedExperiences: event.target.value })} />
            </label>
          </details> : null}
          {activeType === "person" ? <PersonDatesEditor dates={personDates}
            onChange={dates => { if (!savingRef.current) setPersonDates(dates); }} /> : null}
          {activeType === "decision" ? (
            <label className="decision-major-toggle">
              <input type="checkbox" checked={majorDecision}
                onChange={(event) => setMajorDecision(event.target.checked)} />
              <span>重大决策档案</span>
            </label>
          ) : null}
          {hasMultipleDomains ? (
            <fieldset className="form-field">
              <legend>相关生活领域</legend>
              {domains.length ? (
                <div className="issue-domain-options">
                  {domains.map((domain) => <label key={domain.id} className="issue-domain-option">
                    <input type="checkbox" checked={domainIds.includes(domain.id)}
                      onChange={(event) => setDomainIds(event.target.checked
                        ? [...domainIds, domain.id] : domainIds.filter((id) => id !== domain.id))} />
                    <span className={`domain-meta domain-color-${domain.color}`}>
                      <i aria-hidden="true" />{domain.name}
                    </span>
                  </label>)}
                </div>
              ) : <p className="context-summary-empty">也可以不关联领域。</p>}
            </fieldset>
          ) : null}
          </fieldset>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <footer className="dialog-actions">
            <button className="button-secondary" type="button" disabled={saving} onClick={onClose}>取消</button>
            <button className="button-primary" type="submit" disabled={saving}>
              {saving ? "整理中" : item.status === "processing" ? "继续整理" : "确认整理"}
            </button>
          </footer>
        </form>
        )}
      </section>
    </div>
  );
}

function localToday(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

