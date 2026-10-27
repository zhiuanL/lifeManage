import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import type { NavigationPreferenceUpdate } from "../domain/system/NavigationPreference";

export function useNavigationPreferenceCommand() {
  const { updateNavigationPreference } = useLifeOS();
  const [busy, setBusy] = useState(false);
  const source = useMemo(() => ({ save: updateNavigationPreference }), [updateNavigationPreference]);
  const current = useRef(source);
  const [command, setCommand] = useState<{
    source: typeof source; change: NavigationPreferenceUpdate; failed: boolean;
  } | null>(null);
  const [savedSource, setSavedSource] = useState<typeof source | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => { current.current = source; }, [source]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function save(next: NonNullable<typeof command>) {
    if (submitting.current || !mounted.current || !next.source.save) return;
    submitting.current = true; setBusy(true); setSavedSource(null);
    setCommand({ ...next, failed: false });
    try {
      await next.source.save(next.change);
      if (mounted.current) {
        setCommand(null);
        if (current.current === next.source) setSavedSource(next.source);
      }
    } catch {
      if (mounted.current) setCommand({ ...next, failed: true });
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return {
    run: (change: NavigationPreferenceUpdate) => {
      if (command && command.source !== source) return Promise.resolve();
      return save({ source, change, failed: false });
    },
    retry: () => command ? save(command) : Promise.resolve(),
    cancel: () => { if (!submitting.current && mounted.current) setCommand(null); },
    busy,
    disabled: busy || !updateNavigationPreference || Boolean(command && command.source !== source),
    error: command?.failed ? "导航设置保存失败，请重试。" : "",
    saved: savedSource === source,
  };
}
