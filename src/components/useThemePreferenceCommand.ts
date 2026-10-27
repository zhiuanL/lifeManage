import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import type { ThemeKey } from "../domain/life/ThemePreference";

export function useThemePreferenceCommand() {
  const { setTheme } = useLifeOS();
  const source = useMemo(() => ({ save: setTheme }), [setTheme]);
  const current = useRef(source);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState<{
    source: typeof source; theme: ThemeKey; failed: boolean;
  } | null>(null);
  useLayoutEffect(() => { current.current = source; }, [source]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function save(next: NonNullable<typeof command>) {
    if (submitting.current || !mounted.current) return false;
    submitting.current = true;
    setBusy(true);
    setCommand({ ...next, failed: false });
    try {
      await next.source.save(next.theme);
      if (mounted.current) setCommand(null);
      return mounted.current && current.current === next.source;
    } catch {
      if (mounted.current) setCommand({ ...next, failed: true });
      return false;
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return {
    busy,
    disabled: busy || Boolean(command && command.source !== source),
    pendingTheme: command?.theme,
    error: command?.failed ? "主题保存失败，请重试。" : "",
    select: (theme: ThemeKey) => {
      if (command && command.source !== source) return Promise.resolve(false);
      return save({ source, theme, failed: false });
    },
    retry: () => command ? save(command) : Promise.resolve(false),
    cancel: () => {
      if (!submitting.current && mounted.current) setCommand(null);
    },
  };
}
