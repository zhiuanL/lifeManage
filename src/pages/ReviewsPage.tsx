import { Pencil, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { ReviewEditorDialog } from "../components/ReviewEditorDialog";
import { TemplateRequestNotice } from "../components/TemplateRequestNotice";
import { useReviewEditorRequest } from "../components/useReviewEditorRequest";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { Review } from "../domain/reviews/Review";

import { reviewTypes, reviewTypeLabels } from "../domain/reviews/ReviewStructure";

interface ReviewData {
  domains: readonly LifeDomain[];
  reviews: readonly Review[];
}

type PageState =
  | { kind: "loading" }
  | { kind: "ready"; data: ReviewData }
  | { kind: "error"; message: string };

export function ReviewsPage() {
  const { lifeDomainService, reviewService } = useLifeOS();
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const mounted = useRef(false);
  const loadGeneration = useRef(0);
  const loadReviewData = useCallback(async (): Promise<PageState> => {
    try {
      const [domains, reviews] = await Promise.all([
        lifeDomainService.list(),
        reviewService.list(),
      ]);
      return { kind: "ready", data: { domains, reviews } };
    } catch {
      return {
        kind: "error",
        message: "无法读取回顾记录，请重试。",
      };
    }
  }, [lifeDomainService, reviewService]);

  const [result, setResult] = useState<{ source: typeof loadReviewData; state: PageState } | null>(null);
  const state = useMemo<PageState>(() =>
    result?.source === loadReviewData ? result.state : { kind: "loading" }, [result, loadReviewData]);
  const requestedDomainId = params.get("domain");
  const availableDomains = state.kind === "ready" ? state.data.domains : [];
  const domainValid = !params.has("domain") || availableDomains.some(domain => domain.id === requestedDomainId);
  const cycle = params.get("cycle") ?? "";
  const status = params.get("status") ?? "";
  const filtersValid = ["", "legacy", ...reviewTypes].includes(cycle) &&
    ["", "draft", "completed"].includes(status);
  const editor = useReviewEditorRequest(state.kind === "ready" && domainValid && filtersValid,
    availableDomains, requestedDomainId ?? undefined);
  const editorOpen = Boolean(editor.editing);
  const editorBlocked = editorOpen || editor.pending;

  const reloadReviewData = useCallback(() => {
    if (!mounted.current) return;
    const generation = ++loadGeneration.current;
    setResult({ source: loadReviewData, state: { kind: "loading" } });
    void loadReviewData().then(nextState => {
      if (mounted.current && generation === loadGeneration.current) setResult({ source: loadReviewData, state: nextState });
    });
  }, [loadReviewData]);

  useEffect(() => {
    mounted.current = true;
    reloadReviewData();
    return () => { mounted.current = false; loadGeneration.current += 1; };
  }, [reloadReviewData]);

  useEffect(() => {
    if (state.kind === "ready" && hash) {
      try { document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "center" }); }
      catch { /* A malformed source link must not interrupt browsing. */ }
    }
  }, [hash, state]);

  function changeFilters(values: Record<string, string | null>, recovery = false) {
    if (editor.editingRef.current || (!recovery && editor.pending)) return;
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    void navigate({ pathname, search: next.toString(), hash }, { preventScrollReset: true });
  }

  function renderContent() {
  if (state.kind === "loading") {
    return <div className="context-loading" aria-live="polite">正在整理你的回顾记录</div>;
  }

  if (state.kind === "error") {
    return (
      <section className="not-found-page">
        <p className="eyebrow">读取失败</p>
        <h1>暂时无法打开回顾</h1>
        <p className="page-intro">{state.message}</p>
        <button className="button-secondary" type="button" onClick={reloadReviewData}>
          重试
        </button>
      </section>
    );
  }

  const { domains, reviews } = state.data;
  if (editor.contextError) return <section className="not-found-page">
    <h1>无法打开这次复盘</h1>
    <p className="page-intro">{editor.contextError}</p>
    <button type="button" className="button-secondary" disabled={editorOpen}
      onClick={() => editor.cancelRequest(true)}>清除失效入口</button>
  </section>;
  if (!domainValid) {
    return <section className="not-found-page">
      <h1>无法按当前领域查看回顾</h1>
      <p className="page-intro">这个领域已不存在或筛选为空。清除筛选后可查看全局记录。</p>
      <button type="button" className="button-secondary" disabled={editorOpen}
        onClick={() => changeFilters({ domain: null }, true)}>清除失效筛选</button>
    </section>;
  }
  if (!filtersValid) return <section className="not-found-page">
    <h1>无法按当前周期或状态查看回顾</h1>
    <p className="page-intro">当前筛选不可用，记录未被修改。</p>
    <button type="button" className="button-secondary" disabled={editorOpen}
      onClick={() => changeFilters({ cycle: null, status: null }, true)}>清除失效状态筛选</button>
  </section>;
  const domainId = requestedDomainId ?? "";
  const domainsById = new Map(domains.map((domain) => [domain.id, domain]));
  const visibleReviews = reviews.filter(review => (!domainId || review.domainIds.includes(domainId))
    && (!cycle || (cycle === "legacy" ? !review.structure : review.structure?.type === cycle))
    && (!status || review.structure?.status === status));

  return (
    <>
      <section className="planning-heading review-heading">
        <div>
          <p className="eyebrow">回顾</p>
          <h1>复盘</h1>

        </div>
        <button className="button-primary" type="button" onClick={() => editor.openEditor()} disabled={editorBlocked}>
          <Plus aria-hidden="true" size={17} strokeWidth={2} />
          记录回顾
        </button>
      </section>

      {editor.pending && editor.templateId ? <>
        <TemplateRequestNotice label="回顾" category="review" message={editor.templateError}
          onRetry={editor.retryTemplate} onCancel={() => editor.cancelRequest()} />
        {!editor.templateError ? <button className="button-secondary" type="button"
          onClick={() => editor.cancelRequest()}>取消模板请求</button> : null}
      </> : null}

      <div className="issue-filters review-filters">
        <label className="issue-filter-domain"><span className="sr-only">按复盘周期筛选</span>
          <select aria-label="按复盘周期筛选" value={cycle} disabled={editorBlocked}
            onChange={event => changeFilters({ cycle: event.target.value })}>
            <option value="">全部周期</option>
            {reviewTypes.map(value => <option key={value} value={value}>{reviewTypeLabels[value]}</option>)}
            <option value="legacy">原有回顾</option>
          </select>
        </label>
        <label className="issue-filter-domain"><span className="sr-only">按复盘状态筛选</span>
          <select aria-label="按复盘状态筛选" value={status} disabled={editorBlocked}
            onChange={event => changeFilters({ status: event.target.value })}>
            <option value="">全部状态</option><option value="draft">草稿</option><option value="completed">已完成</option>
          </select>
        </label>
        <label className="issue-filter-domain">
          <span className="sr-only">按生活领域筛选</span>
          <select aria-label="按生活领域筛选" value={domainId} disabled={editorBlocked}
            onChange={(event) => changeFilters({ domain: event.target.value })}>
            <option value="">全部领域</option>
            {domains.map((domain) =>
              <option key={domain.id} value={domain.id}>{domain.name}</option>)}
          </select>
        </label>
      </div>

      <section className="reviews-section" aria-labelledby="reviews-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">记录</p>
            <h2 id="reviews-heading">回顾记录</h2>
          </div>
          <span className="section-count">{visibleReviews.length}</span>
        </div>

        {visibleReviews.length === 0 ? (
          <div className="planning-empty">
            <p>暂无符合条件的复盘记录。</p>
            <button
              className="button-secondary"
              type="button"
              onClick={() => editor.openEditor()}
              disabled={editorBlocked}
            >
              <Plus aria-hidden="true" size={16} strokeWidth={2} />
              记录回顾
            </button>
          </div>
        ) : (
          <ol className="review-list">
            {visibleReviews.map((review) => (
              <ReviewRow
                key={review.id}
                review={review}
                domains={review.domainIds.flatMap((id) => {
                  const domain = domainsById.get(id);
                  return domain ? [domain] : [];
                })}
                disabled={editorBlocked}
                onEdit={() => editor.openEditor(review)}
              />
            ))}
          </ol>
        )}
      </section>
    </>
  );
  }
  return <>
      {renderContent()}
      {editor.editing ? (
          <ReviewEditorDialog
            review={editor.editing.review}
            template={editor.editing.template}
            useUrlTemplate={false}
            domains={availableDomains}
            defaultDomainId={editor.editing.defaultDomainId}
            initialContext={editor.editing.context}
            onTemplateReady={editor.onTemplateReady}
            onClose={editor.dismissEditor}
            onSaved={() => {
              editor.dismissEditor();
              reloadReviewData();
            }}
          />
      ) : null}
    </>;
}

