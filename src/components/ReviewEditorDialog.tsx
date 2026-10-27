import { RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type SetStateAction } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import { useSearchParams } from "react-router-dom";
import { applyReviewFactDraft } from "../domain/reviews/ReviewFactDraft";
import type { Goal } from "../domain/planning/Goal";
import type { Issue } from "../domain/issues/Issue";
import type { LifeDomain } from "../domain/life/LifeDomain";
import { cloneTemplateDefaults, reviewStructureFromTemplate, type Template } from "../domain/templates/Template";
import { normalizeReviewDraft, ReviewValidationError, type Review, type ReviewDraft } from "../domain/reviews/Review";
import type { ReviewCreateContext } from "../domain/reviews/ReviewCreateContext";

import { createReviewStructure, normalizeReviewStructure, reviewPeriod, reviewTypes, reviewTypeLabels, type ReviewType, type ReviewStructure } from "../domain/reviews/ReviewStructure";

interface ReviewEditorDialogProps {
  review?: Review;
  template?: Template;
  useUrlTemplate?: boolean;
  domains: readonly LifeDomain[];
  defaultDomainId?: string;
  initialContext?: ReviewCreateContext;
  onClose(): void;
  onSaved(review: Review): void;
  onTemplateReady?(): void;
}

function createDraft(review?: Review, defaultDomainId?: string, initialContext?: ReviewCreateContext): ReviewDraft {
  const anchor = review?.reviewedOn ?? initialContext?.anchor ?? getLocalDate();
  const domainIds = review ? [...review.domainIds] : initialContext
    ? [...initialContext.domainIds] : defaultDomainId ? [defaultDomainId] : [];
  return {
    structure: review ? (review.structure ? normalizeReviewStructure(review.structure) : null)
      : createReviewStructure(initialContext?.type ?? "daily", anchor),
    title: review?.title ?? "",
    reflection: review?.reflection ?? "",
    insight: review?.insight ?? "",
    nextFocus: review?.nextFocus ?? "",
    domainId: domainIds[0] ?? null,
    domainIds,
    goalIds: [...(review?.goalIds ?? [])],
    issueIds: [...(review?.issueIds ?? [])],
    reviewedOn: anchor,
  };
}

