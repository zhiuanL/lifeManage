import { useEffect, useMemo, useState } from "react";

type Source<T> = { list(): Promise<readonly T[]> };
type State<T> = { kind: "loading" } | { kind: "error" } |
  { kind: "ready"; entries: readonly T[] };

export function useTimelineRead<T>(source: Source<T>) {
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState<{
    source: Source<T>; request: number; state: State<T>;
  } | null>(null);
  const state = useMemo<State<T>>(() =>
    result?.source === source && result.request === request ? result.state : { kind: "loading" },
  [result, source, request]);
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const entries = await source.list();
        if (current) setResult({ source, request, state: { kind: "ready", entries } });
      } catch {
        if (current) setResult({ source, request, state: { kind: "error" } });
      }
    })();
    return () => { current = false; };
  }, [source, request]);
  function reload() {
    if (state.kind !== "loading") setRequest(value => value + 1);
  }
  return { state, reload };
}
