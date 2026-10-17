import { useId } from "react";
import { cx } from "./cx";

export interface YesNoQuestion {
  id: string;
  text: string;
}

/** The answer per question id; a question not in the map is unanswered. */
export type YesNoAnswers = Readonly<Record<string, boolean | undefined>>;

export interface YesNoQuestionsProps {
  questions: readonly YesNoQuestion[];
  answers: YesNoAnswers;
  /** Leave out for the read-only view: each answer is shown as a word. */
  onChange?: (questionId: string, answer: boolean) => void;
  /** The group's accessible name, e.g. "שאלות ההצהרה". */
  label: string;
  /** After a submit: each unanswered question says so. */
  showMissing?: boolean;
  disabled?: boolean;
  className?: string;
}

const answerWord = (answer: boolean) => (answer ? "כן" : "לא");

/** True when every question has a yes or a no. */
export const allAnswered = (questions: readonly YesNoQuestion[], answers: YesNoAnswers) =>
  questions.every((question) => typeof answers[question.id] === "boolean");

/**
 * Yes-or-no questions (the health declaration, docs/31 H-2): one fieldset per question, named by the question, with
 * two native radios, so the arrow keys move between "כן" and "לא" and a screen reader reads the question first.
 * Without `onChange` it is the read-only view of answers already given.
 */
export function YesNoQuestions({
  questions,
  answers,
  onChange,
  label,
  showMissing = false,
  disabled,
  className,
}: YesNoQuestionsProps) {
  const id = useId();
  return (
    <div role="group" aria-label={label} className={cx("tp-questions", className)}>
      {questions.map((question, index) => {
        const answer = answers[question.id];
        const missing = showMissing && onChange !== undefined && typeof answer !== "boolean";
        const name = `${id}-q${index}`;
        const errorId = `${name}-error`;
        return (
          <fieldset
            key={question.id}
            className={cx("tp-question", missing && "tp-question--missing")}
            aria-describedby={missing ? errorId : undefined}
          >
            <legend className="tp-question__text">{question.text}</legend>
            {onChange ? (
              <div className="tp-question__options">
                {[true, false].map((value) => (
                  <label key={String(value)} className="tp-question__opt">
                    <input
                      type="radio"
                      name={name}
                      checked={answer === value}
                      disabled={disabled}
                      onChange={() => onChange(question.id, value)}
                    />
                    <span>{answerWord(value)}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="tp-question__answer">{typeof answer === "boolean" ? answerWord(answer) : "לא נענתה"}</p>
            )}
            {missing && (
              <p id={errorId} className="tp-question__error">
                צריך לענות כן או לא.
              </p>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
