import { describe, expect, it } from "vitest";
import type { MetricDefinition, MetricRecord } from "../../src/domain/life/DomainMetric";
import { latestResourceMetrics, summarizeResourceNeeds } from "../../src/domain/resources/ResourceFacts";
import { resourceKinds, type ResourceNeed } from "../../src/domain/resources/Resources";

const definition: MetricDefinition = { id: "metric", name: "Energy", unit: "points", domainIds: [], archived: false, createdAt: "2026-10-01" };
function record(id: string, recordedOn: string, value: number, updatedAt = recordedOn): MetricRecord {
  return { id, metricId: definition.id, recordedOn, value, note: "", createdAt: recordedOn, updatedAt };
}
describe("resource source facts", () => {
  it("keeps all six categories with explicit counts and missing categories", () => {
    const needs: ResourceNeed[] = resourceKinds.flatMap((kind, index) => Array.from({ length: index }, (_, n) => ({
      id: kind + n, kind, goalId: "goal", description: "need", personId: null, skillId: null,
      met: n === 0, createdAt: "2026-10-01", updatedAt: "2026-10-01",
    })));
    const before = JSON.stringify(needs);
    const summary = summarizeResourceNeeds(needs);
    expect(summary.map((item) => item.kind)).toEqual(resourceKinds);
    expect(summary[0]).toEqual({ kind: "time", total: 0, met: 0, gap: 0 });
    expect(summary[5]).toEqual({ kind: "tool", total: 5, met: 1, gap: 4 });
    expect(JSON.stringify(needs)).toBe(before);
    expect(summarizeResourceNeeds([])).toHaveLength(6);
  });
  it("distinguishes a zero value from a missing observation", () => {
    const facts = latestResourceMetrics([definition, { ...definition, id: "missing" }], [record("zero", "2026-10-12", 0)], "2026-10-13");
    expect(facts[0].latest?.value).toBe(0);
    expect(facts[1].latest).toBeNull();
  });
  it("uses observation date, ignores future and unrelated records without mutating inputs", () => {
    const records = Object.freeze([
      record("old-edited", "2026-10-10", 8, "2026-10-13"), record("latest", "2026-10-12", 3),
      record("future", "2026-10-14", 99), { ...record("other", "2026-10-13", 100), metricId: "other" },
    ]);
    expect(latestResourceMetrics(Object.freeze([definition]), records, "2026-10-13")[0].latest?.id).toBe("latest");
    expect(records.map((item) => item.id)).toEqual(["old-edited", "latest", "future", "other"]);
  });
  it("resolves same-day ties deterministically by update time and id", () => {
    const records = [record("b", "2026-10-12", 1), record("a", "2026-10-12", 2), record("c", "2026-10-12", 3, "2026-10-13")];
    expect(latestResourceMetrics([definition], records, "2026-10-13")[0].latest?.id).toBe("c");
    expect(latestResourceMetrics([definition], records.slice(0, 2).reverse(), "2026-10-13")[0].latest?.id).toBe("a");
  });
});

