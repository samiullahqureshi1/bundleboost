import type { ReactNode } from "react";

/** A glass card with a numbered heading ("01  Details"), a hint and an optional count. */
export function EditorCard({
  num,
  title,
  hint,
  aside,
  children,
}: {
  num?: string;
  title: string;
  hint?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bb-glass bb-editcard">
      <header className="bb-cardhead">
        {num && <span className="bb-cardhead__num bb-mono">{num}</span>}
        <h2>{title}</h2>
        {aside && <span className="bb-cardhead__aside bb-mono">{aside}</span>}
        {hint && <p>{hint}</p>}
      </header>
      {children}
    </section>
  );
}
