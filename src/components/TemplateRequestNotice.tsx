import { Link } from "react-router-dom";

export function TemplateRequestNotice({ label, category, message, onRetry, onCancel }: {
  label: string; category: "issue" | "decision" | "goal" | "review" | "export"; message: string | null;
  onRetry(): void; onCancel(): void;
}) {
  return message ? <div className="form-error" role="alert">
    <p>{message}</p>
    <button type="button" className="button-secondary" onClick={onRetry}>重试读取模板</button>
    <button type="button" className="button-secondary" onClick={onCancel}>取消模板请求</button>
    <Link className="button-secondary" to={`/templates?category=${category}`}>{label}模板</Link>
  </div> : <p role="status">正在读取{label}模板</p>;
}
