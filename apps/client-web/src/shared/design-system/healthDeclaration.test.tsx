import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  allAnswered,
  emptySignature,
  HealthStatusChip,
  isSignatureComplete,
  Signature,
  signatureErrors,
  YesNoQuestions,
  type HealthDeclarationStatus,
  type SignatureValue,
  type YesNoAnswers,
} from "./index";

// Generic questions only: no real health data, not even in tests.
const questions = [
  { id: "q1", text: "שאלה ראשונה לדוגמה?" },
  { id: "q2", text: "שאלה שנייה לדוגמה?" },
];

function Questions({ showMissing = false }: { showMissing?: boolean }) {
  const [answers, setAnswers] = useState<YesNoAnswers>({});
  return (
    <YesNoQuestions
      label="שאלות ההצהרה"
      questions={questions}
      answers={answers}
      showMissing={showMissing}
      onChange={(id, answer) => setAnswers((current) => ({ ...current, [id]: answer }))}
    />
  );
}

describe("YesNoQuestions", () => {
  it("names each yes/no pair by its question, inside one named group", () => {
    render(<Questions />);
    const group = screen.getByRole("group", { name: "שאלות ההצהרה" });
    const first = within(group).getByRole("group", { name: "שאלה ראשונה לדוגמה?" });
    expect(
      within(first)
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent),
    ).toEqual(["כן", "לא"]);
    expect(within(group).getByRole("group", { name: "שאלה שנייה לדוגמה?" })).toBeInTheDocument();
  });

  it("keeps the two answers of one question exclusive and the questions independent", async () => {
    render(<Questions />);
    const first = screen.getByRole("group", { name: "שאלה ראשונה לדוגמה?" });
    const second = screen.getByRole("group", { name: "שאלה שנייה לדוגמה?" });
    await userEvent.click(within(first).getByRole("radio", { name: "כן" }));
    await userEvent.click(within(second).getByRole("radio", { name: "לא" }));
    await userEvent.click(within(first).getByRole("radio", { name: "לא" }));
    expect(within(first).getByRole("radio", { name: "לא" })).toBeChecked();
    expect(within(first).getByRole("radio", { name: "כן" })).not.toBeChecked();
    expect(within(second).getByRole("radio", { name: "לא" })).toBeChecked();
  });

  it("reports the question id and the answer", async () => {
    const onChange = vi.fn();
    render(<YesNoQuestions label="שאלות" questions={questions} answers={{}} onChange={onChange} />);
    await userEvent.click(screen.getAllByRole("radio", { name: "כן" })[1]!);
    expect(onChange).toHaveBeenCalledWith("q2", true);
  });

  it("marks only the unanswered questions after a submit, in words", async () => {
    const { rerender } = render(
      <YesNoQuestions label="שאלות" questions={questions} answers={{ q1: false }} onChange={() => {}} />,
    );
    expect(screen.queryByText("צריך לענות כן או לא.")).not.toBeInTheDocument();

    rerender(
      <YesNoQuestions label="שאלות" questions={questions} answers={{ q1: false }} onChange={() => {}} showMissing />,
    );
    expect(screen.getAllByText("צריך לענות כן או לא.")).toHaveLength(1);
    expect(screen.getByRole("group", { name: "שאלה שנייה לדוגמה?" })).toHaveAccessibleDescription(
      "צריך לענות כן או לא.",
    );
    expect(screen.getByRole("group", { name: "שאלה ראשונה לדוגמה?" })).not.toHaveAccessibleDescription();
  });

  it("without onChange shows the answers as words and offers no radios", () => {
    render(<YesNoQuestions label="התשובות" questions={questions} answers={{ q1: true }} showMissing />);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(within(screen.getByRole("group", { name: "שאלה ראשונה לדוגמה?" })).getByText("כן")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "שאלה שנייה לדוגמה?" })).getByText("לא נענתה")).toBeInTheDocument();
    expect(screen.queryByText("צריך לענות כן או לא.")).not.toBeInTheDocument();
  });

  it("allAnswered needs a yes or a no for every question", () => {
    expect(allAnswered(questions, {})).toBe(false);
    expect(allAnswered(questions, { q1: true })).toBe(false);
    expect(allAnswered(questions, { q1: true, q2: false })).toBe(true);
  });
});

