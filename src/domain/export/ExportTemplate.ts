import { validateTemplate } from "../templates/Template";
import {
  exportTypes, fieldPresets, type ExportScenario, type ExportType,
} from "./ContextExport";

export interface ExportDraftDefaults {
  scenario: ExportScenario;
  sections: ExportType[];
  fieldOrder: Record<ExportType, string[]>;
  question: string;
}

export function exportDraftDefaults(values: unknown): ExportDraftDefaults {
  const { defaults } = validateTemplate("export", "导出模板", values);
  const question = defaults.question ?? "";
  if (typeof question !== "string" || question.length > 1000) {
    throw new Error("导出问题不能超过 1000 字，请先调整模板。");
  }
  const fields = defaults.fields as Partial<Record<ExportType, string[]>>;
  return {
    scenario: defaults.scenario as ExportScenario,
    sections: [...defaults.sections as ExportType[]],
    // Missing legacy entries use presets; explicitly saved empty lists stay empty.
    fieldOrder: Object.fromEntries(exportTypes.map(type =>
      [type, [...(fields[type] ?? fieldPresets[type])]])) as Record<ExportType, string[]>,
    question,
  };
}
