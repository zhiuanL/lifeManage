export function normalizeProgressWeight(value: number | undefined): number {
  const weight = value === undefined ? 1 : value;
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0 || weight > 100) {
    throw new Error("贡献权重须大于 0 且不超过 100。");
  }
  return weight;
}
