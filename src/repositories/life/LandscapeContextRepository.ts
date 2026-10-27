import type { LandscapeContext } from "../../domain/life/LandscapeContext";
export interface LandscapeContextRepository {
  get(): Promise<LandscapeContext | null>;
  save(context: LandscapeContext): Promise<void>;
}
