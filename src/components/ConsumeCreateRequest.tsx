import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const requests = {
  goals: ["goal", "action"],
  reviews: ["review"],
  issues: ["issue"],
  decisions: ["decision"],
  habits: ["habit"],
} as const;

export function ConsumeCreateRequest({ capability, children, enabled = true }: {
  capability: keyof typeof requests;
  children: ReactNode;
  enabled?: boolean;
}) {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!enabled) return;
    const params = new URLSearchParams(search);
    const request = params.get("create");
    if (!request || !requests[capability].some(kind => kind === request)) return;
    params.delete("create");
    // Mount only with the editor; preserve its template and source context.
    void navigate({ pathname, search: params.toString(), hash },
      { replace: true, preventScrollReset: true });
  }, [capability, pathname, search, hash, navigate, enabled]);

  return children;
}
