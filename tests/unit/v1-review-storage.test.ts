import { describe, expect, it } from "vitest";
import { createReviewStructure, reviewTypes } from "../../src/domain/reviews/ReviewStructure";
import { decodeReviewStructure, encodeReviewStructure } from "../../src/repositories/reviews/ReviewStructureStorage";

const id = "review-1";

function storedWeekly() { return encodeReviewStructure(id, createReviewStructure("weekly", "2026-10-13")); }

describe("V1 review storage contract", () => {
  it("rejects incomplete metadata, corrupted snapshots and invalid periods", () => {
    const stored = storedWeekly();
    for (const key of Object.keys(stored.columns)) {
      expect(() => decodeReviewStructure(id, { ...stored.columns, [key]: null }, stored.answers)).toThrow();
      expect(() => decodeReviewStructure(id, { ...stored.columns, [key]: undefined }, stored.answers)).toThrow();
    }
    for (const change of [
      { template_snapshot: "{broken" }, { template_snapshot: "null" },
      { review_type: "other" }, { period_start: "2026-10-13" }, { period_end: "2026-10-17" },
      { review_status: "unknown" }, { review_mode: "narrative" },
    ]) expect(() => decodeReviewStructure(id, { ...stored.columns, ...change }, stored.answers)).toThrow();
  });

  it("rejects wrong ownership, duplicate, missing, unknown and nontext answers", () => {
    const stored = storedWeekly();
    expect(() => decodeReviewStructure(id, stored.columns, [{ ...stored.answers[0], review_id: "other" }, ...stored.answers.slice(1)])).toThrow("归属");
    expect(() => decodeReviewStructure(id, stored.columns, [...stored.answers, stored.answers[0]])).toThrow("重复");
    expect(() => decodeReviewStructure(id, stored.columns, stored.answers.slice(1))).toThrow("缺失");
    expect(() => decodeReviewStructure(id, stored.columns, [])).toThrow("缺失");
    expect(() => decodeReviewStructure(id, stored.columns, [...stored.answers, { review_id: id, field_key: "unknown", value: "额外内容" }])).toThrow();
    for (const value of [null, 0, undefined, "x".repeat(12001)]) {
      expect(() => decodeReviewStructure(id, stored.columns, [
        { ...stored.answers[0], value: value as unknown as string }, ...stored.answers.slice(1),
      ])).toThrow();
    }
  });

  it("rejects invalid review ids on both paths", () => {
    const stored = storedWeekly();
    for (const invalid of ["", " ", " review-1", "review-1 "]) {
      expect(() => encodeReviewStructure(invalid, null)).toThrow("编号");
      expect(() => decodeReviewStructure(invalid, stored.columns, stored.answers)).toThrow("编号");
    }
  });
  it.each(reviewTypes)("round-trips %s including blank answers and template order", type => {
    const draft = createReviewStructure(type, "2026-10-13");
    draft.answers = { ...draft.answers, [draft.template.fields[0].key]: "用户事实" };
    const stored = encodeReviewStructure(id, draft);
    expect(stored.columns.review_type).toBe(type);
    expect(stored.answers.map(row => row.field_key)).toEqual(draft.template.fields.map(field => field.key));
    expect(stored.answers.every(row => row.review_id === id)).toBe(true);
    expect(decodeReviewStructure(id, stored.columns, [...stored.answers].reverse())).toEqual(draft);
  });

  it("keeps legacy reviews unclassified without inventing a period or template", () => {
    const stored = encodeReviewStructure(id, null);
    expect(Object.values(stored.columns)).toEqual([null, null, null, null, null, null]);
    expect(stored.answers).toEqual([]);
    expect(decodeReviewStructure(id, stored.columns, [])).toBeNull();
    expect(() => decodeReviewStructure(id, stored.columns, [{ review_id: id, field_key: "note", value: "旧内容" }])).toThrow("未分类");
  });

  it("preserves selected template version, explicit clears and custom prototype-named keys", () => {
    const template = { id: "custom", name: "月度校准", version: 3, fields: [
      { key: "toString", label: "事实", defaultValue: "默认值" },
      { key: "hasOwnProperty", label: "补充", defaultValue: "" },
    ] };
    const draft = createReviewStructure("monthly", "2026-10-13", template);
    draft.status = "completed";
    draft.mode = "narrative";
    draft.answers = { toString: "", hasOwnProperty: "我的补充" };
    const stored = encodeReviewStructure(id, draft);
    template.version = 4;
    template.fields[0].label = "新字段";
    template.fields.reverse();
    const decoded = decodeReviewStructure(id, stored.columns, stored.answers);
    expect(decoded).toEqual(draft);
    expect(decoded?.template.version).toBe(3);
    expect(decoded?.answers.toString).toBe("");
    expect(decoded?.answers.hasOwnProperty).toBe("我的补充");
    expect(decoded?.template.fields[0].defaultValue).toBe("默认值");
  });

  it("detaches encoded and decoded snapshots from mutable inputs", () => {
    const draft = createReviewStructure("weekly", "2026-10-13");
    const stored = encodeReviewStructure(id, draft);
    draft.template.fields[0].label = "后来修改";
    draft.answers = { ...draft.answers, execution: "后来补充" };
    const decoded = decodeReviewStructure(id, stored.columns, stored.answers);
    expect(decoded?.template.fields[0].label).toBe("本周执行总结");
    expect(decoded?.answers.execution).toBe("");
    stored.answers[0].value = "存储修改";
    expect(decoded?.answers.execution).toBe("");
  });
});

