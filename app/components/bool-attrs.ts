/**
 * Boolean attributes for Polaris web components.
 *
 * React 18 renders `disabled={false}` on a custom element as the attribute
 * `disabled="false"`, and Polaris treats any present attribute as true — so
 * a button meant to be enabled renders disabled and a checkbox meant to be
 * unchecked renders checked. Spread this instead so a false value omits the
 * attribute entirely:
 *
 *   <s-button {...on({ disabled: busy })}>
 */
export function on<K extends string>(
  attrs: Partial<Record<K, boolean | undefined>>,
): Partial<Record<K, true>> {
  const out: Partial<Record<K, true>> = {};
  for (const key of Object.keys(attrs) as K[]) {
    if (attrs[key]) out[key] = true;
  }
  return out;
}
