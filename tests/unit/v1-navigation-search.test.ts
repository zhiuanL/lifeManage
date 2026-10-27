import { describe, expect, it } from "vitest";
import { createApplicationDependencies } from "../../src/app/applicationDependencies";
import { searchEntries, searchTypes, searchTypeLabels } from "../../src/domain/search/Search";

describe("V1 navigation search", () => {
  it("indexes all navigation kinds and archived content with safe direct links", async () => {
    const app = createApplicationDependencies();
    await app.bootstrapApplicationService.bootstrap();
    const records = [];
    for (const kind of ["mission", "value", "vision", "principle"] as const) {
      records.push(await app.lifeNavigationService.create(kind, { title: "导航搜索 " + kind, description: "长期取舍依据" }));
    }
    await app.lifeNavigationService.setArchived(records[2].id, true);
    const entries = (await app.searchService.list()).filter(item => records.some(record => record.id === item.id));
    expect(entries).toHaveLength(4);
    expect(searchTypeLabels.navigation).toBe("人生导航");
    for (const entry of entries) {
      expect(entry.type).toBe("navigation");
      expect(entry.domainIds).toEqual([]);
      expect(entry.href).toBe("/navigation#navigation-" + encodeURIComponent(entry.id));
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const filter = { query: "导航搜索 长期取舍", types: [...searchTypes], from: "", to: "", status: "", domainId: "" };
    expect(searchEntries(entries, filter)).toHaveLength(4);
    expect(searchEntries(entries, { ...filter, status: "archived" }).map(item => item.id)).toEqual([records[2].id]);
    expect(searchEntries(entries, { ...filter, status: "active" })).toHaveLength(3);
    expect(searchEntries(entries, { ...filter, query: "个人原则" }).map(item => item.id)).toEqual([records[3].id]);
    expect(searchEntries(entries, { ...filter, domainId: "unrelated" })).toEqual([]);
    expect(searchEntries(entries, { ...filter, types: ["goal"] })).toEqual([]);
    expect(searchEntries(entries, { ...filter, from: "2099-01-01" })).toEqual([]);
  });
});

