import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { useLifeOS } from "../app/LifeOSContext";
import type { GoalDraft } from "../domain/planning/Goal";
import { goalHorizons, goalHorizonLabels, type GoalHorizon } from "../domain/planning/GoalHorizon";
import type { LifeNavigation } from "../domain/life/LifeNavigation";

export function GoalDirectionEditor({ draft, onChange, disabled = false, allowMissingDirection = false }: {
  draft: GoalDraft; onChange(patch: Pick<GoalDraft, "horizon" | "directionId">): void;
  disabled?: boolean; allowMissingDirection?: boolean;
}) {
  const { lifeNavigationService: currentService } = useLifeOS();
  const [lifeNavigationService] = useState(() => currentService);
  const [directions, setDirections] = useState<readonly LifeNavigation[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void lifeNavigationService.list().then((items) => {
      if (active) { setDirections(items.filter((item) => item.kind === "vision")); setState("ready"); }
    }).catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [lifeNavigationService, attempt]);
  return <>
    <label className="form-field"><span>目标周期</span>
      <select disabled={disabled} value={draft.horizon ?? ""}
        onChange={(event) => onChange({ horizon: event.target.value as GoalHorizon || null })}>
        <option value="">未分类</option>
        {goalHorizons.map((value) => <option key={value} value={value}>{goalHorizonLabels[value]}</option>)}
      </select>
    </label>
    <label className="form-field"><span>长期方向</span>
      <select disabled={disabled || state !== "ready"} value={draft.directionId ?? ""}
        required={draft.horizon === "annual" && !allowMissingDirection}
        onChange={(event) => onChange({ directionId: event.target.value || null })}>
        <option value="">{state === "loading" ? "正在读取" : state === "error" ? "读取失败" : "未关联"}</option>
        {directions.filter((item) => !item.archivedAt || item.id === draft.directionId).map((item) =>
          <option key={item.id} value={item.id}>{item.title}{item.archivedAt ? "（已归档）" : ""}</option>)}
      </select>
    </label>
    {state === "error" ? <div className="form-error" role="alert">无法读取长期方向。
      <button type="button" className="button-secondary" disabled={disabled}
        onClick={() => { setState("loading"); setAttempt((value) => value + 1); }}><RotateCw size={16} />重试</button>
    </div> : null}
  </>;
}
