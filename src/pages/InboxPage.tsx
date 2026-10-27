import { Archive, ArrowUpRight, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { InboxConvertDialog } from "../components/InboxConvertDialog";
import { inboxChangedEvent } from "../components/QuickCapture";
import { InboxValidationError, inboxTargetHref, inboxTargetLabels, suggestInboxTarget, type InboxItem } from "../domain/inbox/InboxItem";
import type { LifeDomain } from "../domain/life/LifeDomain";
import type { Goal } from "../domain/planning/Goal";

type InboxData = {
  items: readonly InboxItem[];
  domains: readonly LifeDomain[];
  goals: readonly Goal[];
};
type PageState =
  | { kind: "loading" }
  | { kind: "ready"; data: InboxData }
  | { kind: "error"; message: string };
type Tab = "pending" | "organized" | "archived";
type ConversionSession = { item: InboxItem; domains: InboxData["domains"]; goals: InboxData["goals"] };

export function InboxPage() {
  const { inboxService, lifeDomainService, goalService } = useLifeOS();
  const { hash } = useLocation();
  const [tab, setTab] = useState<Tab>("pending");
  const [ignoredHash, setIgnoredHash] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [selected, setSelected] = useState<ConversionSession | null>(null);
  const editorOpen = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const sourceEpoch = useRef(0);
  let hashId = "";
  if (hash.startsWith("#inbox-")) {
    try {
      hashId = decodeURIComponent(hash.slice("#inbox-".length));
    } catch {
      // Ignore malformed links without interrupting capture or browsing.
    }
  }

  const load = useCallback(async (): Promise<PageState> => {
    try {
      const [items, domains, goals] = await Promise.all([
        inboxService.list(), lifeDomainService.list(), goalService.list(),
      ]);
      return { kind: "ready", data: { items, domains, goals } };
    } catch {
      return { kind: "error", message: "无法读取收集箱，请重试。" };
    }
  }, [goalService, inboxService, lifeDomainService]);

  const [result, setResult] = useState<{ source: typeof load; state: PageState } | null>(null);
  const state: PageState = result?.source === load ? result.state : { kind: "loading" };
  const linkedItem = state.kind === "ready" && hash !== ignoredHash
    ? state.data.items.find((item) => item.id === hashId) : null;
  const activeTab: Tab = linkedItem?.status === "organized" ? "organized" :
    linkedItem?.status === "archived" ? "archived" : linkedItem ? "pending" : tab;

  const reload = useCallback(() => {
    if (!mounted.current) return;
    const request = ++generation.current;
    setResult({ source: load, state: { kind: "loading" } });
    void load().then(next => {
      if (mounted.current && request === generation.current) setResult({ source: load, state: next });
    });
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);
  useEffect(() => {
    sourceEpoch.current += 1;
    const request = ++generation.current;
    void load().then(next => {
      if (mounted.current && request === generation.current) setResult({ source: load, state: next });
    });
    window.addEventListener(inboxChangedEvent, reload);
    return () => {
      sourceEpoch.current += 1; generation.current += 1;
      window.removeEventListener(inboxChangedEvent, reload);
    };
  }, [load, reload]);
  useEffect(() => {
    if (linkedItem) document.getElementById(`inbox-${linkedItem.id}`)?.scrollIntoView({ block: "center" });
  }, [linkedItem]);

  async function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || editorOpen.current || !mounted.current) return;
    const source = sourceEpoch.current;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await inboxService.capture(content);
      if (!mounted.current || source !== sourceEpoch.current) return;
      setContent("");
      setIgnoredHash(hash);
      setTab("pending");
      reload();
    } catch (reason) {
      if (mounted.current && source === sourceEpoch.current) setError(reason instanceof InboxValidationError
        ? reason.message : "保存失败，请重试。");
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function changeStatus(item: InboxItem) {
    if (busyRef.current || editorOpen.current || !mounted.current) return;
    const source = sourceEpoch.current;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      if (item.status === "archived") await inboxService.restore(item.id);
      else await inboxService.archive(item.id);
      if (mounted.current && source === sourceEpoch.current) reload();
    } catch (reason) {
      if (mounted.current && source === sourceEpoch.current) setError(reason instanceof InboxValidationError
        ? reason.message : "更新失败，请重试。");
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const locked = busy || Boolean(selected);
  const canInteract = () => mounted.current && !busyRef.current && !editorOpen.current;
  const closeEditor = () => {
    if (!mounted.current) return;
    editorOpen.current = false; setSelected(null);
  };
  const editorDialog = selected ? <InboxConvertDialog key={selected.item.id} {...selected}
    onClose={() => closeEditor()}
    onStatusChanged={(updated) => {
      if (!mounted.current) return;
      setSelected(current => current?.item.id === updated.id ? { ...current, item: updated } : current);
      reload();
    }}
    onSaved={() => { closeEditor(); reload(); }} /> : null;
  const renderPage = (content: ReactNode) => <>{content}{editorDialog}</>;
  if (state.kind === "loading") {
    return renderPage(<div className="context-loading" aria-live="polite">正在打开收集箱</div>);
  }
  if (state.kind === "error") {
    return renderPage(<section className="not-found-page">
      <p className="eyebrow">读取失败</p>
      <h1>暂时无法打开收集箱</h1>
      <p className="page-intro">{state.message}</p>
      <button className="button-secondary" type="button" disabled={busy} onClick={reload}>重试</button>
    </section>);
  }

  const { items, domains, goals } = state.data;
  const visible = items.filter((item) => activeTab === "pending"
    ? item.status === "unprocessed" || item.status === "processing"
    : item.status === activeTab);
  const count = (kind: Tab) => items.filter((item) => kind === "pending"
    ? item.status === "unprocessed" || item.status === "processing"
    : item.status === kind).length;

  return renderPage(
    <>
      <section className="inbox-heading">
        <p className="eyebrow">收集箱</p>
        <h1>先留下，再决定去向</h1>
      </section>

      <form className="inbox-input" aria-busy={busy} onSubmit={(event) => void capture(event)}>
        <label className="sr-only" htmlFor="inbox-content">记录内容</label>
        <textarea id="inbox-content" maxLength={4000} rows={3} disabled={locked}
          value={content} onChange={(event) => { if (canInteract()) setContent(event.target.value); }}
          placeholder="写下此刻想到的事…" />
        <div className="inbox-input-footer">
          <span>无需先分类</span>
          <button className="button-primary" type="submit" disabled={locked || !content.trim()}>
            {busy ? "保存中" : "收下"}
          </button>
        </div>
      </form>

      <section className="inbox-section" aria-label="收集记录">
        <div className="inbox-tabs" role="tablist" aria-label="记录状态">
          {([
            { value: "pending", label: "待整理" },
            { value: "organized", label: "已整理" },
            { value: "archived", label: "已归档" },
          ] as const).map(({ value, label }) => (
            <button key={value} role="tab" type="button" aria-selected={activeTab === value} disabled={locked}
              className={activeTab === value ? "inbox-tab selected" : "inbox-tab"}
              onClick={() => { if (canInteract()) { setIgnoredHash(hash); setTab(value); setError(null); } }}>
              {label} <span>{count(value)}</span>
            </button>
          ))}
        </div>
        {error ? <p className="form-error inbox-error" role="alert">{error}</p> : null}
        {visible.length === 0 ? (
          <p className="inbox-empty">{activeTab === "pending" ? "这里暂时很安静。" : "这里还没有记录。"}</p>
        ) : (
          <ol className="inbox-list">
            {visible.map((item) => {
              const suggestion = item.status === "unprocessed"
                ? suggestInboxTarget(item.content) : null;
              return <li className="inbox-row" id={`inbox-${item.id}`} key={item.id}>
                <div className="inbox-row-body">
                  <time dateTime={item.createdAt}>
                    {new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })
                      .format(new Date(item.createdAt))}
                  </time>
                  <p>{item.content}</p>
                  {item.status === "processing" ? (
                    <span className="inbox-hint">上次整理未完成，可以继续</span>
                  ) : suggestion ? (
                    <span className="inbox-hint">可能适合整理为{inboxTargetLabels[suggestion.type]} · {suggestion.reason}</span>
                  ) : null}
                </div>
                <div className="inbox-row-actions">
                  {item.status === "unprocessed" || item.status === "processing" ? (
                    <button className="button-secondary" type="button" disabled={locked} onClick={() => {
                      if (!canInteract()) return;
                      editorOpen.current = true; setSelected({ item, domains, goals });
                    }}>
                      {item.status === "processing" ? "继续整理" : "整理"}
                    </button>
                  ) : null}
                  {item.status === "unprocessed" || item.status === "archived" ? (
                    <button className="icon-button" type="button" disabled={locked}
                      title={item.status === "archived" ? "恢复记录" : "归档记录"}
                      aria-label={item.status === "archived" ? "恢复记录" : "归档记录"}
                      onClick={() => void changeStatus(item)}>
                      {item.status === "archived" ? <RotateCcw size={16} aria-hidden="true" />
                        : <Archive size={16} aria-hidden="true" />}
                    </button>
                  ) : null}
                  {item.status === "organized" && item.targetType && item.targetId ? (
                    <Link className="inbox-target-link"
                      to={inboxTargetHref(item.targetType, item.targetId)}>
                      查看{inboxTargetLabels[item.targetType]} <ArrowUpRight aria-hidden="true" size={15} />
                    </Link>
                  ) : null}
                </div>
              </li>;
            })}
          </ol>
        )}
      </section>

    </>
  );
}

