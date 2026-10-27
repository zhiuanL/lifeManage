export const landscapeContextFields = [
  { key: "lifeState", label: "整体生活状态", limit: 2000 },
  { key: "currentStage", label: "当前阶段", limit: 120 },
  { key: "currentFocus", label: "当前重心", limit: 500 },
  { key: "lifeTensions", label: "生活张力", limit: 2000 },
] as const;
export type LandscapeContextField = (typeof landscapeContextFields)[number]["key"];
export type LandscapeContextInput = Record<LandscapeContextField, string>;
export interface LandscapeContext extends LandscapeContextInput {
  updatedAt: string;
}
export class LandscapeContextValidationError extends Error {}
export function emptyLandscapeContext(): LandscapeContextInput {
  return { lifeState: "", currentStage: "", currentFocus: "", lifeTensions: "" };
}
export function normalizeLandscapeContext(input: LandscapeContextInput): LandscapeContextInput {
  const result = emptyLandscapeContext();
  for (const { key, label, limit } of landscapeContextFields) {
    if (typeof input[key] !== "string" || input[key].trim().length > limit) {
      throw new LandscapeContextValidationError(`${label}请控制在 ${limit} 字以内。`);
    }
    result[key] = input[key].trim();
  }
  return result;
}
