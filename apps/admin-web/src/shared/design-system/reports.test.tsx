import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { KpiTile, LinkRows, niceMax, niceScale, WeeklyBarChart } from "./index";

// Fictional figures and names only.
const weeks = [
  { key: "2026-09-20", label: "20.9", longLabel: "השבוע של 20.9", value: 12 },
  { key: "2026-09-27", label: "27.9", longLabel: "השבוע של 27.9", value: 0 },
  { key: "2026-10-04", label: "4.10", longLabel: "השבוע של 4.10", value: 18 },
  { key: "2026-10-11", label: "11.10", longLabel: "השבוע של 11.10", value: 15 },
];

describe("KpiTile", () => {
  it("names a rise in words with the good tone when up is good", () => {
    const { container } = render(<KpiTile label="ביקורים" value="45" change={{ delta: 12, unit: "%" }} />);
    const change = container.querySelector(".tp-kpi__change")!;
    expect(change).toHaveClass("tp-kpi__change--good");
    expect(change.textContent).toBe("עלייה של 12% לעומת התקופה הקודמת");
    expect(screen.getByText("45")).toBeInTheDocument();
  });

  it("writes a fall as a word, never as a minus sign, and marks it bad when up is good", () => {
    const { container } = render(<KpiTile label="שיעור תפוסה" value="70%" change={{ delta: -3.5, unit: "%" }} />);
    const change = container.querySelector(".tp-kpi__change")!;
    expect(change).toHaveClass("tp-kpi__change--bad");
    expect(change.textContent).toBe("ירידה של 3.5% לעומת התקופה הקודמת");
    expect(change.textContent).not.toMatch(/[-−]/);
  });

  it("says what the caller asks when there is nothing to compare", () => {
    const { container } = render(
      <KpiTile label="שיעור תפוסה" value="—" change={null} noChange="לא התקיימו שיעורים בתקופה" />,
    );
    expect(container.querySelector(".tp-kpi__change")!.textContent).toBe("לא התקיימו שיעורים בתקופה");
  });

  it("treats a fall as good news when down is good (no-shows)", () => {
    const { container } = render(<KpiTile label="לא הגיעו" value="2" change={{ delta: -4 }} goodWhen="down" />);
    expect(container.querySelector(".tp-kpi__change")).toHaveClass("tp-kpi__change--good");
  });

  it("says so when there is no change and when there is nothing to compare with", () => {
    const { rerender, container } = render(<KpiTile label="חברים פעילים" value="9" change={{ delta: 0 }} />);
    expect(container.querySelector(".tp-kpi__change")!.textContent).toBe("ללא שינוי לעומת התקופה הקודמת");
    expect(container.querySelector(".tp-kpi__change")).not.toHaveClass("tp-kpi__change--good");
    rerender(<KpiTile label="חברים פעילים" value="9" change={null} />);
    expect(container.querySelector(".tp-kpi__change")!.textContent).toBe("אין תקופה קודמת להשוואה");
  });
});

