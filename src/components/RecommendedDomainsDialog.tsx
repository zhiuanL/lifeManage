import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLifeOS } from "../app/LifeOSContext";
import { DomainIcon } from "./DomainIcon";
import { recommendedLifeDomains } from "../domain/life/recommendedLifeDomains";
import { LifeDomainValidationError } from "../domain/life/LifeDomain";

export function RecommendedDomainsDialog({
  available, onClose, onSaved,
}: {
  available: readonly string[];
  onClose(): void;
  onSaved(): void;
}) {
  const app = useLifeOS();
  const [lifeDomainService] = useState(() => app.lifeDomainService);
  const [candidates] = useState(() => [...available]);
  const [selected, setSelected] = useState<string[]>(() => [...candidates]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const saveLock = useRef(false);
  const mounted = useRef(false);
  const savedCallback = useRef(onSaved);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { savedCallback.current = onSaved; }, [onSaved]);
  function close() {
    if (mounted.current && !saveLock.current) onClose();
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saveLock.current) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function applyRecommendations() {
    if (!selected.length || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError("");
    try {
      await lifeDomainService.addRecommended(selected);
      if (mounted.current) savedCallback.current();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof LifeDomainValidationError
        ? reason.message : "推荐领域添加失败，选择已保留，请重试。");
    } finally {
      saveLock.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <section className="domain-dialog" role="dialog" aria-modal="true"
        aria-labelledby="recommended-domains-title" aria-busy={saving}>
        <header className="dialog-header">
          <div>
            <p className="eyebrow">人生景观</p>
            <h2 id="recommended-domains-title">添加推荐领域</h2>
          </div>
          <button className="icon-button" type="button" onClick={close}
            disabled={saving} title="关闭">
            <X aria-hidden="true" size={19} />
            <span className="sr-only">关闭</span>
          </button>
        </header>
        <div className="domain-form">
          <div className="recommended-domain-list">
            {recommendedLifeDomains.filter((domain) => candidates.includes(domain.name))
              .map((domain) => (
                <label className={`recommended-domain domain-color-${domain.color}`}
                  key={domain.name}>
                  <input type="checkbox" checked={selected.includes(domain.name)} disabled={saving}
                    onChange={(event) => {
                      if (saveLock.current) return;
                      const checked = event.target.checked;
                      setSelected((current) => checked ? [...current, domain.name] :
                        current.filter((name) => name !== domain.name));
                    }} />
                  <span className="landscape-node-icon">
                    <DomainIcon icon={domain.icon} size={18} />
                  </span>
                  <span>{domain.name}</span>
                </label>
              ))}
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <footer className="dialog-actions">
            <button className="button-secondary" type="button" disabled={saving} onClick={close}>
              取消
            </button>
            <button className="button-primary" type="button"
              disabled={!selected.length || saving} onClick={() => void applyRecommendations()}>
              {saving ? "正在添加" : "添加所选领域"}
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
