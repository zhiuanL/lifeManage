import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PersonDatesEditor } from "../../src/components/PersonDatesEditor";
import type { PersonDate } from "../../src/domain/records/LifeRecords";

afterEach(cleanup);
function Form({ initial = [], disabled = false }: { initial?: PersonDate[]; disabled?: boolean }) {
  const [dates, setDates] = useState(initial);
  return <form><fieldset disabled={disabled}>
    <PersonDatesEditor dates={dates} onChange={setDates} />
    <output data-testid="draft">{JSON.stringify(dates)}</output>
  </fieldset></form>;
}

describe("V1 Chinese person dates editor", () => {
  it("adds independent dates, removes only the chosen row and clears only the birthday", () => {
    render(<Form />);
    fireEvent.click(screen.getByText("生日与其他重要日期"));
    fireEvent.change(screen.getByLabelText("生日"), { target: { value: "1990-02-28" } });
    fireEvent.click(screen.getByRole("button", { name: "添加日期", hidden: true }));
    fireEvent.change(screen.getByLabelText("日期名称 1"), { target: { value: "第一次合作" } });
    fireEvent.change(screen.getByLabelText("日期 1"), { target: { value: "2026-10-22" } });
    fireEvent.click(screen.getByRole("button", { name: "添加日期", hidden: true }));
    fireEvent.change(screen.getByLabelText("日期名称 2"), { target: { value: "毕业" } });
    fireEvent.change(screen.getByLabelText("日期 2"), { target: { value: "2025-06-01" } });
    fireEvent.click(screen.getByRole("button", { name: "删除日期 1", hidden: true }));
    fireEvent.change(screen.getByLabelText("生日"), { target: { value: "" } });
    expect(JSON.parse(screen.getByTestId("draft").textContent!))
      .toEqual([{ kind: "important", label: "毕业", date: "2025-06-01" }]);
    expect(screen.getByLabelText("日期名称 1")).toHaveProperty("value", "毕业");
  });

  it("limits additional dates while retaining the birthday and inherits save-time fieldset protection", () => {
    render(<Form initial={Array.from({ length: 20 }, (_, index) => ({
      kind: "important", label: String(index), date: "2026-10-22",
    }))} />);
    expect(screen.getByRole("button", { name: "添加日期", hidden: true })).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("生日")).toHaveProperty("value", "");
    cleanup();
    const { container } = render(<Form disabled />);
    expect(container.querySelector("fieldset")).toHaveProperty("disabled", true);
  });
});
