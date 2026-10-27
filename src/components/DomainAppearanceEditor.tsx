import { domainColorKeys, domainIconKeys, type DomainColorKey, type DomainIconKey } from "../domain/life/LifeDomain";
import { DomainIcon } from "./DomainIcon";

const colorLabels: Record<DomainColorKey, string> = {
  ocean: "海蓝", fern: "蕨绿", coral: "珊瑚", gold: "金黄", violet: "紫罗兰",
};
const iconLabels: Record<DomainIconKey, string> = {
  heart: "心形", briefcase: "工作包", users: "关系", wallet: "钱包",
  sprout: "新芽", home: "家", "book-open": "书本", sparkles: "星光",
};

export function DomainAppearanceEditor({ color, icon, disabled = false, onColorChange, onIconChange }: {
  color: DomainColorKey; icon: DomainIconKey; disabled?: boolean;
  onColorChange(color: DomainColorKey): void;
  onIconChange(icon: DomainIconKey): void;
}) {
  return <>
    <fieldset className="form-field choice-field" disabled={disabled}>
      <legend>领域色彩</legend>
      <div className="color-choice-list">
        {domainColorKeys.map(value => <button key={value} type="button"
          className={`color-choice domain-color-${value}${color === value ? " selected" : ""}`}
          title={colorLabels[value]} aria-label={`选择${colorLabels[value]}`}
          aria-pressed={color === value} onClick={() => onColorChange(value)}>
          <span className="color-choice-swatch" />
        </button>)}
      </div>
    </fieldset>
    <fieldset className="form-field choice-field" disabled={disabled}>
      <legend>领域图标</legend>
      <div className="icon-choice-list">
        {domainIconKeys.map(value => <button key={value} type="button"
          className={`icon-choice${icon === value ? " selected" : ""}`}
          title={iconLabels[value]} aria-label={`选择${iconLabels[value]}图标`}
          aria-pressed={icon === value} onClick={() => onIconChange(value)}>
          <DomainIcon icon={value} />
        </button>)}
      </div>
    </fieldset>
  </>;
}