function ReviewRow({
  review,
  domains,
  onEdit,
  disabled,
}: {
  review: Review;
  domains: readonly LifeDomain[];
  onEdit(): void;
  disabled: boolean;
}) {
  const fields = [
    ...(review.structure?.template.fields.map(field => ({ label: field.label, content: review.structure?.answers[field.key] ?? "" })) ?? []),
    { label: "回看", content: review.reflection },
    { label: "发现", content: review.insight },
    { label: "下一处关注", content: review.nextFocus },
  ].filter((field) => field.content);

  return (
    <li className="review-row" id={`review-${review.id}`}>
      <time className="review-date" dateTime={review.reviewedOn}>
        {formatDate(review.reviewedOn)}
      </time>
      <div className="review-row-main">
        <div className="review-title-line">
          <h3>{review.title}</h3>
          {review.structure ? <span className="review-cycle-label">{reviewTypeLabels[review.structure.type]} · {review.structure.status === "draft" ? "草稿" : "已完成"}</span> : null}
          {domains.map((domain) => (
            <span key={domain.id} className={`domain-meta domain-color-${domain.color}`}>
              <i aria-hidden="true" />{domain.name}
            </span>
          ))}
        </div>
        {review.structure ? <p className="review-period-label">{review.structure.start} 至 {review.structure.end}</p> : null}
        {fields.length > 0 ? (
          <details className="review-content-details">
            <summary>复盘内容 · {fields.length} 项</summary>
          <div className="review-field-list">
            {fields.map((field) => (
              <section className="review-field" key={field.label}>
                <p className="eyebrow">{field.label}</p>
                <p>{field.content}</p>
              </section>
            ))}
          </div>
          </details>
        ) : null}
      </div>
      <Link className="history-link" to={`/history?type=review&id=${encodeURIComponent(review.id)}`}
        title={`查看${review.title}的历史`}>历史</Link>
      <button
        className="icon-button"
        type="button"
        title="编辑回顾"
        aria-label={`编辑回顾：${review.title}`}
        onClick={onEdit}
        disabled={disabled}
      >
        <Pencil aria-hidden="true" size={17} strokeWidth={1.8} />
      </button>
    </li>
  );
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T00:00:00`));
}
