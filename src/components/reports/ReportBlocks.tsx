import { cn } from "@/lib/utils/cn";

/**
 * Visual blocks a report body can declare.
 *
 * Deliberately CSS rather than a charting library. A report is read on a phone
 * and printed to PDF as often as it is read on a desktop, and a canvas chart
 * survives neither well: it needs JavaScript to draw, and it prints as a blur
 * or not at all. Bars built from divs render server-side, print sharply, and
 * carry their own numbers so the chart is never the only source of the value.
 */

export interface StatItem {
  label: string;
  value: string;
  note?: string;
}

export function StatRow({ items }: { items: StatItem[] }) {
  if (items.length === 0) return null;
  return (
    <div
      className={cn(
        "report-block my-4 grid gap-2",
        items.length <= 2
          ? "grid-cols-2"
          : items.length === 3
            ? "grid-cols-3"
            : "grid-cols-2 sm:grid-cols-4",
      )}
    >
      {items.map((s, i) => (
        <div
          key={i}
          className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface-2/50 px-3 py-2.5"
        >
          <p className="mono-label leading-tight">{s.label}</p>
          <p className="data-mono mt-1 text-lg leading-none text-pulse-text">
            {s.value}
          </p>
          {s.note && (
            <p className="mt-1 text-[11px] leading-tight text-pulse-text-mute">
              {s.note}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export interface BarItem {
  label: string;
  value: number;
  display: string;
  /** A second series drawn under the first, for comparisons. */
  value2?: number;
  display2?: string;
}

export function BarChart({
  title,
  items,
  legend,
}: {
  title?: string;
  items: BarItem[];
  legend?: [string, string];
}) {
  if (items.length === 0) return null;
  // Scale to the largest value present so the longest bar fills the row.
  const max = Math.max(
    1,
    ...items.map((i) => Math.max(i.value, i.value2 ?? 0)),
  );

  return (
    <div className="report-block my-4">
      {title && <p className="mono-label mb-2">{title}</p>}
      {legend && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5 text-[11px] text-pulse-text-mute">
            <span className="h-2 w-3 rounded-[2px] bg-pulse-gold" />
            {legend[0]}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-pulse-text-mute">
            <span className="h-2 w-3 rounded-[2px] bg-pulse-gold/35" />
            {legend[1]}
          </span>
        </div>
      )}
      <ul className="space-y-2.5">
        {items.map((it, i) => (
          <li key={i}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-xs text-pulse-text-dim">
                {it.label}
              </span>
              <span className="data-mono shrink-0 text-xs text-pulse-text">
                {it.display}
                {it.display2 !== undefined && (
                  <span className="text-pulse-text-mute"> · {it.display2}</span>
                )}
              </span>
            </div>
            <div className="mt-1 space-y-1">
              <div className="h-2 overflow-hidden rounded-[2px] bg-pulse-surface-2">
                <div
                  className="h-full rounded-[2px] bg-pulse-gold"
                  style={{ width: `${Math.max(1, (it.value / max) * 100)}%` }}
                />
              </div>
              {it.value2 !== undefined && (
                <div className="h-2 overflow-hidden rounded-[2px] bg-pulse-surface-2">
                  <div
                    className="h-full rounded-[2px] bg-pulse-gold/35"
                    style={{ width: `${Math.max(1, (it.value2 / max) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Two figures side by side. Used where the comparison IS the finding, such as
 * mobile ranking against desktop.
 */
export function Compare({
  title,
  left,
  right,
  note,
}: {
  title?: string;
  left: StatItem;
  right: StatItem;
  note?: string;
}) {
  return (
    <div className="report-block my-4 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface-2/50 p-4">
      {title && <p className="mono-label mb-3">{title}</p>}
      <div className="grid grid-cols-2 gap-4">
        {[left, right].map((s, i) => (
          <div key={i} className={i === 1 ? "border-l border-pulse-border pl-4" : ""}>
            <p className="mono-label leading-tight">{s.label}</p>
            <p className="data-mono mt-1 text-2xl leading-none text-pulse-text">
              {s.value}
            </p>
            {s.note && (
              <p className="mt-1 text-[11px] text-pulse-text-mute">{s.note}</p>
            )}
          </div>
        ))}
      </div>
      {note && <p className="mt-3 text-xs text-pulse-text-dim">{note}</p>}
    </div>
  );
}
