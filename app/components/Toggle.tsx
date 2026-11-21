import { useId } from "react";

/** A labelled on/off switch row (native checkbox with role="switch"). */
export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="bb-toggle">
      <label htmlFor={id}>
        <strong>{label}</strong>
        <small>{hint}</small>
      </label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
    </div>
  );
}
