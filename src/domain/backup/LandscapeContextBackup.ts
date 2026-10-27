import { landscapeContextFields } from "../life/LandscapeContext";

const columns = {
  lifeState: "life_state", currentStage: "current_stage",
  currentFocus: "current_focus", lifeTensions: "life_tensions",
} as const;
export function validateLandscapeContextBackupData(data: Record<string, unknown>): void {
  const rows = data.landscape_context;
  if (!Array.isArray(rows) || rows.length > 1) throw new Error("生活状态备份必须为空或仅有一条当前记录。");
  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("生活状态备份行无效。");
    const row = value as Record<string, unknown>;
    const keys = ["id", "updated_at", ...Object.values(columns)];
    if (Object.keys(row).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(row, key)) ||
      row.id !== "current" || typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))) {
      throw new Error("生活状态备份字段或日期无效。");
    }
    for (const { key, label, limit } of landscapeContextFields) {
      const text = row[columns[key]];
      if (typeof text !== "string" || text.trim().length > limit) throw new Error(`${label}备份文字无效或过长。`);
    }
  }
}
