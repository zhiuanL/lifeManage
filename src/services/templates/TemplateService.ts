import { builtInTemplates, templateCategories, TemplateValidationError,
  validateTemplate, type Template, type TemplateCategory } from "../../domain/templates/Template";
import type { TemplateRepository } from "../../repositories/templates/TemplateRepository";
import type { Clock } from "../../shared/clock";
import type { IdGenerator } from "../../shared/id";
import type { SystemRepository } from "../../repositories/system/SystemRepository";
import { reviewTypes, type ReviewType } from "../../domain/reviews/ReviewStructure";

export class TemplateSavedReadError extends Error {
  constructor(readonly templateId: string) {
    super("模板已保存，但读取失败。请重新读取模板，不要重复保存。");
    this.name = "TemplateSavedReadError";
  }
}

export class TemplateService {
  constructor(private readonly repo: TemplateRepository, private readonly clock: Clock,
    private readonly ids: IdGenerator, private readonly system?: SystemRepository) {}

  async getDefaultTemplate(category: "goal" | "review", cycle: ReviewType = "daily"): Promise<Template | null> {
    if (!this.system) return null;
    const saved = await this.system.getMetadata(this.defaultKey(category, cycle));
    if (saved === null || saved === "") return null;
    const template = await this.find(saved);
    if (!template || template.category !== category ||
      (category === "review" && (template.defaults.reviewType ?? "daily") !== cycle)) {
      throw new TemplateValidationError("默认模板不可用，请在模板中心重新选择。");
    }
    return template;
  }

  async setDefaultTemplate(category: "goal" | "review", id: string | null, cycle: ReviewType = "daily"): Promise<void> {
    const key = this.defaultKey(category, cycle);
    if (!this.system) throw new TemplateValidationError("默认模板设置不可用。");
    if (id !== null) {
      const template = await this.find(id);
      if (!template || template.category !== category ||
        (category === "review" && (template.defaults.reviewType ?? "daily") !== cycle)) {
        throw new TemplateValidationError("请选择对应类型的模板。");
      }
      validateTemplate(template.category, template.name, template.defaults);
    }
    await this.system.setMetadata(key, id ?? "");
  }

  private defaultKey(category: "goal" | "review", cycle: ReviewType): string {
    if (!["goal", "review"].includes(category) || !reviewTypes.includes(cycle)) {
      throw new TemplateValidationError("默认模板类型无效。");
    }
    return category === "goal" ? "v1_default_template_goal" : `v1_default_template_review_${cycle}`;
  }

  async list(): Promise<readonly Template[]> {
    return [...builtInTemplates, ...await this.repo.list()];
  }

  async find(id: string): Promise<Template | null> {
    const preset = builtInTemplates.find((item) => item.id === id);
    if (preset) return preset;
    return this.repo.findById(id);
  }

  async save(category: TemplateCategory, name: string, values: unknown, id?: string): Promise<Template> {
    const { name: title, defaults } = validateTemplate(category, name, values);
    if (id && (builtInTemplates.some((item) => item.id === id) ||
      !templateCategories.includes(category))) throw new TemplateValidationError("系统模板请先复制。");
    const now = this.clock.now().toISOString();
    if (id) {
      const current = await this.find(id);
      if (!current || current.category !== category) throw new TemplateValidationError("模板已不存在。");
      if (category === "review" && this.system) {
        for (const cycle of reviewTypes) {
          if (await this.system.getMetadata(this.defaultKey("review", cycle)) === id &&
            (defaults.reviewType ?? "daily") !== cycle) {
            throw new TemplateValidationError("请先取消该周期的默认模板，再修改模板周期。");
          }
        }
      }
      if (!(await this.repo.update({ ...current, name: title, defaults, updatedAt: now }))) {
        throw new TemplateValidationError("模板已不存在。");
      }
      return this.readSaved(id);
    }
    const newId = this.ids.next();
    if (!(await this.repo.create({ id: newId, category, name: title, defaults, version: 1,
      builtIn: false, createdAt: now, updatedAt: now }))) throw new Error("模板保存失败，请重试。");
    return this.readSaved(newId);
  }

  private async readSaved(id: string): Promise<Template> {
    try {
      const saved = await this.find(id);
      if (saved) return saved;
    } catch {
      // The repository has confirmed the write; retrying it could create another template.
    }
    throw new TemplateSavedReadError(id);
  }
}
