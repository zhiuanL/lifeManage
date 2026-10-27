import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  LifeDomainValidationError,
  type DomainStatus,
  type LifeDomain,
  type LifeDomainDraft,
} from "../domain/life/LifeDomain";
import { useLifeOS } from "../app/LifeOSContext";
import { DomainAppearanceEditor } from "./DomainAppearanceEditor";
import { domainDraftFromDefaults } from "../domain/life/DomainTemplate";
import type { Template } from "../domain/templates/Template";

interface DomainEditorDialogProps {
  domain?: LifeDomain;
  template?: Template;
  onClose(): void;
  onSaved(domain: LifeDomain): void;
}

function createDraft(domain?: LifeDomain): LifeDomainDraft {
  return {
    name: domain?.name ?? "",
    description: domain?.description ?? "",
    focus: domain?.focus ?? "",
    currentState: domain?.currentState ?? "",
    longTermExpectation: domain?.longTermExpectation ?? "",
    status: domain?.status ?? "active",
    color: domain?.color ?? "ocean",
    icon: domain?.icon ?? "heart",
  };
}

export function DomainEditorDialog({
  domain,
  template,
  onClose,
  onSaved,
}: DomainEditorDialogProps) {
  const app = useLifeOS();
  const [lifeDomainService] = useState(() => app.lifeDomainService);
  const [sourceDomain] = useState(() => domain);
  const [draft, setDraft] = useState<LifeDomainDraft>(() =>
    sourceDomain || !template ? createDraft(sourceDomain) : domainDraftFromDefaults(template.defaults));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const saving = useRef(false);
  const mounted = useRef(false);
  const savedCallback = useRef(onSaved);
  const isEditing = Boolean(sourceDomain);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => { savedCallback.current = onSaved; }, [onSaved]);

  function change(patch: Partial<LifeDomainDraft>) {
    if (saving.current || !mounted.current) return;
    setDraft(current => ({ ...current, ...patch }));
  }

  function close() {
    if (!saving.current && mounted.current) onClose();
  }

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving.current && mounted.current) {
        onClose();
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || !mounted.current) return;
    saving.current = true;
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const savedDomain = sourceDomain
        ? await lifeDomainService.update(sourceDomain.id, draft)
        : await lifeDomainService.create(draft);
      if (mounted.current) savedCallback.current(savedDomain);
    } catch (error) {
      if (mounted.current) setErrorMessage(error instanceof LifeDomainValidationError
        ? error.message : "保存领域失败，请重试。");
    } finally {
      saving.current = false;
      if (mounted.current) setIsSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="domain-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="domain-dialog-title"
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">{isEditing ? "编辑领域" : "新建领域"}</p>
            <h2 id="domain-dialog-title">{isEditing ? "调整领域上下文" : "添加生活领域"}</h2>
          </div>
          <button className="icon-button" type="button" disabled={isSaving} onClick={close} title="关闭">
            <X aria-hidden="true" size={19} strokeWidth={1.8} />
            <span className="sr-only">关闭</span>
          </button>
        </header>

        <form className="domain-form" onSubmit={(event) => void handleSubmit(event)}>
          <fieldset className="record-edit-fields" disabled={isSaving}>
          <label className="form-field">
            <span>领域名称</span>
            <input
              autoFocus
              maxLength={28}
              required
              value={draft.name}
              onChange={(event) => change({ name: event.target.value })}
              placeholder="例如：健康、职业、亲密关系"
            />
          </label>

          <label className="form-field">
            <span>长期期待</span>
            <textarea
              maxLength={500}
              rows={3}
              required={!isEditing}
              value={draft.longTermExpectation ?? ""}
              onChange={(event) => change({ longTermExpectation: event.target.value })}
              placeholder="希望这个领域未来是什么样子？"
            />
          </label>

          {isEditing ? <label className="form-field">
            <span>当前状态</span>
            <textarea
              maxLength={500}
              rows={3}
              value={draft.currentState ?? ""}
              onChange={(event) => change({ currentState: event.target.value })}
              placeholder="最近的真实感受和情况"
            />
          </label> : null}

          <label className="form-field">
            <span>领域说明</span>
            <textarea
              maxLength={280}
              rows={3}
              value={draft.description}
              onChange={(event) => change({ description: event.target.value })}
              placeholder="这件事对你意味着什么？"
            />
          </label>

          <label className="form-field">
            <span>当下关注</span>
            <input
              maxLength={120}
              value={draft.focus}
              onChange={(event) => change({ focus: event.target.value })}
              placeholder="此刻最想照看的一个方向"
            />
          </label>

          <DomainAppearanceEditor color={draft.color} icon={draft.icon} disabled={isSaving}
            onColorChange={color => change({ color })}
            onIconChange={icon => change({ icon })} />

          {isEditing ? <label className="form-field">
            <span>领域状态</span>
            <select value={draft.status ?? "active"}
              onChange={(event) => change({ status: event.target.value as DomainStatus })}>
              <option value="active">启用</option>
              <option value="paused">暂停</option>
              <option value="archived">归档</option>
            </select>
          </label> : <label className="domain-enabled">
            <input type="checkbox" checked={draft.status === "active"}
              onChange={(event) => change({ status: event.target.checked ? "active" : "paused" })} />
            启用领域
          </label>}

          {errorMessage ? <p className="form-error" role="alert">{errorMessage}</p> : null}

          <footer className="dialog-actions">
            <button className="button-secondary" type="button" disabled={isSaving} onClick={close}>
              取消
            </button>
            <button className="button-primary" type="submit" disabled={isSaving}>
              {isSaving ? "正在保存" : isEditing ? "保存修改" : "创建领域"}
            </button>
          </footer>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
