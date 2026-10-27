import { normalizeLifeDomainDraft, type LifeDomain, type LifeDomainDraft } from "./LifeDomain";
import type { IdGenerator } from "../../shared/id";

export const recommendedLifeDomains: readonly LifeDomainDraft[] = [
  { name: "事业", description: "", focus: "", color: "ocean", icon: "briefcase" },
  { name: "成长", description: "", focus: "", color: "violet", icon: "sprout" },
  { name: "健康", description: "", focus: "", color: "fern", icon: "heart" },
  { name: "关系", description: "", focus: "", color: "coral", icon: "users" },
  { name: "财务", description: "", focus: "", color: "gold", icon: "wallet" },
];

export function buildRecommendedLifeDomains(
  existing: readonly LifeDomain[],
  names: readonly string[],
  timestamp: string,
  ids: IdGenerator,
): LifeDomain[] {
  const requested = new Set(names);
  if (requested.size !== names.length ||
    names.some((name) => !recommendedLifeDomains.some((draft) => draft.name === name))) {
    throw new Error("请选择可用的推荐领域。");
  }

  const present = new Set(existing.map((domain) => domain.name.trim()));
  return recommendedLifeDomains
    .filter((draft) => requested.has(draft.name) && !present.has(draft.name))
    .map((draft, index) => ({
      id: ids.next(),
      ...normalizeLifeDomainDraft(draft),
      sortOrder: existing.length + index,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
}
