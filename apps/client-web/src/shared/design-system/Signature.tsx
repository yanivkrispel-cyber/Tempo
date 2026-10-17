import { useId, type ReactNode } from "react";
import { cx } from "./cx";
import { Field, Input } from "./Field";
import { Checkbox, Radio } from "./Toggle";

/** Who signs (docs/31 H-2, H-7): the member, or a parent or guardian on their behalf. */
export type SignerRole = "self" | "guardian";

export interface SignatureValue {
  signerRole: SignerRole;
  /** The member's full name as signed. */
  signedName: string;
  /** Only when a guardian signs: the guardian's full name. */
  guardianName: string;
  confirmed: boolean;
}

export const emptySignature: SignatureValue = {
  signerRole: "self",
  signedName: "",
  guardianName: "",
  confirmed: false,
};

export interface SignatureErrors {
  signedName?: string;
  guardianName?: string;
  confirmed?: string;
}

/** What is still missing before the form can be signed; an empty object when nothing is. */
export function signatureErrors(value: SignatureValue): SignatureErrors {
  const errors: SignatureErrors = {};
  if (value.signedName.trim().length < 2) errors.signedName = "צריך לכתוב שם מלא.";
  if (value.signerRole === "guardian" && value.guardianName.trim().length < 2)
    errors.guardianName = "צריך לכתוב את השם המלא של ההורה או האפוטרופוס.";
  if (!value.confirmed) errors.confirmed = "צריך לאשר לפני החתימה.";
  return errors;
}

export const isSignatureComplete = (value: SignatureValue) => Object.keys(signatureErrors(value)).length === 0;

export interface SignatureProps {
  value: SignatureValue;
  onChange: (value: SignatureValue) => void;
  /** The confirmation the signer agrees to, e.g. "קראתי, והתשובות נכונות". */
  confirmation: ReactNode;
  /** After a submit: the fields still missing say so. */
  showErrors?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * The end of a form that someone signs (the health declaration): who signs, the typed full name (and the guardian's
 * when a guardian signs), and one confirmation checkbox. The name is echoed on a signature line that is decorative
 * only; the inputs carry the names for assistive technology.
 */
export function Signature({ value, onChange, confirmation, showErrors = false, disabled, className }: SignatureProps) {
  const id = useId();
  const errors = showErrors ? signatureErrors(value) : {};
  const guardian = value.signerRole === "guardian";
  const signer = guardian ? value.guardianName : value.signedName;
  const set = (patch: Partial<SignatureValue>) => onChange({ ...value, ...patch });

  return (
    <div role="group" aria-label="חתימה" className={cx("tp-signature", className)}>
      <fieldset className="tp-signature__roles">
        <legend>מי חותם/ת</legend>
        <Radio
          name={`${id}-role`}
          label="אני, על עצמי"
          checked={!guardian}
          disabled={disabled}
          onChange={() => set({ signerRole: "self" })}
        />
        <Radio
          name={`${id}-role`}
          label="הורה או אפוטרופוס"
          checked={guardian}
          disabled={disabled}
          onChange={() => set({ signerRole: "guardian" })}
        />
      </fieldset>
      <Field label={guardian ? "השם המלא של המתאמן/ת" : "שם מלא"} error={errors.signedName} required>
        <Input
          autoComplete={guardian ? "off" : "name"}
          maxLength={100}
          value={value.signedName}
          disabled={disabled}
          onChange={(event) => set({ signedName: event.target.value })}
        />
      </Field>
      {guardian && (
        <Field label="השם המלא של ההורה או האפוטרופוס" error={errors.guardianName} required>
          <Input
            autoComplete="name"
            maxLength={100}
            value={value.guardianName}
            disabled={disabled}
            onChange={(event) => set({ guardianName: event.target.value })}
          />
        </Field>
      )}
      <div className="tp-signature__line" aria-hidden="true" dir="auto">
        {signer.trim()}
      </div>
      <Checkbox
        className="tp-signature__confirm"
        label={confirmation}
        checked={value.confirmed}
        disabled={disabled}
        aria-invalid={errors.confirmed ? true : undefined}
        aria-describedby={errors.confirmed ? `${id}-confirm-error` : undefined}
        onChange={(event) => set({ confirmed: event.target.checked })}
      />
      {errors.confirmed && (
        <p id={`${id}-confirm-error`} className="tp-signature__error">
          {errors.confirmed}
        </p>
      )}
    </div>
  );
}