describe("WeeklyBarChart", () => {
  it("hides the drawing from screen readers and gives them the same figures as a table", () => {
    const { container } = render(<WeeklyBarChart title="ביקורים לפי שבוע" weeks={weeks} valueLabel="ביקורים" />);
    const figure = screen.getByRole("figure", { name: "ביקורים לפי שבוע" });
    expect(container.querySelector(".tp-bars__plot")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".tp-bars__plot")).toHaveAttribute("dir", "ltr");
    const table = within(figure).getByRole("table", { name: "ביקורים לפי שבוע" });
    // Hidden by a wrapper: on the table itself .tp-sr-only loses its 1px width to .tp-table's 100% (a 320px page
    // scrolled sideways by the table's width).
    expect(table).not.toHaveClass("tp-sr-only");
    expect(table.parentElement).toHaveClass("tp-sr-only");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(5);
    expect(within(rows[3]!).getByRole("rowheader")).toHaveTextContent("השבוע של 4.10");
    expect(within(rows[3]!).getByRole("cell")).toHaveTextContent("18");
  });

  it("draws one bar per week with a value, oldest first, and none for an empty week", () => {
    const { container } = render(<WeeklyBarChart title="ביקורים" weeks={weeks} valueLabel="ביקורים" />);
    const columns = container.querySelectorAll(".tp-bars__col");
    expect(columns).toHaveLength(4);
    expect(container.querySelectorAll(".tp-bars__bar")).toHaveLength(3);
    expect(columns[1]!.querySelector(".tp-bars__bar")).toBeNull();
    expect(columns[3]).toHaveClass("tp-bars__col--latest");
    expect(columns[0]!.querySelector("title")!.textContent).toBe("השבוע של 20.9: 12");
  });

  it("labels the Hebrew ticks right to left and thins them past eight weeks, keeping the latest", () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ key: `w${i}`, label: `ש${i + 1}`, value: i }));
    const { container } = render(<WeeklyBarChart title="ביקורים" weeks={many} valueLabel="ביקורים" />);
    const ticks = [...container.querySelectorAll(".tp-bars__col text.tp-bars__tick")];
    expect(ticks.map((t) => t.textContent)).toEqual(["ש1", "ש3", "ש5", "ש7", "ש9", "ש11", "ש13"]);
    expect(ticks.every((t) => t.getAttribute("direction") === "rtl")).toBe(true);
  });

  it("shows the table on screen when asked, and an empty state with no weeks", () => {
    const { rerender, container } = render(
      <WeeklyBarChart title="ביקורים" weeks={weeks} valueLabel="ביקורים" showTable />,
    );
    expect(container.querySelector("table")!.parentElement).not.toHaveClass("tp-sr-only");
    rerender(<WeeklyBarChart title="ביקורים" weeks={[]} valueLabel="ביקורים" />);
    expect(screen.getByText("אין נתונים בתקופה הזאת")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("never labels two ticks alike: one visit in a period gives the axis 0 and 1 (Y3's case)", () => {
    const { container } = render(
      <WeeklyBarChart title="ביקורים" weeks={[{ key: "w", label: "11.10", value: 1 }]} valueLabel="ביקורים" />,
    );
    const axis = [...container.querySelectorAll("svg > g:not(.tp-bars__col) .tp-bars__tick")].map((t) => t.textContent);
    expect(axis).toEqual(["0", "1"]);
    expect(new Set(axis).size).toBe(axis.length);
  });

  it("puts the ticks at whole steps of the scale, and below 1 only for values that aren't counts", () => {
    expect(niceScale(1)).toEqual({ max: 1, ticks: [0, 1] });
    expect(niceScale(5)).toEqual({ max: 5, ticks: [0, 5] });
    expect(niceScale(3)).toEqual({ max: 4, ticks: [0, 2, 4] });
    expect(niceScale(18)).toEqual({ max: 20, ticks: [0, 10, 20] });
    expect(niceScale(0.8, { whole: false })).toEqual({ max: 1, ticks: [0, 0.5, 1] });
  });

  it("rounds the scale up to a 1, 2 or 5 step", () => {
    expect(niceMax(18)).toBe(20);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(4)).toBe(4);
    expect(niceMax(130)).toBe(200);
    expect(niceMax(0)).toBe(1);
  });
});

describe("LinkRows", () => {
  it("makes each row one link to its card, inside a named list", () => {
    render(
      <MemoryRouter>
        <LinkRows
          label="כרטיסיות שמסתיימות בקרוב"
          items={[
            { key: "a", title: "דנה לדוגמה", meta: "כרטיסייה של 10", aside: "נשארה כניסה אחת", to: "/people/a" },
            { key: "b", title: "יואב לדוגמה", aside: "פג בעוד 3 ימים" },
          ]}
        />
      </MemoryRouter>,
    );
    const list = screen.getByRole("list", { name: "כרטיסיות שמסתיימות בקרוב" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const link = within(items[0]!).getByRole("link");
    expect(link).toHaveAttribute("href", "/people/a");
    expect(link).toHaveTextContent("דנה לדוגמה");
    expect(link).toHaveTextContent("נשארה כניסה אחת");
    expect(within(items[1]!).queryByRole("link")).toBeNull();
  });
});
