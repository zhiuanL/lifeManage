import { describe, expect, it } from "vitest";
import { suggestInboxDates, suggestInboxObjects, type InboxObjectCandidate } from "../../src/domain/inbox/InboxSuggestions";

describe("Explainable inbox date suggestions", () => {
  it("recognizes full dates, deduplicates them, and never rolls invalid dates forward", () => {
    const dates = suggestInboxDates(
      "2026-10-14，2026/10/14，2026.10.15，2024年2月29日，2026年2月30日，2026-13-01",
      "2026-10-14T12:00:00",
    );
    expect(dates.map(item => item.date)).toEqual(["2026-10-14", "2026-10-15", "2024-02-29"]);
    expect(dates[0].reason).toBe("原文中的完整日期「2026-10-14」");
    expect(suggestInboxDates("2026年2月29日", "2024-10-14T12:00:00")).toEqual([]);
    expect(suggestInboxDates("2026年13月1日", "2024-10-14T12:00:00")).toEqual([]);
  });

  it("uses capture-local year for month/day, documents assumptions, and refuses vague dates", () => {
    const dates = suggestInboxDates("12月31日，1月1号，下周、年底、周五再说",
      "2026-12-30T12:00:00");
    expect(dates.map(item => item.date)).toEqual(["2026-12-31", "2026-01-01"]);
    expect(dates[1].reason).toContain("暂按收集日期 2026-12-30 所在年份");
    expect(suggestInboxDates("下周五、月底、两天后、后天", "2026-10-14T12:00:00")).toEqual([]);
  });

  it("anchors relative dates to capture rather than the date the inbox is organized", () => {
    expect(suggestInboxDates("今天、明天、昨天", "2026-12-31T12:00:00").map(item => item.date))
      .toEqual(["2026-12-31", "2027-01-01", "2026-12-30"]);
    expect(suggestInboxDates("昨天", "2026-01-01T12:00:00")[0].date).toBe("2025-12-31");
    expect(suggestInboxDates("明天", "2024-02-28T12:00:00")[0].date).toBe("2024-02-29");
    expect(suggestInboxDates("明天", "2026-02-28T12:00:00")[0].date).toBe("2026-03-01");
    expect(suggestInboxDates("明天、2月1日、2026-10-14", "damaged").map(item => item.date))
      .toEqual(["2026-10-14"]);
  });
});

describe("Existing-object name matching", () => {
  it("retains ambiguous names, distinct types and archive states without fabricating links", () => {
    const candidates: InboxObjectCandidate[] = [
      { type: "person", id: "张&林", name: "小林", state: "已归档" },
      { type: "person", id: "second", name: "小林", state: "" },
      { type: "goal", id: "goal-1", name: "小林", state: "暂停" },
      { type: "domain", id: "domain/1", name: "小林", state: "" },
      { type: "person", id: "张&林", name: "小林", state: "已归档" },
      { type: "person", id: "tiny", name: "林", state: "" },
      { type: "goal", id: "unrelated", name: "关系改善", state: "进行中" },
    ];
    const before = JSON.stringify(candidates);
    const matches = suggestInboxObjects("明天和小林见面", candidates);
    expect(matches).toHaveLength(4);
    expect(matches.find(item => item.id === "张&林")).toMatchObject({
      state: "已归档", reason: "原文包含已有名称「小林」",
      href: "/people#person-%E5%BC%A0%26%E6%9E%97",
    });
    expect(matches.find(item => item.type === "domain")?.href).toBe("/domains/domain%2F1");
    expect(JSON.stringify(candidates)).toBe(before);
    expect(suggestInboxObjects("林", candidates).map(item => item.id)).toEqual(["tiny"]);
  });

  it("matches literal names with punctuation, ignores case, and avoids partial English words", () => {
    const candidates: InboxObjectCandidate[] = [
      { type: "goal", id: "work", name: "Work", state: "" },
      { type: "goal", id: "language", name: "C++", state: "" },
      { type: "goal", id: "full", name: "  Work routine  ", state: "" },
      { type: "issue", id: "wildcard", name: ".*", state: "" },
    ];
    expect(suggestInboxObjects("homework", candidates)).toEqual([]);
    expect(suggestInboxObjects("WORK routine", candidates).map(item => item.id)).toEqual(["full", "work"]);
    expect(suggestInboxObjects("计划学习C++", candidates).map(item => item.id)).toEqual(["language"]);
    expect(suggestInboxObjects("计划学习anything", candidates)).toEqual([]);
    expect(suggestInboxObjects("记录 .*", candidates).map(item => item.id)).toEqual(["wildcard"]);
  });
});
