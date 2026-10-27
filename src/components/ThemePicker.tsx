import { Palette, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { themeOptions } from "../domain/life/ThemePreference";
import { useLifeOS } from "../app/LifeOSContext";
import { useThemePreferenceCommand } from "./useThemePreferenceCommand";

export function ThemePicker() {
  const { theme } = useLifeOS();
  const command = useThemePreferenceCommand();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!command.busy && !containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [isOpen, command.busy]);

  return (
    <div className="theme-picker" ref={containerRef}>
      <button
        className="icon-button"
        type="button"
        title="切换主题"
        aria-label="切换主题"
        aria-expanded={isOpen}
        aria-controls="theme-picker-panel"
        disabled={command.busy}
        onClick={() => setIsOpen((currentValue) => !currentValue)}
      >
        <Palette aria-hidden="true" size={19} strokeWidth={1.8} />
      </button>

      {isOpen ? (
        <section className="theme-popover" id="theme-picker-panel" aria-label="主题选择">
          <p className="eyebrow">界面主题</p>
          <div className="theme-options">
            {themeOptions.map((option) => (
              <button
                className={`theme-option${theme === option.key ? " selected" : ""}`}
                type="button"
                key={option.key}
                aria-pressed={theme === option.key}
                disabled={command.disabled}
                onClick={() => void command.select(option.key).then(saved => {
                  if (saved) setIsOpen(false);
                })}
              >
                <span className={`theme-swatch theme-swatch-${option.key}`} aria-hidden="true" />
                <span>
                  <strong>{option.label}</strong>
                  
                </span>
              </button>
            ))}
          </div>
          {command.error ? <>
            <p className="theme-error" role="alert">{command.error}</p>
            <p>待保存：{themeOptions.find(option => option.key === command.pendingTheme)?.label}</p>
            <button type="button" disabled={command.busy} onClick={() => void command.retry().then(saved => {
              if (saved) setIsOpen(false);
            })}><RotateCcw size={16} aria-hidden="true" />重试主题</button>
            <button type="button" disabled={command.busy} onClick={command.cancel}>
              <X size={16} aria-hidden="true" />撤销主题选择
            </button>
          </> : null}
        </section>
      ) : null}
    </div>
  );
}