function SignatureHarness({
  onValue,
  showErrors = false,
}: {
  onValue?: (value: SignatureValue) => void;
  showErrors?: boolean;
}) {
  const [value, setValue] = useState<SignatureValue>(emptySignature);
  return (
    <Signature
      value={value}
      confirmation="קראתי, והתשובות נכונות"
      showErrors={showErrors}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}

describe("Signature", () => {
  it("starts with the member signing for themselves and no guardian field", () => {
    render(<SignatureHarness />);
    expect(screen.getByRole("group", { name: "חתימה" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "אני, על עצמי" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: /^שם מלא/ })).toBeRequired();
    expect(screen.queryByRole("textbox", { name: /ההורה או האפוטרופוס/ })).not.toBeInTheDocument();
  });

  it("asks for the guardian's name too when a guardian signs, and the value carries both", async () => {
    const onValue = vi.fn();
    render(<SignatureHarness onValue={onValue} />);
    await userEvent.click(screen.getByRole("radio", { name: "הורה או אפוטרופוס" }));
    await userEvent.type(screen.getByRole("textbox", { name: /המתאמן/ }), "חבר דוגמה");
    await userEvent.type(screen.getByRole("textbox", { name: /ההורה או האפוטרופוס/ }), "הורה דוגמה");
    await userEvent.click(screen.getByRole("checkbox", { name: "קראתי, והתשובות נכונות" }));
    expect(onValue).toHaveBeenLastCalledWith({
      signerRole: "guardian",
      signedName: "חבר דוגמה",
      guardianName: "הורה דוגמה",
      confirmed: true,
    });
  });

  it("shows what is missing only after a submit, tied to the controls", () => {
    const { unmount } = render(<SignatureHarness />);
    expect(screen.queryByText("צריך לכתוב שם מלא.")).not.toBeInTheDocument();
    unmount();

    render(<SignatureHarness showErrors />);
    expect(screen.getByRole("textbox", { name: /^שם מלא/ })).toHaveAccessibleDescription("צריך לכתוב שם מלא.");
    const confirm = screen.getByRole("checkbox", { name: "קראתי, והתשובות נכונות" });
    expect(confirm).toHaveAttribute("aria-invalid", "true");
    expect(confirm).toHaveAccessibleDescription("צריך לאשר לפני החתימה.");
  });

  it("signatureErrors asks for a name of two letters or more, the guardian's when a guardian signs, and the confirmation", () => {
    expect(Object.keys(signatureErrors(emptySignature)).sort()).toEqual(["confirmed", "signedName"]);
    expect(signatureErrors({ ...emptySignature, signedName: " א ", confirmed: true })).toHaveProperty("signedName");
    expect(signatureErrors({ ...emptySignature, signerRole: "guardian", signedName: "חבר", confirmed: true })).toEqual({
      guardianName: "צריך לכתוב את השם המלא של ההורה או האפוטרופוס.",
    });
    expect(isSignatureComplete({ ...emptySignature, signedName: "חבר דוגמה", confirmed: true })).toBe(true);
  });
});

describe("HealthStatusChip", () => {
  const cases: [HealthDeclarationStatus, string, string, string][] = [
    ["missing", "tp-chip--warning", "חסרה הצהרת בריאות", "חסרה"],
    ["signed", "tp-chip--success", "הצהרת בריאות חתומה", "חתומה"],
    ["needs_medical_approval", "tp-chip--info", "ממתינה לאישור רפואי", "נדרש אישור"],
    ["expired", "tp-chip--danger", "הצהרת הבריאות פגה", "פגה"],
  ];

  it.each(cases)("%s carries a word and a tone", (status, tone, word) => {
    render(<HealthStatusChip status={status} />);
    expect(screen.getByText(word)).toHaveClass("tp-chip", tone);
  });

  it.each(cases)(
    "%s in a roster row is one word on screen and the full name for a screen reader",
    (status, tone, _word, short) => {
      const { container } = render(<HealthStatusChip status={status} compact />);
      const chip = container.querySelector(".tp-chip");
      expect(chip).toHaveClass(tone);
      expect(chip?.textContent).toBe(`הצהרת בריאות: ${short}`);
      expect(chip?.querySelector(".tp-sr-only")?.textContent).toBe("הצהרת בריאות: ");
    },
  );

  it("gives the four states four different words", () => {
    expect(new Set(cases.map(([, , word]) => word)).size).toBe(4);
    expect(new Set(cases.map(([, tone]) => tone)).size).toBe(4);
  });
});
