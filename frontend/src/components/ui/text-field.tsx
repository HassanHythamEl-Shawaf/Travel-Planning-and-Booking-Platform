import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

interface FieldShellProps {
  label: string;
  id: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

function FieldShell({ label, id, error, hint, children }: FieldShellProps) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function TextField({
  label,
  error,
  hint,
  className = "",
  id,
  ...props
}: TextFieldProps) {
  const fieldId = id ?? props.name ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <FieldShell label={label} id={fieldId} error={error} hint={hint}>
      <input
        id={fieldId}
        className={`input ${error ? "input-invalid" : ""} ${className}`.trim()}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        {...props}
      />
    </FieldShell>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export function SelectField({
  label,
  error,
  hint,
  id,
  children,
  ...props
}: SelectFieldProps) {
  const fieldId = id ?? props.name ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <FieldShell label={label} id={fieldId} error={error} hint={hint}>
      <select
        id={fieldId}
        className={`input select-input ${error ? "input-invalid" : ""}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
}

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function TextAreaField({
  label,
  error,
  hint,
  id,
  ...props
}: TextAreaFieldProps) {
  const fieldId = id ?? props.name ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <FieldShell label={label} id={fieldId} error={error} hint={hint}>
      <textarea
        id={fieldId}
        className={`input textarea ${error ? "input-invalid" : ""}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        {...props}
      />
    </FieldShell>
  );
}
