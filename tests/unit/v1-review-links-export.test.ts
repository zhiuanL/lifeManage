import { expect, it } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { buildContextDocument, serializeContext } from "../../src/domain/export/ContextExport";

it("exports direct review goals and safe issue titles without inferring issue goals", async () => {
  const app = createApplicationDependencies();
  await app.bootstrapApplicationService.bootstrap();
  const goal = await app.goalService.create({ title: "直接目标", description: "", domainId: null, status: "active", targetDate: null });
  const other = await app.goalService.create({ title: "间接目标", description: "", domainId: null, status: "active", targetDate: null });
  const issue = await app.issueService.create({ title: "敏感问题", description: "", firstSeen: "2026-10-13", occurrenceCount: 1, status: "open", goalId: other.id, domainIds: [], causeHypothesis: "", attempts: "", followUp: "" });
  await app.reviewService.create({ title: "关联复盘", reflection: "", insight: "", nextFocus: "", domainId: null, reviewedOn: "2026-10-13", goalIds: [goal.id], issueIds: [issue.id] });
  await app.contextExportService.setPrivacy("issue", issue.id, "highly_sensitive");
  const records = await app.contextExportService.loadRecords();
  const make = (goalId: string | null, maxPrivacy: "private" | "highly_sensitive") => serializeContext(buildContextDocument(records, "goal-analysis", { from: "", to: "", domainId: null, goalId, types: ["goal", "issue", "review"], maxPrivacy }, ["goal", "issue", "review"], ""), "text");
  expect(make(goal.id, "private")).toContain("关联复盘");
  expect(make(other.id, "private")).not.toContain("关联复盘");
  expect(make(null, "private")).not.toContain("敏感问题");
  expect(make(null, "highly_sensitive")).toContain("关联问题：敏感问题");
});
