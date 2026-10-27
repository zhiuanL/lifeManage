import type { Template } from "../../domain/templates/Template";

export interface TemplateRepository {
  list(): Promise<readonly Template[]>;
  findById(id: string): Promise<Template | null>;
  create(template: Template): Promise<boolean>;
  update(template: Template): Promise<boolean>;
}
