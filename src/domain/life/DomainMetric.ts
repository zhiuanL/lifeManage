import { isPlainDate } from "../planning/Goal";

export class MetricValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetricValidationError";
  }
}

export interface MetricDefinition {
  id: string;
  name: string;
  unit: string;
  domainIds: readonly string[];
  archived: boolean;
  createdAt: string;
}

export interface MetricRecord {
  id: string;
  metricId: string;
  recordedOn: string;
  value: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export function normalizeMetricDefinition(
  name: string, unit: string, domainIds: readonly string[],
): Pick<MetricDefinition, "name" | "unit" | "domainIds"> {
  const normalizedName = name.trim();
  const normalizedUnit = unit.trim();
  const ids = domainIds.map((id) => id.trim());
  if (!normalizedName || normalizedName.length > 60) {
    throw new MetricValidationError("指标名称请填写 1 至 60 个字符。");
  }
  if (!normalizedUnit || normalizedUnit.length > 20) {
    throw new MetricValidationError("计量单位请填写 1 至 20 个字符。");
  }
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new MetricValidationError("关联的生活领域无效。");
  }
  return { name: normalizedName, unit: normalizedUnit, domainIds: ids };
}

export function normalizeMetricRecord(
  recordedOn: string, value: number, note: string,
): Pick<MetricRecord, "recordedOn" | "value" | "note"> {
  if (!isPlainDate(recordedOn)) throw new MetricValidationError("记录日期请使用有效的年月日。");
  if (!Number.isFinite(value) || Math.abs(value) > 1e9) {
    throw new MetricValidationError("请填写有效的指标数值（绝对值不超过十亿）。");
  }
  if (note.trim().length > 280) throw new MetricValidationError("记录说明请控制在 280 个字符以内。");
  return { recordedOn, value, note: note.trim() };
}
