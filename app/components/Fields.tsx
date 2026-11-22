import { on } from "./bool-attrs";
import { readChecked, readValue, useFieldEvents } from "./use-field-events";

type BaseProps = {
  label: string;
  name?: string;
  error?: string;
  details?: string;
  disabled?: boolean;
  required?: boolean;
  /** Keep the label for screen readers only (a visual header names the column). */
  labelHidden?: boolean;
};

const labelVisibility = (hidden?: boolean) =>
  hidden ? { labelAccessibilityVisibility: "exclusive" as const } : {};

export function TextField(
  props: BaseProps & {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    maxLength?: number;
  },
) {
  const ref = useFieldEvents<HTMLElementTagNameMap["s-text-field"]>(
    (el) => props.onChange(readValue(el)),
    props.value,
  );
  return (
    <s-text-field
      ref={ref}
      label={props.label}
      {...labelVisibility(props.labelHidden)}
      name={props.name}
      value={props.value}
      error={props.error}
      details={props.details}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      {...on({ disabled: props.disabled, required: props.required })}
    />
  );
}

export function NumberField(
  props: BaseProps & {
    value: string;
    onChange: (value: string) => void;
    min?: number;
    max?: number;
    step?: number;
    prefix?: string;
    suffix?: string;
  },
) {
  const ref = useFieldEvents<HTMLElementTagNameMap["s-number-field"]>(
    (el) => props.onChange(readValue(el)),
    props.value,
  );
  return (
    <s-number-field
      ref={ref}
      label={props.label}
      {...labelVisibility(props.labelHidden)}
      name={props.name}
      value={props.value}
      error={props.error}
      details={props.details}
      min={props.min}
      max={props.max}
      step={props.step}
      prefix={props.prefix}
      suffix={props.suffix}
      {...on({ disabled: props.disabled, required: props.required })}
    />
  );
}

export function SelectField(
  props: BaseProps & {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
  },
) {
  const ref = useFieldEvents<HTMLElementTagNameMap["s-select"]>(
    (el) => props.onChange(readValue(el)),
    props.value,
  );
  return (
    <s-select
      ref={ref}
      label={props.label}
      {...labelVisibility(props.labelHidden)}
      name={props.name}
      value={props.value}
      error={props.error}
      details={props.details}
      {...on({ disabled: props.disabled })}
    >
      {props.options.map((option) => (
        <s-option key={option.value} value={option.value}>
          {option.label}
        </s-option>
      ))}
    </s-select>
  );
}

export function ColorField(
  props: BaseProps & { value: string; onChange: (value: string) => void },
) {
  const ref = useFieldEvents<HTMLElementTagNameMap["s-color-field"]>(
    (el) => props.onChange(readValue(el)),
    props.value,
  );
  return (
    <s-color-field
      ref={ref}
      label={props.label}
      name={props.name}
      value={props.value}
      error={props.error}
      details={props.details}
      {...on({ disabled: props.disabled })}
    />
  );
}

export function Checkbox(
  props: Omit<BaseProps, "error"> & {
    checked: boolean;
    onChange: (checked: boolean) => void;
  },
) {
  const ref = useFieldEvents<HTMLElementTagNameMap["s-checkbox"]>(
    (el) => props.onChange(readChecked(el)),
    props.checked,
  );
  return (
    <s-checkbox
      ref={ref}
      label={props.label}
      name={props.name}
      details={props.details}
      {...on({ checked: props.checked, disabled: props.disabled })}
    />
  );
}
