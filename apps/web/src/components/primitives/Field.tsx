import { CircleAlert, Search } from "lucide-react";
import { useId, type InputHTMLAttributes, type Ref } from "react";
import { cx } from "../../lib/cx";
import { Kbd } from "./Kbd";

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & { ref?: Ref<HTMLInputElement>; inputClassName?: string };

/**
 * design/components/Field: a visible label, the input, then help or an error. An error sets aria-invalid
 * and is announced with the field. Validate on blur and clear the error once the value is fixed (the
 * caller owns the error text: say what happened and how to fix it).
 */
export function Field({ label, help, error, id, className, inputClassName, ...input }: InputProps & { label: string; help?: string; error?: string; className?: string }) {
  const auto = useId();
  const inputId = id ?? auto;
  const noteId = `${inputId}-note`;
  return (
    <div className={cx("rj-field", className)}>
      <label className="rj-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input id={inputId} className={cx("rj-input", inputClassName)} aria-invalid={error ? true : undefined} aria-describedby={error || help ? noteId : undefined} {...input} />
      {error ? (
        <p className="rj-field__error" id={noteId}>
          <CircleAlert className="rj-icon" aria-hidden />
          {error}
        </p>
      ) : (
        help && (
          <p className="rj-field__help" id={noteId}>
            {help}
          </p>
        )
      )}
    </div>
  );
}

/** design/components/Field (search): an icon, a visually hidden label, and the "/" shortcut. */
export function SearchField({ label, shortcut = "/", id, className, inputClassName, ...input }: InputProps & { label: string; shortcut?: string; className?: string }) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className={cx("rj-search", className)}>
      <Search className="rj-icon" aria-hidden />
      <label className="rj-sr" htmlFor={inputId}>
        {label}
      </label>
      <input id={inputId} type="search" className={cx("rj-input", inputClassName)} aria-keyshortcuts={shortcut || undefined} {...input} />
      {shortcut && <Kbd hidden>{shortcut}</Kbd>}
    </div>
  );
}
