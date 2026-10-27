import { ArrowUpRight, NotebookPen, Plus, RotateCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import type { AppShellOutletContext } from "../app/AppShell";
import { useLifeOS } from "../app/LifeOSContext";
import { findSearchCommands, searchCommandTarget, type SearchCommand } from "../app/searchCommands";
import { defaultModulePreference } from "../domain/system/ModulePreference";
import {
  searchEntries, searchTypes, searchTypeLabels, type SearchEntry, type SearchFilter,
  type SearchType,
} from "../domain/search/Search";

const statuses = [
  ["", "所有状态"], ["active", "进行中"], ["open", "未完成／待处理"],
  ["candidate", "候选"], ["abandoned", "放弃"],
  ["paused", "已暂停"], ["completed", "已完成"], ["watching", "观察中"],
  ["resolved", "已解决"], ["considering", "考虑中"], ["decided", "已决定"],
  ["unprocessed", "待整理"], ["processing", "整理中"], ["organized", "已整理"],
  ["archived", "已归档"],
  ["inactive", "已停用"],
] as const;

export function SearchPage() {
  const { searchService, lifeDomainService,
    modulePreference = defaultModulePreference() } = useLifeOS();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const shell = useOutletContext<AppShellOutletContext | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const commandList = useRef<HTMLUListElement>(null);
  const [revision, setRevision] = useState(0);
  const source = useMemo(() => ({ searchService, lifeDomainService, revision }),
    [searchService, lifeDomainService, revision]);
  type ReadState = { kind: "loading" } | { kind: "error" } | {
    kind: "ready"; entries: readonly SearchEntry[]; domains: readonly { id: string; name: string }[];
  };
  const [result, setResult] = useState<{ source: typeof source; state: ReadState } | null>(null);
  const state: ReadState = result?.source === source ? result.state : { kind: "loading" };
  const entries = state.kind === "ready" ? state.entries : null;
  const domains = state.kind === "ready" ? state.domains : [];
  const [filter, setFilter] = useState<Omit<SearchFilter, "query" | "domainId">>({
    types: [...searchTypes], from: "", to: "", status: "",
  });
  const domainId = params.get("domain") ?? "";
  const invalidDomain = state.kind === "ready" && params.has("domain") &&
    (!domainId || !domains.some(domain => domain.id === domainId));
  const query = params.get("q") ?? "";
  const commandMatch = findSearchCommands(query, modulePreference);
  useEffect(() => {
    let current = true;
    void Promise.all([source.searchService.list(), source.lifeDomainService.list()])
      .then(([items, domainItems]) => {
        if (current) setResult({ source, state: { kind: "ready", entries: items, domains: domainItems } });
      })
      .catch(() => { if (current) setResult({ source, state: { kind: "error" } }); });
    return () => { current = false; };
  }, [source]);
  useEffect(() => { input.current?.focus(); }, []);

  const commandsBlocked = params.has("domain") && (state.kind !== "ready" || invalidDomain);
  const executeCommand = (command: SearchCommand) => {
    if (commandsBlocked) return;
    if (command.kind === "capture") {
      shell?.openQuickCapture();
    } else {
      navigate(searchCommandTarget(command, domainId));
    }
  };
  const focusCommand = (index: number) => {
    const buttons = commandList.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    if (!buttons?.length) return;
    buttons[(index + buttons.length) % buttons.length].focus();
  };

  const toggleType = (type: SearchType) => setFilter((current) => ({
    ...current,
    types: current.types.includes(type) ?
      current.types.filter((candidate) => candidate !== type) : [...current.types, type],
  }));
  let results: SearchEntry[] = [];
  let filterError = "";
  if (entries && !invalidDomain && commandMatch.mode !== "commands") {
    try { results = searchEntries(entries, { ...filter, query, domainId }); } catch (reason) {
      filterError = reason instanceof Error ? reason.message : "搜索条件无效。";
    }
  }
  function updateParams(update: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(location.search);
    update(next);
    navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, { replace: true });
  }

  return <section className="search-page">
    <header className="planning-heading">
      <div><p className="eyebrow">全局检索</p><h1>搜索</h1></div>
      <button className="icon-button" type="button" title="刷新搜索"
        aria-label="刷新搜索" disabled={state.kind === "loading"}
        onClick={() => { if (state.kind !== "loading") setRevision(value => value + 1); }}><RotateCw size={18} /></button>
    </header>
    <label className="search-query">
      <Search aria-hidden="true" size={19} />
      <input ref={input} aria-label="搜索本地记录" value={query} placeholder="搜索标题和内容"
        onChange={(event) => {
          const value = event.target.value;
          updateParams(next => { if (value) next.set("q", value); else next.delete("q"); });
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229 ||
            !commandMatch.commands.length) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            focusCommand(event.key === "ArrowDown" ? 0 : -1);
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (commandMatch.commands.length === 1) executeCommand(commandMatch.commands[0]);
            else focusCommand(0);
          }
        }} />
    </label>
    {commandMatch.mode !== "none" ? <section className="search-command-section" aria-label="操作候选">
      <h2>操作</h2>
      {commandMatch.commands.length === 0 ? <p className="planning-empty">没有匹配的操作。</p> :
        <ul className="search-commands" ref={commandList}>
          {commandMatch.commands.map((command, index) => {
            const Icon = command.kind === "capture" ? NotebookPen :
              command.kind === "create" ? Plus : ArrowUpRight;
            return <li key={command.id}>
              <button type="button" disabled={commandsBlocked || (command.kind === "capture" && !shell)}
                onClick={() => executeCommand(command)} onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    focusCommand(index + (event.key === "ArrowDown" ? 1 : -1));
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    input.current?.focus();
                  }
                }}>
                <Icon size={17} aria-hidden="true" /><span>{command.label}</span>
              </button>
            </li>;
          })}
        </ul>}
    </section> : null}
    <div className="search-filters">
      <label>起始日期<input type="date" value={filter.from}
        onChange={(event) => setFilter({ ...filter, from: event.target.value })} /></label>
      <label>结束日期<input type="date" value={filter.to}
        onChange={(event) => setFilter({ ...filter, to: event.target.value })} /></label>
      <label>状态<select value={filter.status}
        onChange={(event) => setFilter({ ...filter, status: event.target.value })}>
        {statuses.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select></label>
      <label>生活领域<select value={domainId} disabled={state.kind !== "ready"}
        onChange={(event) => {
          const value = event.target.value;
          if (state.kind !== "ready") return;
          updateParams(next => { if (value) next.set("domain", value); else next.delete("domain"); });
        }}>
        <option value="">全部领域</option>
        {domainId && !domains.some(domain => domain.id === domainId) ? <option value={domainId} disabled>链接领域不可用</option> : null}
        {domains.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
    </div>
    <fieldset className="search-type-filter"><legend>记录类型</legend>
      {searchTypes.map((type) => <label key={type}>
        <input type="checkbox" checked={filter.types.includes(type)}
          onChange={() => toggleType(type)} />{searchTypeLabels[type]}
      </label>)}
    </fieldset>
    {invalidDomain ? <div><p role="alert">链接中的领域不可用，请明确清除领域筛选后继续。</p>
      <button type="button" className="button-secondary"
        onClick={() => updateParams(next => next.delete("domain"))}>清除领域筛选</button></div> : null}
    {state.kind === "error" ? <p role="alert">无法读取本地记录，请点击刷新重试。已有记录不会被修改。</p> : null}
    {commandMatch.mode === "commands" || invalidDomain || state.kind === "error" ? null :
      filterError ? <p role="alert">{filterError}</p> :
      entries === null ? <p>正在读取本地记录…</p> :
        <div aria-live="polite">
          <p className="search-count">{results.length} 条结果</p>
          {results.length === 0 ? <p className="planning-empty">没有符合条件的记录。</p> :
            <ul className="search-results">{results.map((entry) => <li key={`${entry.type}:${entry.id}`}>
              <Link to={entry.href}><strong>{entry.title}</strong>
                <span>{searchTypeLabels[entry.type]} · {entry.date}</span></Link>
            </li>)}</ul>}
        </div>}
  </section>;
}
