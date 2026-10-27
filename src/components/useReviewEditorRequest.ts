import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { Review } from "../domain/reviews/Review";
import { normalizeReviewCreateContext, type ReviewCreateContext } from "../domain/reviews/ReviewCreateContext";
import { cloneTemplateDefaults, reviewStructureFromTemplate, type Template } from "../domain/templates/Template";

interface OpeningRequest {
  key: string;
  templateId: string | null;
  create: boolean;
}
interface ReviewEditor {
  review?: Review;
  template?: Template;
  context?: ReviewCreateContext;
  defaultDomainId?: string;
  request?: OpeningRequest;
}
type RequestError = { key: string; kind: "context" | "template"; message: string };

function readContext(params: URLSearchParams): ReviewCreateContext | undefined {
  if (params.get("create") !== "review" || params.get("template") ||
      (!params.has("reviewType") && !params.has("reviewAnchor") && !params.has("reviewDomain"))) return;
  const selected = params.getAll("reviewDomain");
  return normalizeReviewCreateContext({
    type: params.get("reviewType") ?? "", anchor: params.get("reviewAnchor") ?? "",
    domainIds: selected.length ? selected : params.get("domain") ? [params.get("domain")!] : [],
  });
}

export function useReviewEditorRequest(ready: boolean, domains: readonly LifeDomain[], defaultDomainId?: string) {
  const { templateService } = useLifeOS();
  const [params] = useSearchParams();
  const { pathname, search, hash, key: locationKey } = useLocation();
  const navigate = useNavigate();
  const key = `${locationKey}:${pathname}${search}${hash}`;
  const templateId = params.get("template");
  const hasRequest = Boolean(templateId || params.get("create") === "review");
  const [editing, setEditing] = useState<ReviewEditor | null>(null);
  const editingRef = useRef<ReviewEditor | null>(null);
  const [error, setError] = useState<RequestError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const consumed = useRef<OpeningRequest | undefined>(undefined);

  useEffect(() => {
    if (!ready || editing || !hasRequest || error?.key === key) return;
    let active = true;
    let context: ReviewCreateContext | undefined;
    try {
      context = readContext(params);
      if (context?.domainIds.some(id => !domains.some(domain => domain.id === id))) {
        void Promise.resolve().then(() => {
          if (active) setError({ key, kind: "context", message: "复盘入口中的领域已不存在，请重新选择。" });
        });
        return () => { active = false; };
      }
    } catch {
      void Promise.resolve().then(() => {
        if (active) setError({ key, kind: "context", message: "复盘入口的周期、日期或领域无效，请重新打开。" });
      });
      return () => { active = false; };
    }
    const request: OpeningRequest = { key, templateId, create: params.get("create") === "review" };
    const open = (template?: Template) => {
      if (!active || editingRef.current) return;
      const next = { template, context, defaultDomainId, request };
      editingRef.current = next;
      setEditing(next);
    };
    if (!templateId) void Promise.resolve().then(() => open());
    else void Promise.resolve().then(() => templateService.find(templateId)).then(template => {
      if (!active) return;
      if (!template || template.category !== "review") {
        setError({ key, kind: "template", message: "回顾模板已不存在或类型不符，请重新选择。" });
        return;
      }
      const snapshot = { ...template, defaults: cloneTemplateDefaults(template.defaults) };
      // Validate the snapshot without treating this reference date as an instance fact.
      reviewStructureFromTemplate(snapshot, "2000-01-01");
      open(snapshot);
    }).catch(() => {
      if (active) setError({ key, kind: "template",
        message: "回顾模板读取或校验失败，请重试或在模板中心调整。" });
    });
    return () => { active = false; };
  }, [ready, editing, hasRequest, key, templateId, params, domains, defaultDomainId, error, attempt, templateService]);

  const consumeOpening = useCallback(() => {
    const request = editing?.request;
    if (!request || consumed.current === request || request.key !== key) return;
    consumed.current = request;
    const next = new URLSearchParams(params);
    if (request.templateId) next.delete("template");
    if (request.create) next.delete("create");
    void navigate({ pathname, search: next.toString(), hash },
      { replace: true, preventScrollReset: true });
  }, [editing, key, params, pathname, hash, navigate]);

  function cancelRequest(clearContext = false) {
    const next = new URLSearchParams(params);
    next.delete("template");
    if (next.get("create") === "review") next.delete("create");
    if (clearContext) for (const name of ["reviewType", "reviewAnchor", "reviewDomain"]) next.delete(name);
    void navigate({ pathname, search: next.toString(), hash },
      { replace: true, preventScrollReset: true });
  }
  function dismissEditor() {
    // Cancel only the request that opened this form, not a newer same-page choice.
    consumeOpening();
    editingRef.current = null;
    setEditing(null);
  }
  function openEditor(review?: Review) {
    if (!ready || editingRef.current || hasRequest) return;
    const next = { review, defaultDomainId };
    editingRef.current = next;
    setEditing(next);
  }
  const currentError = error?.key === key ? error : null;
  return {
    editing, editingRef, openEditor, dismissEditor, onTemplateReady: consumeOpening,
    pending: !editing && hasRequest,
    templateId, templateError: currentError?.kind === "template" ? currentError.message : null,
    contextError: currentError?.kind === "context" ? currentError.message : null,
    retryTemplate: () => { setError(null); setAttempt(value => value + 1); },
    cancelRequest,
  };
}
