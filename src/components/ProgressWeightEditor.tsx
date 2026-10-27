interface Props {
  value: number;
  onChange(value: number): void;
  label: string;
  disabled?: boolean;
}

export function ProgressWeightEditor({ value, onChange, label, disabled }: Props) {
  return <details className="goal-initial-progress"
    onInvalidCapture={(event) => { event.currentTarget.open = true; }}>
    <summary>贡献权重</summary>
    <label className="form-field">
      <span>{label}</span>
      <input type="number" required min={0.01} max={100} step="any" value={Number.isFinite(value) ? value : ""}
        disabled={disabled} onChange={(event) => onChange(event.target.valueAsNumber)} />
    </label>
  </details>;
}
