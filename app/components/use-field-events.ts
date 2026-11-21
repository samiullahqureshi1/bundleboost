import { useEffect, useRef } from "react";

/**
 * Polaris web components dispatch native `input` / `change` events. React 18
 * does not route `onChange` for custom elements through its synthetic event
 * system, so controlled fields subscribe to the DOM events directly.
 */
export function useFieldEvents<T extends HTMLElement>(
  onValue: (element: T) => void,
) {
  const ref = useRef<T>(null);
  const handler = useRef(onValue);
  handler.current = onValue;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const listener = () => handler.current(element);
    element.addEventListener("input", listener);
    element.addEventListener("change", listener);
    return () => {
      element.removeEventListener("input", listener);
      element.removeEventListener("change", listener);
    };
  }, []);

  return ref;
}

export function readValue(element: HTMLElement): string {
  return (element as HTMLElement & { value?: string }).value ?? "";
}

export function readChecked(element: HTMLElement): boolean {
  return Boolean((element as HTMLElement & { checked?: boolean }).checked);
}
