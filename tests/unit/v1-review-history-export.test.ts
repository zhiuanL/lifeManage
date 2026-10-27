import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { LifeOSContext } from "../../src/app/LifeOSContext";
import { VersionHistoryPage } from "../../src/pages/VersionHistoryPage";
import { reviewHistoryStructure } from "../../src/services/history/VersionHistoryService";
import { createReviewStructure, reviewTypes } from "../../src/domain/reviews/ReviewStructure";
import { buildContextDocument, fieldPresets, serializeContext, type ExportFilter } from "../../src/domain/export/ContextExport";
const base = { title: "复盘测试", reviewedOn: "2026-10-13", reflection: "原回看", insight: "原发现", nextFocus: "原关注", domainId: null };
afterEach(cleanup);
async function setup() {
  const value = createApplicationDependencies();
  await value.bootstrapApplicationService.bootstrap();
  return value;
}
for (const type of reviewTypes) it(type + " history retains its snapshot; export only includes current answers", async () => {
  const app = await setup();
  const structure = createReviewStructure(type, base.reviewedOn, { id: "old", name: "旧模板", version: 7,
    fields: [{ key: "fact", label: "旧字段", defaultValue: "" }, { key: "blank", label: "留空字段", defaultValue: "" }] });
  const review = await app.reviewService.create({ ...base, title: type, structure: { ...structure, answers: { fact: "修改前事实", blank: "" } } });
  await app.reviewService.update(review.id, { ...base, structure: { ...structure, status: "completed", answers: { fact: "当前事实", blank: "" } } });
  const history = await app.versionHistoryService.list("review", review.id);
  expect(reviewHistoryStructure(history[0].snapshot)).toEqual({ ...structure, answers: { fact: "修改前事实", blank: "" } });
  const records = await app.contextExportService.loadRecords();
  const filter: ExportFilter = { from: base.reviewedOn, to: base.reviewedOn, types: ["review" as const], domainId: null, goalId: null, maxPrivacy: "private" as const };
  const doc = buildContextDocument(records, "period-review", filter, ["review"], "", { review: fieldPresets.review });
  for (const format of ["markdown", "text", "json"] as const) {
    const out = serializeContext(doc, format);
    expect(out).toContain("当前事实"); expect(out).not.toContain("修改前事实");
    expect(out).toContain("旧字段"); expect(out).toContain("旧模板"); expect(out).toContain("v7");
    expect(out).toContain(structure.start); expect(out).toContain(structure.end); expect(out).toContain("已完成");
  }
  await app.reviewService.update(review.id, { ...base, structure });
  const fresh = await app.contextExportService.loadRecords();
  expect(serializeContext(buildContextDocument(fresh, "period-review", filter, ["review"], ""), "text")).not.toContain("当前事实");
  expect((await app.versionHistoryService.list("review", review.id)).some(item => reviewHistoryStructure(item.snapshot)?.answers.fact === "当前事实")).toBe(true);
});


it("history renders old field labels, empty answers and narrative mode read-only", async () => {
  const value = await setup();
  const structure = createReviewStructure("monthly", base.reviewedOn, { id: "snapshot", name: "保存时模板", version: 2,
    fields: [{ key: "fact", label: "历史字段", defaultValue: "" }] });
  const review = await value.reviewService.create({ ...base, structure: { ...structure, mode: "narrative" } });
  await value.reviewService.update(review.id, { ...base, structure: { ...structure, answers: { fact: "当前内容" } } });
  render(createElement(MemoryRouter, { initialEntries: ["/history?type=review&id=" + review.id] },
    createElement(LifeOSContext.Provider, { value }, createElement(VersionHistoryPage))));
  fireEvent.click(await screen.findByText("修改前版本"));
  expect(screen.getByText("历史字段")).toBeTruthy(); expect(screen.getByText("保存时模板 · v2")).toBeTruthy();
  expect(screen.getByText("叙事")).toBeTruthy(); expect(screen.getByText("2026-10-01 至 2026-10-31")).toBeTruthy();
  expect(screen.queryByText("当前内容")).toBeNull(); expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByRole("link", { name: "返回原记录" }).getAttribute("href")).toContain("/reviews#review-");
});
it("legacy history and exports remain unclassified; explicit field selection is preserved", async () => {
  const app = await setup();
  const review = await app.reviewService.create(base);
  await app.reviewService.update(review.id, { ...base, reflection: "更新回看" });
  expect(reviewHistoryStructure((await app.versionHistoryService.list("review", review.id))[0].snapshot)).toBeNull();
  expect(reviewHistoryStructure({ reflection: "很早的历史" })).toBeNull();
  const records = await app.contextExportService.loadRecords();
  const filter = { from: "", to: "", types: ["review" as const], domainId: null, goalId: null, maxPrivacy: "private" as const };
  const out = serializeContext(buildContextDocument(records, "period-review", filter, ["review"], "", { review: ["发现"] }), "text");
  expect(out).toContain("原发现"); expect(out).not.toContain("更新回看"); expect(out).not.toContain("复盘周期");
});
it("review exports enforce privacy, exact record dates, domain and goal ranges and removable body", async () => {
  const app = await setup();
  const domain = (await app.lifeDomainService.list())[0];
  const structure = createReviewStructure("annual", base.reviewedOn);
  await app.reviewService.create({ ...base, domainIds: [domain.id], structure: { ...structure, answers: { ...structure.answers, nextFocus: "私密正文" } } });
  const filter = { from: "", to: "", types: ["review" as const], domainId: null, goalId: null, maxPrivacy: "private" as const };
  const records = await app.contextExportService.loadRecords();
  const make = (changes: Partial<typeof filter>, fields = fieldPresets.review) => serializeContext(buildContextDocument(records, "period-review", { ...filter, ...changes }, ["review"], "", { review: fields }), "text");
  expect(make({})).toContain("私密正文");
  expect(make({ maxPrivacy: "normal" })).not.toContain("私密正文");
  expect(make({ from: "2026-10-14" })).not.toContain("私密正文");
  expect(make({ to: "2026-10-12" })).not.toContain("私密正文");
  expect(make({ domainId: domain.id })).toContain("私密正文");
  expect(make({ domainId: "missing" })).not.toContain("私密正文");
  expect(make({ goalId: "missing" })).not.toContain("私密正文");
  expect(make({}, fieldPresets.review.filter(label => label !== "复盘正文"))).not.toContain("私密正文");
});
it("rejects damaged historical metadata and missing, duplicate or invalid answers", () => {
  const structure = createReviewStructure("daily", base.reviewedOn);
  const snapshot = { review_type: structure.type, period_start: structure.start, period_end: structure.end,
    review_status: structure.status, review_mode: structure.mode, template_snapshot: JSON.stringify(structure.template),
    answers: structure.template.fields.map(field => ({ field_key: field.key, value: "" })) };
  for (const invalid of [{ ...snapshot, answers: [] }, { ...snapshot, answers: [...snapshot.answers, snapshot.answers[0]] },
    { ...snapshot, template_snapshot: "{" }, { ...snapshot, review_type: null }, { ...snapshot, period_end: "2026-02-30" },
    { ...snapshot, answers: [{ field_key: "fact", value: 7 }] }]) expect(() => reviewHistoryStructure(invalid)).toThrow();
});
