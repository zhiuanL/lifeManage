import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { decisionDraftDefaults } from "../domain/decisions/DecisionTemplate";
import { issueDraftDefaults } from "../domain/issues/IssueTemplate";
import { goalDraftDefaults } from "../domain/planning/GoalTemplate";
import { validateTemplate, type Template } from "../domain/templates/Template";

type Category = "issue" | "decision" | "goal";
type Request = { templateId: string | null; create: boolean; supersededAction?: boolean };
type Editor<T> = { object?: T; template?: Template; request?: Request };

export function useTemplateEditorRequest<T>(category: Category, ready: boolean, busy = false, consumeReady = true) {
  const { templateService } = useLifeOS();
  const [params] = useSearchParams();
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();
  const templateId = params.get("template");
  const [editing, updateEditing] = useState<Editor<T> | null>(null);
  const editorOpen = useRef<Editor<T> | null>(null);
  const setEditing = useCallback<Dispatch<SetStateAction<Editor<T> | null>>>((next) => {
    const value = typeof next === "function" ? next(editorOpen.current) : next;
    editorOpen.current = value;
    updateEditing(value);
  }, []);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const consumed = useRef<Request | undefined>(undefined);
  const label = category === "issue" ? "问题" : category === "goal" ? "目标" : "决策";
  useEffect(() => {
    if (!ready || busy || editing) return;
    if (!templateId) {
      let active = true;
      if (params.get("create") === category) {
        void Promise.resolve().then(() => {
          if (active && !editorOpen.current) setEditing({ request: { templateId: null, create: true } });
        });
      }
      return () => { active = false; };
    }
    if (error?.id === templateId) return;
    let active = true;
    void templateService.find(templateId).then(template => {
      if (!active || editorOpen.current) return;
      if (!template || template.category !== category) {
        setError({ id: templateId, message: `${label}模板已不存在或类型不符，请重新选择。` });
        return;
      }
      const checked = validateTemplate(category, template.name, template.defaults);
      if (category === "issue") {
        try { issueDraftDefaults(checked.defaults); }
        catch {
          setError({ id: templateId, message: "问题模板文字超过字段上限，请先在模板中心调整后重试。" });
          return;
        }
      } else if (category === "goal") goalDraftDefaults(checked.defaults);
      else decisionDraftDefaults(checked.defaults);
      setEditing({ template: { ...template, defaults: checked.defaults },
        request: { templateId, create: params.get("create") === category,
          supersededAction: category === "goal" && params.get("create") === "action" } });
    }).catch(() => {
      if (active) setError({ id: templateId, message: `${label}模板读取或校验失败，请重试或重新选择。` });
    });
    return () => { active = false; };
  }, [ready, busy, editing, templateId, category, label, params, error, attempt, templateService, setEditing]);
  useLayoutEffect(() => {
    const request = editing?.request;
    if (!ready || !consumeReady || !request || consumed.current === request) return;
    consumed.current = request;
    // Consume only the request that opened this draft, preserving newer choices.
    if (params.get("template") !== request.templateId) return;
    const next = new URLSearchParams(params);
    if (request.templateId) next.delete("template");
    if (request.create && next.get("create") === category) next.delete("create");
    if (request.supersededAction && next.get("create") === "action") next.delete("create");
    if (next.toString() !== params.toString()) {
      void navigate({ pathname, search: next.toString(), hash }, { replace: true, preventScrollReset: true });
    }
  }, [ready, consumeReady, editing, params, category, pathname, hash, navigate]);

  function cancelRequest() {
    const next = new URLSearchParams(params);
    next.delete("template");
    if (next.get("create") === category) next.delete("create");
    if (category === "goal" && templateId && next.get("create") === "action") next.delete("create");
    void navigate({ pathname, search: next.toString(), hash }, { replace: true, preventScrollReset: true });
  }
  function dismissEditor() {
    const request = editing?.request;
    // An editor cancelled during default-template loading must not reopen itself.
    if (request && params.get("template") === request.templateId) {
      const next = new URLSearchParams(params);
      if (request.templateId) next.delete("template");
      if (request.create && next.get("create") === category) next.delete("create");
      if (request.supersededAction && next.get("create") === "action") next.delete("create");
      if (next.toString() !== params.toString()) {
        void navigate({ pathname, search: next.toString(), hash }, { replace: true, preventScrollReset: true });
      }
    }
    setEditing(null);
  }
  return {
    editing, setEditing, editorOpen, templateId,
    templateError: templateId && error?.id === templateId ? error.message : null,
    retryTemplate: () => { setError(null); setAttempt(value => value + 1); },
    cancelRequest, dismissEditor,
  };
}

