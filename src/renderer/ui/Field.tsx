import { useId } from 'react';
import type { ReactNode } from 'react';
import './Field.css';

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="nb-field" data-invalid={error ? '' : undefined}>
      <label className="nb-field__label" htmlFor={id}>
        {label}
      </label>
      {children(id, describedBy)}
      {hint ? (
        <p className="nb-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="nb-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
