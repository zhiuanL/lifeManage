import { ArrowUpRight, Check, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { inboxTargetLabels, suggestInboxTarget, type InboxItem, type InboxTarget } from "../domain/inbox/InboxItem";
import { suggestInboxDates, type InboxObjectSuggestion } from "../domain/inbox/InboxSuggestions";

type ObjectState =
  | { kind: "loading" }
  | { kind: "ready"; items: readonly InboxObjectSuggestion[] }
  | { kind: "error" };

export function InboxSuggestions({
  item, type, date, domainIds, goalId, personId, availableDomainIds, availableGoalIds,
  availablePersonIds, disabled, onDate, onDomain, onGoal, onPerson, onOpen,
}: {
  item: InboxItem;
  type: InboxTarget;
  date: string;
  domainIds: readonly string[];
  goalId: string | null;
  personId: string | null;
  availableDomainIds: readonly string[];
  availableGoalIds: readonly string[];
  availablePersonIds: readonly string[];
  disabled: boolean;
  onDate(date: string): void;
  onDomain(id: string): void;
  onGoal(id: string): void;
  onPerson(id: string): void;
  onOpen(): void;
}) {
  const { inboxService } = useLifeOS();
  const [state, setState] = useState<ObjectState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const dates = suggestInboxDates(item.content, item.createdAt);
  const target = suggestInboxTarget(item.content);
  const supportsGoal = type === "action" || type === "issue" || type === "decision" || type === "event";

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const items = await inboxService.suggestObjects(item.content);
        if (active) setState({ kind: "ready", items });
      } catch {
        if (active) setState({ kind: "error" });
      }
    }
    void load();
    return () => { active = false; };
  }, [inboxService, item.content, attempt]);

  function objectRow(suggestion: InboxObjectSuggestion) {
    const canApply = (suggestion.type === "domain" && availableDomainIds.includes(suggestion.id)) ||
      (suggestion.type === "goal" && supportsGoal && availableGoalIds.includes(suggestion.id)) ||
      (suggestion.type === "person" && type === "event" && availablePersonIds.includes(suggestion.id));
    const applied = suggestion.type === "domain" ? domainIds.includes(suggestion.id)
      : suggestion.type === "goal" ? goalId === suggestion.id : personId === suggestion.id;
    return <li key={`${suggestion.type}:${suggestion.id}`}>
      <div className="inbox-suggestion-copy">
        <span>{suggestion.type === "domain" ? "领域" : inboxTargetLabels[suggestion.type]} · {suggestion.name}
          {suggestion.state ? `（${suggestion.state}）` : ""}</span>
        <small>{suggestion.reason}</small>
      </div>
      <div className="inbox-suggestion-actions">
        {canApply ? <button className="button-secondary" type="button" disabled={disabled || applied}
          aria-label={`${applied ? "已关联" : "关联"}${suggestion.type === "domain" ? "领域" : inboxTargetLabels[suggestion.type]} ${suggestion.name}`}
          onClick={() => {
            if (suggestion.type === "domain") onDomain(suggestion.id);
            else if (suggestion.type === "goal") onGoal(suggestion.id);
            else onPerson(suggestion.id);
          }}>
          {applied ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
          {applied ? "已关联" : "关联"}
        </button> : null}
        <Link className="icon-button" to={suggestion.href}
          title={`查看已有${suggestion.type === "domain" ? "领域" : inboxTargetLabels[suggestion.type]} ${suggestion.name}`}
          aria-label={`查看已有${suggestion.type === "domain" ? "领域" : inboxTargetLabels[suggestion.type]} ${suggestion.name}`}
          aria-disabled={disabled} onClick={event => {
            if (disabled) event.preventDefault();
            else onOpen();
          }}><ArrowUpRight size={16} aria-hidden="true" /></Link>
      </div>
    </li>;
  }

  return <details className="inbox-suggestions">
    <summary>整理建议</summary>
    {target ? <p className="inbox-hint">可能适合{inboxTargetLabels[target.type]} · {target.reason}</p> : null}
    {type !== "person" && dates.length ? <ul aria-label="日期建议">
      {dates.map(suggestion => <li key={suggestion.date}>
        <div className="inbox-suggestion-copy"><time dateTime={suggestion.date}>{suggestion.date}</time>
          <small>{suggestion.reason}</small></div>
        <button className="button-secondary" type="button" disabled={disabled || date === suggestion.date}
          aria-label={`${date === suggestion.date ? "已采用" : "采用日期"} ${suggestion.date}`}
          onClick={() => onDate(suggestion.date)}>
          {date === suggestion.date ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
          {date === suggestion.date ? "已采用" : "采用"}
        </button>
      </li>)}
    </ul> : null}
    {state.kind === "loading" ? <p className="inbox-hint" aria-live="polite">正在匹配已有对象…</p>
      : state.kind === "error" ? <div className="inbox-suggestion-error">
        <p role="alert">已有对象建议暂时无法读取。</p>
        <button className="button-secondary" type="button" disabled={disabled} onClick={() => {
          setState({ kind: "loading" });
          setAttempt(value => value + 1);
        }}>重试匹配</button>
      </div> : state.items.length ? <>
        <ul aria-label="已有对象建议">{state.items.slice(0, 5).map(objectRow)}</ul>
        {state.items.length > 5 ? <details>
          <summary>其余 {state.items.length - 5} 个匹配</summary>
          <ul aria-label="更多已有对象建议">{state.items.slice(5).map(objectRow)}</ul>
        </details> : null}
      </> : <p className="inbox-hint">没有名称匹配的已有对象。</p>}
  </details>;
}
