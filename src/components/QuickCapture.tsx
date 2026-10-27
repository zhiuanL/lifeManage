import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import { InboxValidationError } from "../domain/inbox/InboxItem";

export const inboxChangedEvent = "lifeos:inbox-changed";

export function QuickCapture({ onClose }: { onClose(): void }) {
  const { inboxService: currentService } = useLifeOS();
  const [inboxService] = useState(() => currentService);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const closeCallback = useRef(onClose);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { closeCallback.current = onClose; }, [onClose]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !savingRef.current) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || !mounted.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await inboxService.capture(content, "quick-capture");
      if (mounted.current) {
        window.dispatchEvent(new Event(inboxChangedEvent));
        closeCallback.current();
      }
    } catch (reason) {
      if (mounted.current) setError(reason instanceof InboxValidationError
        ? reason.message : "暂时无法保存，请重试。");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <div className="capture-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !savingRef.current) onClose();
    }}>
      <section className="capture-composer" role="dialog" aria-modal="true" aria-labelledby="capture-title">
        <header className="capture-header">
          <h2 id="capture-title">快速记录</h2>
          <button className="icon-button" type="button" title="关闭" aria-label="关闭"
            disabled={saving} onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <form aria-busy={saving} onSubmit={(event) => void submit(event)}>
          <label className="sr-only" htmlFor="capture-content">记录内容</label>
          <textarea id="capture-content" autoFocus maxLength={4000} rows={4} disabled={saving}
            value={content} onChange={(event) => { if (!savingRef.current) setContent(event.target.value); }}
            placeholder="想到什么，就先记下来…" />
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <footer className="capture-footer">
            <span>收集箱</span>
            <button className="button-primary" type="submit" disabled={saving || !content.trim()}>
              {saving ? "保存中" : "保存"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
