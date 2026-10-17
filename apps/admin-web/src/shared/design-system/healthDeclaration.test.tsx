import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HealthStatusChip, YesNoQuestions } from "./index";

// Generic questions only: no real health data, not even in tests.
const questions = [
  { id: "q1", text: "שאלה ראשונה לדוגמה?" },
  { id: "q2", text: "שאלה שנייה לדוגמה?" },
];

describe("YesNoQuestions, read-only (the answers a health.view holder opens)", () => {
  it("shows each answer as a word under its question, with no control to change it", () => {
    render(<YesNoQuestions label="התשובות" questions={questions} answers={{ q1: true, q2: false }} />);
    const answers = screen.getByRole("group", { name: "התשובות" });
    expect(within(answers).queryAllByRole("radio")).toHaveLength(0);
    expect(
      within(within(answers).getByRole("group", { name: "שאלה ראשונה לדוגמה?" })).getByText("כן"),
    ).toBeInTheDocument();
    expect(
      within(within(answers).getByRole("group", { name: "שאלה שנייה לדוגמה?" })).getByText("לא"),
    ).toBeInTheDocument();
  });
});

describe("HealthStatusChip in the console", () => {
  it("marks a roster row with one word and the full name for a screen reader", () => {
    const { container } = render(<HealthStatusChip status="expired" compact />);
    const chip = container.querySelector(".tp-chip");
    expect(chip).toHaveClass("tp-chip--danger");
    expect(chip?.textContent).toBe("הצהרת בריאות: פגה");
  });

  it("names the state in full on a person card", () => {
    render(<HealthStatusChip status="needs_medical_approval" />);
    expect(screen.getByText("ממתינה לאישור רפואי")).toHaveClass("tp-chip--info");
  });
});
