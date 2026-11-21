/**
 * Ring chart of campaigns by state, total in the middle. Segments run
 * clockwise from 12 o'clock in a fixed order so each state keeps its colour,
 * separated by a small gap.
 */
export type RingSegment = { key: string; label: string; value: number; color: string };

export function StatusRing({
  segments,
  center,
  label,
}: {
  segments: RingSegment[];
  center: { value: number; caption: string };
  label: string;
}) {
  const size = 156;
  const thickness = 12;
  const r = (size - thickness) / 2 - 3;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const shown = segments.filter((s) => s.value > 0);
  const gap = shown.length > 1 ? 2 : 0;

  let offset = 0;
  const arcs = shown.map((s, i) => {
    const length = total ? (s.value / total) * c : 0;
    const arc = { ...s, i, start: offset, length: Math.max(length - gap, 0.5) };
    offset += length;
    return arc;
  });

  return (
    <div className="bb-ringchart">
      <div className="bb-ring" style={{ inlineSize: size, blockSize: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(20, 16, 60, 0.07)" strokeWidth={thickness} />
            {arcs.map((a) => (
              <circle
                key={a.key}
                className="bb-ring__arc"
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={thickness}
                strokeDasharray={`${a.length} ${c - a.length}`}
                strokeDashoffset={-a.start}
                style={{ animationDelay: `${0.15 + a.i * 0.08}s` }}
              >
                <title>{`${a.label}: ${a.value}`}</title>
              </circle>
            ))}
          </g>
        </svg>
        <div className="bb-ring__center">
          <span className="bb-ring__value">{center.value}</span>
          <span className="bb-ring__caption">{center.caption}</span>
        </div>
      </div>

      <ul className="bb-legend">
        {segments.map((s) => (
          <li key={s.key}>
            <i className="bb-swatch" style={{ background: s.color }} aria-hidden="true" />
            <span>{s.label}</span>
            <span className="bb-mono">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