export function ReviewEditorDialog({
  review: initialReview,
  template,
  useUrlTemplate = true,
  domains: initialDomains,
  defaultDomainId,
  initialContext,
  onClose,
  onSaved,
  onTemplateReady,
}: ReviewEditorDialogProps) {
  const services = useLifeOS();
  const [{ review, domains, reviewService, templateService, reviewFactService, goalService, issueService }] =
    useState(() => ({
      review: initialReview, domains: initialDomains, reviewService: services.reviewService,
      templateService: services.templateService, reviewFactService: services.reviewFactService,
      goalService: services.goalService, issueService: services.issueService,
    }));
  const [objects, setObjects] = useState<{ goals: readonly Goal[]; issues: readonly Issue[] } | null>(null);
  const [objectsError, setObjectsError] = useState<string | null>(null);
  const [objectsAttempt, setObjectsAttempt] = useState(0);
  const [objectQuery, setObjectQuery] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([goalService.list(), issueService.list()]).then(([goals, issues]) => {
      if (active) { setObjects({ goals, issues }); setObjectsError(null); }
    }).catch(() => { if (active) setObjectsError("关联对象读取失败，请重试。"); });
    return () => { active = false; };
  }, [goalService, issueService, objectsAttempt]);
  const [params] = useSearchParams();
  const [openingTemplate] = useState(() => review || !template ? undefined :
    { ...template, defaults: cloneTemplateDefaults(template.defaults) });
  const [templateId] = useState(() => review || template || !useUrlTemplate ? null : params.get("template"));
  const [draft, setDraftState] = useState<ReviewDraft>(() => createDraft(review, defaultDomainId, initialContext));
  const [initialPeriod] = useState(() => ({ type: initialContext?.type ?? "daily", anchor: draft.reviewedOn }));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const savedCallback = useRef(onSaved);
  useEffect(() => { savedCallback.current = onSaved; }, [onSaved]);
  function setDraft(next: SetStateAction<ReviewDraft>) {
    if (!submitting.current) setDraftState(next);
  }
  const isEditing = Boolean(review);
  const structures = useRef<Partial<Record<ReviewType, ReviewStructure>>>({});
  const dialogRef = useRef<HTMLElement>(null);
  const [previousFocus] = useState(() => document.activeElement);
  const [templateState, setTemplateState] = useState<"loading" | "ready" | "error">(!review ? "loading" : "ready");
  const [templateAttempt, setTemplateAttempt] = useState(0);
  const structure = draft.structure;
  const [factAttempt, setFactAttempt] = useState(0);
  const [factResult, setFactResult] = useState<{ key: string; state: "ready" | "error" } | null>(null);
  const [factError, setFactError] = useState<string | null>(null);
  const [omittedFacts, setOmittedFacts] = useState(0);
  const generated = useRef<Record<string, string>>({});
  const touched = useRef(new Set<string>());
  const factType = structure?.type;
  const factStart = structure?.start;
  const factEnd = structure?.end;
  const factDomains = JSON.stringify(draft.domainIds ?? []);
  const factKey = JSON.stringify([factType, factStart, factEnd, factDomains, factAttempt]);
  const factsEnabled = Boolean(factType && factType !== "daily" && factStart && factEnd && templateState === "ready" && (!isEditing || factAttempt > 0));
  const factState = !factsEnabled ? "idle" : factResult?.key === factKey ? factResult.state : "loading";

  useEffect(() => {
    if (!factsEnabled || !factType || !factStart || !factEnd) return;
    let active = true;
    void reviewFactService.generate({ type: factType, start: factStart, end: factEnd }, JSON.parse(factDomains) as string[], review?.id).then(facts => {
      if (!active) return;
      const previousGenerated = { ...generated.current };
      setDraft(current => {
        if (!current.structure || current.structure.type !== factType) return current;
        const answers = { ...current.structure.answers };
        for (const field of current.structure.template.fields) {
          const key = factType + ":" + field.key;
          if (!touched.current.has(key) && previousGenerated[key] === answers[field.key]) answers[field.key] = "";
        }
        const protectedFacts = { ...facts, answers: Object.fromEntries(Object.entries(facts.answers).filter(([key]) => !touched.current.has(factType + ":" + key))) };
        const next = applyReviewFactDraft({ ...current.structure, answers }, protectedFacts);
        for (const [key, value] of Object.entries(protectedFacts.answers)) {
          if (!answers[key]?.trim() && next.answers[key] === value) generated.current[factType + ":" + key] = value;
        }
        return { ...current, structure: next };
      });
      setOmittedFacts(facts.omitted);
      setFactError(null);
      setFactResult({ key: factKey, state: "ready" });
    }).catch(() => {
      if (!active) return;
      const previousGenerated = { ...generated.current };
      setDraft(current => {
        if (!current.structure || current.structure.type !== factType) return current;
        const answers = { ...current.structure.answers };
        for (const field of current.structure.template.fields) {
          const key = factType + ":" + field.key;
          if (!touched.current.has(key) && previousGenerated[key] === answers[field.key]) answers[field.key] = "";
        }
        return { ...current, structure: { ...current.structure, answers } };
      });
      setOmittedFacts(0);
      setFactResult({ key: factKey, state: "error" });
      setFactError("事实草稿读取失败，请重试。");
    });
    return () => { active = false; };
  }, [factType, factStart, factEnd, factDomains, factAttempt, templateState, isEditing, review?.id, reviewFactService, factKey, factsEnabled]);

  function changePeriod(value: ReviewType) {
    if (submitting.current) return;
    setFactAttempt(attempt => attempt + 1);
    if (structure) structures.current[structure.type] = structure;
    const next = structures.current[value] ?? createReviewStructure(value, draft.reviewedOn);
    setDraft({ ...draft, structure: { ...next, ...reviewPeriod(value, draft.reviewedOn) } });
  }

  function changeDate(value: string) {
    if (!value || submitting.current) return;
    try {
      setDraft({ ...draft, reviewedOn: value, structure: structure ? { ...structure, ...reviewPeriod(structure.type, value) } : null });
      setErrorMessage(null);
    } catch (reason) { setErrorMessage(reason instanceof Error ? reason.message : "日期无效。"); }
  }
  useEffect(() => {
    if (review) return;
    let active = true;
    const reading = openingTemplate || templateId
      ? (openingTemplate ? Promise.resolve(openingTemplate) :
        Promise.resolve().then(() => templateService.find(templateId!))).then(template => {
        if (!template || template.category !== "review") throw new Error("回顾模板已不存在，请返回模板中心重新选择。");
        return reviewStructureFromTemplate(template, initialPeriod.anchor);
      })
      : Promise.all(reviewTypes.map(async cycle => {
      const preset = await (templateService.getDefaultTemplate?.("review", cycle) ?? Promise.resolve(null));
      return [cycle, preset] as const;
    })).then(entries => {
      const validated: Partial<Record<ReviewType, ReviewStructure>> = {};
      for (const [cycle, preset] of entries) {
        if (!preset) continue;
        const snapshot = reviewStructureFromTemplate(preset, initialPeriod.anchor);
        if (snapshot.type !== cycle) throw new Error("默认模板与复盘周期不符。");
        validated[cycle] = snapshot;
      }
      if (active) structures.current = validated;
      return validated[initialPeriod.type] ?? null;
    });
    void reading.then((snapshot) => {
      if (!active) return;
      if (snapshot) setDraft(current => ({ ...current, structure: snapshot }));
      setTemplateState("ready");
      setErrorMessage(null);
    }).catch(() => {
      if (!active) return;
      setTemplateState("error");
      setErrorMessage("回顾模板读取或校验失败，请重试或在模板中心调整。");
    });
    return () => { active = false; };
  }, [review, openingTemplate, templateId, templateService, templateAttempt, initialPeriod]);

  useEffect(() => {
    if (templateState === "ready") onTemplateReady?.();
  }, [templateState, onTemplateReady]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting.current) {
        onClose();
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    return () => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, [previousFocus]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mounted.current || submitting.current || templateState !== "ready" || factState === "loading") return;
    submitting.current = true;
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const submittedDraft = normalizeReviewDraft(draft);
      const savedReview = review
        ? await reviewService.update(review.id, submittedDraft)
        : await reviewService.create(submittedDraft);
      if (mounted.current) savedCallback.current(savedReview);
    } catch (error) {
      if (mounted.current) setErrorMessage(error instanceof ReviewValidationError
        ? error.message : "保存回顾失败，请重试。");
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
        className={`planning-dialog review-editor-dialog ${structure?.mode === "narrative" ? "review-narrative" : ""}`}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') ?? []);
          const enabled = controls.filter(control => !control.matches(":disabled") && (!control.closest("details:not([open])") || control.tagName === "SUMMARY"));
          const first = enabled[0], last = enabled[enabled.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-dialog-title"
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">{isEditing ? "编辑回顾" : "记录回顾"}</p>
            <h2 id="review-dialog-title">
              {isEditing ? "编辑回顾" : "新建复盘"}
            </h2>
          </div>
          <button className="icon-button" type="button" onClick={() => { if (!submitting.current) onClose(); }} disabled={isSaving} title="关闭">
            <X aria-hidden="true" size={19} strokeWidth={1.8} />
            <span className="sr-only">关闭</span>
          </button>
        </header>

        <form className="domain-form" aria-busy={isSaving} onSubmit={(event) => void handleSubmit(event)}>
          {templateState === "loading" ? <p role="status">正在读取回顾模板</p> : null}
          {templateState === "error" ? <button className="button-secondary" type="button" onClick={() => { setTemplateState("loading"); setTemplateAttempt(value => value + 1); }}>重试读取模板</button> : null}
          <fieldset className="review-edit-fields" disabled={isSaving || templateState !== "ready"}>
          <div className="planning-form-grid">
            {structure ? <label className="form-field">
              <span>复盘周期</span>
              <select value={structure.type} disabled={isEditing || templateState !== "ready"} onChange={event => changePeriod(event.target.value as ReviewType)}>
                {reviewTypes.map(value => <option key={value} value={value}>{reviewTypeLabels[value]}</option>)}
              </select>
            </label> : null}
            <label className="form-field">
              <span>回顾日期</span>
              <input
                type="date"
                required
                value={draft.reviewedOn}
                onChange={(event) => changeDate(event.target.value)}
              />
            </label>

          </div>
          {structure ? <div className="review-period-meta">
            <p aria-label="复盘起止日期">{structure.start} 至 {structure.end}</p>
            <label><input type="checkbox" checked={structure.status === "completed"} onChange={event => setDraft({ ...draft, structure: { ...structure, status: event.target.checked ? "completed" : "draft" } })} />已完成</label>
          </div> : null}
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

          <details className="review-object-links">
            <summary>关联目标与问题 · {(draft.goalIds?.length ?? 0) + (draft.issueIds?.length ?? 0)}</summary>
            {objectsError ? <p role="alert" className="form-error">{objectsError}<button type="button" className="icon-button" title="重试读取关联对象" onClick={() => setObjectsAttempt(value => value + 1)}><RefreshCw size={16} /></button></p> : null}
            {!objects && !objectsError ? <p role="status">正在读取关联对象</p> : null}
            {objects ? <>
              <label className="form-field"><span>筛选关联对象</span><input type="search" value={objectQuery} onChange={event => setObjectQuery(event.target.value)} /></label>
              {(["goal", "issue"] as const).map(type => {
                const ids = type === "goal" ? draft.goalIds ?? [] : draft.issueIds ?? [];
                const source = type === "goal" ? objects.goals : objects.issues;
                const visible = source.filter(object => ids.includes(object.id) || object.title.toLocaleLowerCase().includes(objectQuery.trim().toLocaleLowerCase()));
                const missing = ids.filter(id => !source.some(object => object.id === id));
                return <fieldset className="form-field" key={type}><legend>{type === "goal" ? "关联目标" : "关联问题"}</legend>
                  <div className="review-object-options">{visible.map(object => <label key={object.id}>
                    <input type="checkbox" checked={ids.includes(object.id)} onChange={event => {
                      const checked = event.target.checked;
                      const key = type === "goal" ? "goalIds" : "issueIds";
                      setDraft(current => ({ ...current, [key]: checked
                        ? [...new Set([...(current[key] ?? []), object.id])]
                        : (current[key] ?? []).filter(id => id !== object.id) }));
                    }} />
                    <span>{object.title}</span>
                  </label>)}
                  {missing.map(id => <label key={id}><input type="checkbox" checked onChange={() => setDraft(current => ({ ...current, [type === "goal" ? "goalIds" : "issueIds"]: (current[type === "goal" ? "goalIds" : "issueIds"] ?? []).filter(value => value !== id) }))} /><span>对象已不存在：{id}</span></label>)}
                  {!visible.length && !missing.length ? <p className="context-summary-empty">暂无匹配的{type === "goal" ? "目标" : "问题"}</p> : null}</div>
                </fieldset>;
              })}
            </> : null}
          </details>
          {structure && structure.type !== "daily" ? <div className="review-fact-controls">
            <button className="button-secondary" type="button" disabled={factState === "loading" || templateState !== "ready"} onClick={() => setFactAttempt(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />汇总事实</button>
            {factState === "loading" ? <span role="status">正在汇总事实</span> : null}
            {factState === "error" && factError ? <p role="alert" className="form-error">{factError}</p> : null}
            {factState === "ready" && omittedFacts > 0 ? <p role="status">还有 {omittedFacts} 条事实未纳入，已达到正文长度上限。</p> : null}
          </div> : null}
          <label className="form-field">
            <span>标题</span>
            <input
              autoFocus
              maxLength={80}
              required
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="例如：重新找回安静的晚上"
            />
          </label>

          {structure ? <>
            {!["daily", "weekly"].includes(structure.type) ? <fieldset className="review-mode-control">
              <legend className="sr-only">书写模式</legend>
              {(["structured", "narrative"] as const).map(mode => <label key={mode}>
                <input type="radio" name="review-mode" value={mode} checked={structure.mode === mode} onChange={() => setDraft({ ...draft, structure: { ...structure, mode } })} />
                {mode === "structured" ? "分区书写" : "叙事书写"}
              </label>)}
            </fieldset> : null}
            <p className="review-template-meta">{structure.template.name} · 版本 {structure.template.version}</p>
            <div className="review-answer-editor">
              {structure.template.fields.map(field => <label className="form-field" key={field.key}>
                <span>{field.label}</span>
                <textarea disabled={templateState !== "ready"} rows={structure.mode === "narrative" ? 8 : 3} maxLength={12000} value={structure.answers[field.key] ?? ""} onChange={event => { touched.current.add(structure.type + ":" + field.key); setDraft({ ...draft, structure: { ...structure, answers: { ...structure.answers, [field.key]: event.target.value } } }); }} />
              </label>)}
            </div>
          </> : null}
          {(!structure || draft.reflection || draft.insight || draft.nextFocus) ? <>
          <label className="form-field">
            <span>回看</span>
            <textarea
              maxLength={1200}
              rows={4}
              value={draft.reflection}
              onChange={(event) => setDraft({ ...draft, reflection: event.target.value })}
              placeholder="这段时间发生了什么？"
            />
          </label>

          <label className="form-field">
            <span>发现</span>
            <textarea
              maxLength={1200}
              rows={3}
              value={draft.insight}
              onChange={(event) => setDraft({ ...draft, insight: event.target.value })}
              placeholder="你注意到了什么？"
            />
          </label>

          <label className="form-field">
            <span>下一处关注</span>
            <textarea
              maxLength={600}
              rows={3}
              value={draft.nextFocus}
              onChange={(event) => setDraft({ ...draft, nextFocus: event.target.value })}
              placeholder="接下来愿意继续照看什么？"
            />
          </label>

          </> : null}
          </fieldset>
          {errorMessage ? <p role="alert" className="form-error">{errorMessage}</p> : null}

          <footer className="dialog-actions">
            <button className="button-secondary" type="button" onClick={() => { if (!submitting.current) onClose(); }} disabled={isSaving}>
              取消
            </button>
            <button className="button-primary" type="submit" disabled={isSaving || templateState !== "ready" || factState === "loading"}>
              {isSaving ? "正在保存" : isEditing ? "保存修改" : "保存回顾"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function getLocalDate(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
