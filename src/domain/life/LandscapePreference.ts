import type { LifeDomain } from "./LifeDomain";

export interface LandscapePreference {
  domainOrder: readonly string[];
  hiddenDomainIds: readonly string[];
  showFocus: boolean;
  showReviews: boolean;
  domainPositions?: readonly DomainPosition[];
}

export interface DomainPosition { domainId: string; x: number; y: number }

export const landscapeSlots = [
  { label: "左上", x: 0, y: 0 }, { label: "右上", x: 2, y: 0 },
  { label: "左下", x: 0, y: 2 }, { label: "右下", x: 2, y: 2 },
  { label: "上方", x: 1, y: 0 }, { label: "左侧", x: 0, y: 1 },
  { label: "右侧", x: 2, y: 1 }, { label: "下方", x: 1, y: 2 },
] as const;

export function defaultLandscapePreference(): LandscapePreference {
  return { domainOrder: [], hiddenDomainIds: [], showFocus: true, showReviews: true };
}

export function validateLandscapePreference(value: unknown): LandscapePreference {
  if (!value || typeof value !== "object") throw new Error("景观偏好格式无效。");
  const data = value as Record<string, unknown>;
  function ids(key: string): string[] {
    const list = data[key];
    if (!Array.isArray(list) || list.length > 1000 ||
      list.some(id => typeof id !== "string" || !id.trim() || id.length > 200) ||
      new Set(list).size !== list.length) throw new Error("景观领域选择无效。");
    return [...list] as string[];
  }
  if (typeof data.showFocus !== "boolean" || typeof data.showReviews !== "boolean") {
    throw new Error("景观显示选项无效。");
  }
  let positions: DomainPosition[] | undefined;
  if (data.domainPositions !== undefined) {
    if (!Array.isArray(data.domainPositions) || data.domainPositions.length > 8) {
      throw new Error("景观位置格式无效。");
    }
    positions = data.domainPositions.map((entry: unknown) => {
      if (!entry || typeof entry !== "object") throw new Error("景观位置格式无效。");
      const p = entry as Record<string, unknown>;
      if (typeof p.domainId !== "string" || !p.domainId.trim() || p.domainId.length > 200 ||
        !landscapeSlots.some(slot => slot.x === p.x && slot.y === p.y)) {
        throw new Error("景观位置格式无效。");
      }
      return { domainId: p.domainId, x: p.x as number, y: p.y as number };
    });
    if (new Set(positions.map(p => p.domainId)).size !== positions.length ||
      new Set(positions.map(p => `${p.x}:${p.y}`)).size !== positions.length) {
      throw new Error("景观位置不能重复。");
    }
  }
  return { domainOrder: ids("domainOrder"), hiddenDomainIds: ids("hiddenDomainIds"),
    ...(positions === undefined ? {} : { domainPositions: positions }),
    showFocus: data.showFocus, showReviews: data.showReviews };
}

export function placeLandscapeDomains(domains: readonly LifeDomain[], preference: LandscapePreference) {
  const visible = orderLandscapeDomains(domains.filter(domain => domain.status === "active" &&
    !preference.hiddenDomainIds.includes(domain.id)), preference);
  const assigned = new Map<string, number>();
  for (const p of preference.domainPositions ?? []) {
    if (visible.some(domain => domain.id === p.domainId)) {
      assigned.set(p.domainId, landscapeSlots.findIndex(slot => slot.x === p.x && slot.y === p.y));
    }
  }
  for (const domain of visible) {
    if (assigned.has(domain.id)) continue;
    const free = landscapeSlots.findIndex((_, index) => ![...assigned.values()].includes(index));
    if (free !== -1) assigned.set(domain.id, free);
  }
  return {
    nodes: visible.filter(domain => assigned.has(domain.id))
      .map(domain => ({ domain, slot: assigned.get(domain.id)! })),
    overflow: visible.filter(domain => !assigned.has(domain.id)),
  };
}

export function changeLandscapePosition(domains: readonly LifeDomain[], preference: LandscapePreference,
  domainId: string, slotIndex: number | null): LandscapePreference {
  const positions = (preference.domainPositions ?? []).filter(p => p.domainId !== domainId);
  if (slotIndex === null) return { ...preference, domainPositions: positions };
  const target = landscapeSlots[slotIndex];
  if (!target || !domains.some(d => d.id === domainId && d.status === "active")) {
    throw new Error("请选择可用的景观位置。");
  }
  const nodes = placeLandscapeDomains(domains, preference).nodes;
  const oldSlot = nodes.find(node => node.domain.id === domainId)?.slot;
  const occupant = nodes.find(node => node.slot === slotIndex && node.domain.id !== domainId)?.domain.id ??
    positions.find(p => p.x === target.x && p.y === target.y)?.domainId;
  const remaining = positions.filter(p => p.domainId !== occupant &&
    !(p.x === target.x && p.y === target.y));
  if (occupant && oldSlot !== undefined && oldSlot !== slotIndex) {
    const old = landscapeSlots[oldSlot];
    // An inactive domain may retain this slot; releasing it prevents duplicate coordinates.
    const retained = remaining.filter(p => !(p.x === old.x && p.y === old.y));
    return validateLandscapePreference({ ...preference, domainPositions: [
      ...retained, { domainId: occupant, ...old }, { domainId, ...target },
    ] });
  }
  return validateLandscapePreference({ ...preference,
    domainPositions: [...remaining, { domainId, ...target }] });
}

export function orderLandscapeDomains(domains: readonly LifeDomain[], preference: LandscapePreference): LifeDomain[] {
  const ranks = new Map(preference.domainOrder.map((id, index) => [id, index]));
  return [...domains].sort((a, b) =>
    (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
    a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}
