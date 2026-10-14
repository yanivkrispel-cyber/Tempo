import {
  createContext,
  useContext,
  useId,
  type AriaAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from "react";
import { cx } from "./cx";

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldProps {
  label: ReactNode;
  /** A hint under the control. */
  help?: ReactNode;
  /** Replaces the hint and marks the control invalid. */
  error?: ReactNode;
  required?: boolean;
  className?: string;
  /** One Input, Select or Textarea: it is wired to the label, the hint and the error. */
  children: ReactNode;
}

export function Field({ label, help, error, required = false, className, children }: FieldProps) {
  const id = useId();
  const invalid = Boolean(error);
  const message = invalid ? error : help;
  const messageId = `${id}-message`;

  return (
    <FieldContext.Provider value={{ id, describedBy: message ? messageId : undefined, invalid, required }}>
      <div className={cx("tp-field", invalid && "tp-field--invalid", className)}>
        <label className="tp-field__label" htmlFor={id}>
          {label}
          {required && (
            <span className="tp-req" aria-hidden="true">
              *
            </span>
          )}
        </label>
        {children}
        {message && (
          <p id={messageId} className="tp-field__help">
            {message}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

interface ControlProps extends AriaAttributes {
  id?: string;
  required?: boolean;
}

/** Inside a Field, the control takes the Field's id, description, validity and required flag. */
export function useFieldControl<P extends ControlProps>(props: P): P {
  const field = useContext(FieldContext);
  if (!field) return props;
  return {
    ...props,
    id: props.id ?? field.id,
    required: props.required ?? field.required,
    "aria-describedby": cx(field.describedBy, props["aria-describedby"]) || undefined,
    "aria-invalid": field.invalid || props["aria-invalid"] || undefined
  };
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** The search look, with a magnifier on the leading side. */
  search?: boolean;
}

export function Input({ search = false, className, ...rest }: InputProps) {
  return <input className={cx("tp-input", search && "tp-input--search", className)} {...useFieldControl(rest)} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx("tp-select", className)} {...useFieldControl(rest)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx("tp-textarea", className)} {...useFieldControl(rest)} />;
}
