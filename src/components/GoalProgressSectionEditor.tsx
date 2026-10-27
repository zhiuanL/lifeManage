import { useEffect, useRef, useState, type FormEvent } from "react";
import { Save, X } from "lucide-react";
import { useLifeOS } from "../app/LifeOSContext";
import type { Goal } from "../domain/planning/Goal";
import { ProgressItemValidationError, type GoalProgressItem } from "../domain/progress/GoalProgressItem";
import type { EditableProgressItem } from "../services/planning/GoalProgressItemService";
import { ProgressItemsEditor } from "./ProgressItemsEditor";

export function GoalProgressSectionEditor({ goal, items, onCancel, onSaved }: {
  goal: Goal; items: readonly GoalProgressItem[]; onCancel(): void; onSaved(items: readonly GoalProgressItem[]): void;
}) {
  const { goalProgressItemService: currentService } = useLifeOS();
  const [{ goalId, goalProgressItemService }] = useState(() => ({
    goalId: goal.id, goalProgressItemService: currentService,
  }));
  const [drafts, setDrafts] = useState<EditableProgressItem[]>(() => items.map((item) => ({ ...item })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const savedCallback = useRef(onSaved);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { savedCallback.current = onSaved; }, [onSaved]);
  function cancel() {
    if (!submitting.current) onCancel();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !mounted.current) return;
    submitting.current = true;
    setSaving(true); setError(null);
    try {
      const saved = await goalProgressItemService.replace(goalId, drafts);
      if (mounted.current) savedCallback.current(saved);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof ProgressItemValidationError
        ? reason.message : "保存失败，请重试。");
    } finally {
      submitting.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return <form className="domain-form goal-section-form" aria-label="编辑进度项"
    onSubmit={(event) => void submit(event)}
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } }}>
    <ProgressItemsEditor items={drafts} onChange={(next) => {
      if (!submitting.current) setDrafts(next);
    }} disabled={saving} />
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    <footer className="dialog-actions"><button type="button" className="button-secondary" disabled={saving}
      onClick={cancel}><X size={16} aria-hidden="true" />取消</button><button type="submit" className="button-primary" disabled={saving}>
        <Save size={16} aria-hidden="true" />{saving ? "正在保存" : "保存进度"}</button></footer>
  </form>;
}
