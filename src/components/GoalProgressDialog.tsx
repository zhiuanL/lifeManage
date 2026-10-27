import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import type { Goal } from "../domain/planning/Goal";
import { ProgressItemValidationError, type GoalProgressItem } from "../domain/progress/GoalProgressItem";
import type { EditableProgressItem } from "../services/planning/GoalProgressItemService";
import { ProgressItemsEditor } from "./ProgressItemsEditor";

const blank = (): EditableProgressItem => ({
  kind: "key_result", title: "", targetValue: 1, currentValue: 0, weight: 1,
});

export function GoalProgressDialog({ goal: initialGoal, items, onClose, onSaved }: {
  goal: Goal;
  items: readonly GoalProgressItem[];
  onClose(): void;
  onSaved(): void;
}) {
  const { goalProgressItemService: currentService } = useLifeOS();
  const [{ goal, goalProgressItemService }] = useState(() => ({
    goal: initialGoal, goalProgressItemService: currentService,
  }));
  const [drafts, setDrafts] = useState<EditableProgressItem[]>(() =>
    items.length ? items.map((item) => ({ ...item })) : [blank()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const savedCallback = useRef(onSaved);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { savedCallback.current = onSaved; }, [onSaved]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting.current) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !mounted.current) return;
    submitting.current = true;
    setSaving(true);
    setError(null);
    try {
      await goalProgressItemService.replace(goal.id, drafts);
      if (mounted.current) savedCallback.current();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof ProgressItemValidationError ? reason.message : "保存失败，请重试。");
    } finally {
      submitting.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !submitting.current) onClose();
  }}>
    <section role="dialog" aria-modal="true" aria-labelledby="progress-dialog-title"
      className="planning-dialog goal-progress-dialog">
      <header className="dialog-header">
        <div>
          <p className="eyebrow">目标进度</p>
          <h2 id="progress-dialog-title">{goal.title}</h2>
        </div>
        <button type="button" className="icon-button" title="关闭" aria-label="关闭"
          disabled={saving} onClick={() => { if (!submitting.current) onClose(); }}>
          <X size={19} aria-hidden="true" /></button>
      </header>
      <form className="domain-form" onSubmit={(event) => void submit(event)}>
        <ProgressItemsEditor items={drafts} onChange={(next) => {
          if (!submitting.current) setDrafts(next);
        }} disabled={saving} />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <footer className="dialog-actions">
          <button type="button" className="button-secondary" disabled={saving}
            onClick={() => { if (!submitting.current) onClose(); }}>取消</button>
          <button type="submit" className="button-primary" disabled={saving}>
            {saving ? "正在保存" : "保存进度"}
          </button>
        </footer>
      </form>
    </section>
  </div>;
}
