import { describe, expect, it } from "vitest";
import {
  createReviewStructure, defaultReviewTemplate, normalizeReviewStructure,
  normalizeReviewTemplate, parseReviewStructure, reviewPeriod, reviewTypes,
} from "../../src/domain/reviews/ReviewStructure";

describe("V1 five-level review structure", () => {
  it("rejects explicit null text rather than silently clearing it", () => {
    const draft = createReviewStructure("weekly", "2026-10-13");
    expect(() => normalizeReviewStructure({ ...draft, answers: { execution: null } })).toThrow();
    const template = defaultReviewTemplate("weekly");
    expect(() => normalizeReviewTemplate({ ...template, fields: [
      { ...template.fields[0], defaultValue: null },
    ] })).toThrow();
  });

  it("treats missing custom answers as blank without reading object prototypes", () => {
    const template = { id: "custom", name: "自定义", version: 1, fields: [
      { key: "toString", label: "补充", defaultValue: "初始内容" },
      { key: "hasOwnProperty", label: "备注", defaultValue: "" },
    ] };
    const draft = createReviewStructure("monthly", "2026-10-13", template);
    const saved = normalizeReviewStructure({ ...draft, answers: {} });
    expect(saved.answers).toEqual({ toString: "", hasOwnProperty: "" });
    expect(parseReviewStructure(JSON.stringify(saved))).toEqual(saved);
  });

  it.each([
    ["daily", "2024-02-29", "2024-02-29", "2024-02-29"],
    ["weekly", "2026-01-01", "2025-12-29", "2026-01-04"],
    ["weekly", "2026-10-12", "2026-10-12", "2026-10-18"],
    ["weekly", "2026-10-18", "2026-10-12", "2026-10-18"],
    ["monthly", "2024-02-29", "2024-02-01", "2024-02-29"],
    ["monthly", "2026-02-13", "2026-02-01", "2026-02-28"],
    ["quarterly", "2026-04-30", "2026-04-01", "2026-06-30"],
    ["quarterly", "2026-12-31", "2026-10-01", "2026-12-31"],
    ["annual", "2024-02-29", "2024-01-01", "2024-12-31"],
  ] as const)("calculates %s around %s without timezone shifts", (type, anchor, start, end) => {
    expect(reviewPeriod(type, anchor)).toEqual({ type, start, end });
  });

it("rejects corrupt structure, mismatched periods and unsupported daily narrative", () => {
  const draft = createReviewStructure("weekly", "2026-10-13");
  for (const change of [
    { type: "invalid" }, { start: "2026-02-30" }, { end: "2026-10-17" },
    { start: "2026-10-13" }, { status: "invalid" }, { mode: "invalid" },
    { answers: [] }, { answers: { unknown: "secret" } }, { answers: { execution: 0 } },
    { answers: { execution: "x".repeat(12001) } }, { unexpected: true },
  ]) expect(() => normalizeReviewStructure({ ...draft, ...change })).toThrow();
  expect(() => reviewPeriod("daily", "2026-02-30")).toThrow();
  expect(() => reviewPeriod("weekly", "9999-12-31")).toThrow();
  expect(() => parseReviewStructure("{broken")).toThrow("结构化复盘数据无效");
  for (const type of ["daily", "weekly"] as const) {
    expect(() => normalizeReviewStructure({ ...createReviewStructure(type, "2026-10-13"), mode: "narrative" })).toThrow();
  }
  for (const type of ["monthly", "quarterly", "annual"] as const) {
    expect(normalizeReviewStructure({ ...createReviewStructure(type, "2026-10-13"), mode: "narrative", status: "completed" }).mode).toBe("narrative");
  }
});

it("rejects invalid, duplicate and dangerous template fields without mutating the source", () => {
  const template = defaultReviewTemplate("weekly");
  const field = template.fields[0];
  for (const change of [
    { id: "" }, { name: "" }, { version: 0 }, { version: 1.5 }, { fields: [] },
    { fields: [field, field] }, { fields: [{ ...field, key: "constructor" }] },
    { fields: [{ ...field, key: "__proto__" }] }, { fields: [{ ...field, label: "" }] },
    { fields: [{ ...field, defaultValue: 0 }] }, { fields: [{ ...field, defaultValue: "x".repeat(2001) }] },
    { fields: [{ ...field, unknown: true }] }, { unknown: true },
  ]) expect(() => normalizeReviewTemplate({ ...template, ...change })).toThrow();
  const original = JSON.stringify(template);
  const result = normalizeReviewTemplate(template);
  expect(result).toEqual(template);
  expect(result).not.toBe(template);
  expect(result.fields[0]).not.toBe(field);
  expect(JSON.stringify(template)).toBe(original);
});

  it("uses distinct daily, weekly and strategic fields without invented answers", () => {
    const keys = (type: (typeof reviewTypes)[number]) => defaultReviewTemplate(type).fields.map(f => f.key);
    expect(keys("daily")).toEqual(["completed", "incomplete", "incompleteReasons", "state",
      "learning", "nextAdjustment", "goalAdjustment"]);
    expect(keys("weekly")).toEqual(["execution", "goalProgress", "recurringIssues",
      "planChanges", "domainState", "nextFocus"]);
    expect(keys("monthly")).toContain("issueEvolution");
    expect(keys("quarterly")).toContain("resourceGaps");
    expect(keys("annual")).toEqual(expect.arrayContaining(["majorDecisions", "importantEvents",
      "capabilityGrowth", "longTermDirection"]));
    for (const type of reviewTypes) {
      const draft = createReviewStructure(type, "2026-10-13");
      expect(draft.status).toBe("draft");
      expect(draft.mode).toBe("structured");
      expect(Object.values(draft.answers).every(value => value === "")).toBe(true);
      expect(parseReviewStructure(JSON.stringify(draft))).toEqual(draft);
    }
  });

  it("copies the selected template version and keeps field order and explicit defaults", () => {
    const template = { id: "custom-review", name: "月度校准", version: 3, fields: [
      { key: "nextFocus", label: "接下来", defaultValue: " 保留一次尝试 " },
      { key: "customNote", label: "我在意的事", defaultValue: "" },
    ] };
    const draft = createReviewStructure("monthly", "2026-10-13", template);
    template.version = 4;
    template.fields[0].label = "后来修改";
    template.fields.reverse();
    expect(draft.template.version).toBe(3);
    expect(draft.template.fields.map(f => f.key)).toEqual(["nextFocus", "customNote"]);
    expect(draft.template.fields[0].label).toBe("接下来");
    expect(draft.answers).toEqual({ nextFocus: "保留一次尝试", customNote: "" });
    draft.answers = { nextFocus: "", customNote: " 用户补充 " };
    const saved = normalizeReviewStructure(draft);
    expect(saved.answers).toEqual({ nextFocus: "", customNote: "用户补充" });
    expect(saved.template.fields[0].defaultValue).toBe("保留一次尝试");
    expect(normalizeReviewStructure({ ...saved, answers: {} }).answers).toEqual({ nextFocus: "", customNote: "" });
  });
});
