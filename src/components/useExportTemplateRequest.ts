import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { exportDraftDefaults, type ExportDraftDefaults } from "../domain/export/ExportTemplate";
import { validateTemplate } from "../domain/templates/Template";

type RequestSource = {
  key: string; templateService: ReturnType<typeof useLifeOS>["templateService"]; attempt: number;
};
type RequestState =
  | { source: RequestSource; kind: "loading" }
  | { source: RequestSource; kind: "error"; message: string }
  | { source: RequestSource; kind: "ready"; name: string; defaults: ExportDraftDefaults };

export function useExportTemplateRequest(
  ready: boolean, busy: boolean, draftStarted: boolean,
  onApply: (defaults: ExportDraftDefaults) => void,
  domainId: string | null,
) {
  const { templateService } = useLifeOS();
  const [params] = useSearchParams();
  const { pathname, search, hash, key: locationKey } = useLocation();
  const navigate = useNavigate();
  const templateId = params.get("template");
  const hasTemplate = params.has("template");
  const key = `${locationKey}:${pathname}${search}${hash}`;
  const [request, setRequest] = useState<RequestState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const source = useMemo(() => ({ key, templateService, attempt }), [key, templateService, attempt]);
  const handled = useRef<RequestState | null>(null);

  useEffect(() => {
    if (!hasTemplate || !ready || busy) return;
    let active = true;
    void Promise.resolve().then(() => templateId ? templateService.find(templateId) : null).then(template => {
      if (!active) return;
      if (!templateId) {
        setRequest({ source, kind: "error", message: "导出模板链接无效，请取消请求后重新选择。" });
        return;
      }
      if (!template || template.category !== "export") {
        setRequest({ source, kind: "error", message: "导出模板已不存在或类型不符，请重新选择。" });
        return;
      }
      const checked = validateTemplate("export", template.name, template.defaults);
      const defaults = exportDraftDefaults(checked.defaults);
      setRequest({ source, kind: "ready", name: checked.name, defaults });
    }).catch(() => {
      if (active) setRequest({ source, kind: "error",
        message: "导出模板读取或校验失败，请重试或在模板中心调整。" });
    });
    return () => { active = false; };
  }, [templateId, hasTemplate, source, ready, busy, templateService]);

  const current = hasTemplate && request?.source === source ? request : null;
  const consume = useCallback(() => {
    const next = new URLSearchParams(search);
    next.delete("template");
    if (!next.has("domain") && domainId !== null) next.set("domain", domainId);
    void navigate({ pathname, search: next.toString(), hash },
      { replace: true, preventScrollReset: true });
  }, [search, domainId, pathname, hash, navigate]);
  function applyTemplate() {
    if (!ready || busy || current?.kind !== "ready" || handled.current === current) return;
    handled.current = current;
    onApply(current.defaults);
    consume();
  }
  useEffect(() => {
    if (!ready || busy || draftStarted || current?.kind !== "ready" ||
        handled.current === current) return;
    handled.current = current;
    onApply(current.defaults);
    consume();
  }, [ready, busy, draftStarted, current, onApply, consume]);

  return {
    pending: hasTemplate,
    templateName: current?.kind === "ready" ? current.name : null,
    templateError: current?.kind === "error" ? current.message : null,
    applyTemplate,
    retryTemplate: () => setAttempt(value => value + 1),
    cancelRequest: () => { handled.current = current; consume(); },
  };
}
