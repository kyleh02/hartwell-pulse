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
        "report-block my-8 grid gap-3.5",
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
          className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface-2/50 px-4 py-4"
        >
          <p className="mono-label leading-tight">{s.label}</p>
          <p className="data-mono mt-2.5 text-[1.6rem] leading-none text-pulse-text">
            {s.value}
          </p>
          {s.note && (
            <p className="mt-1.5 text-xs leading-tight text-pulse-text-mute">
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
    <div className="report-block my-8">
      {title && <p className="mono-label mb-4">{title}</p>}
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
      <ul className="space-y-5">
        {items.map((it, i) => (
          <li key={i}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[0.875rem] text-pulse-text-dim">
                {it.label}
              </span>
              <span className="data-mono shrink-0 text-[0.875rem] text-pulse-text">
                {it.display}
                {it.display2 !== undefined && (
                  <span className="text-pulse-text-mute"> · {it.display2}</span>
                )}
              </span>
            </div>
            <div className="mt-2 space-y-1.5">
              <div className="h-2.5 overflow-hidden rounded-[3px] bg-pulse-surface-2">
                <div
                  className="h-full rounded-[3px] bg-pulse-gold"
                  style={{ width: `${Math.max(1, (it.value / max) * 100)}%` }}
                />
              </div>
              {it.value2 !== undefined && (
                <div className="h-2.5 overflow-hidden rounded-[3px] bg-pulse-surface-2">
                  <div
                    className="h-full rounded-[3px] bg-pulse-gold/35"
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
    <div className="report-block my-8 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface-2/50 p-5">
      {title && <p className="mono-label mb-3">{title}</p>}
      <div className="grid grid-cols-2 gap-6">
        {[left, right].map((s, i) => (
          <div key={i} className={i === 1 ? "border-l border-pulse-border pl-6" : ""}>
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
      {note && <p className="mt-4 text-[0.875rem] leading-relaxed text-pulse-text-dim">{note}</p>}
    </div>
  );
}

/**
 * An aside the writer wants read, not skimmed past.
 *
 * A report carries two kinds of paragraph: the account of what happened, and
 * the caveat that stops a number being trusted further than it deserves. Both
 * were rendering as identical prose, so the caveat was the easiest thing on the
 * page to miss, which is the opposite of what it is for.
 *
 * One style rather than two. The drafts these come from use a light box and a
 * dark box, but that is their visual language and this document has its own;
 * two boxes competing for the same job is a decision to make on every callout
 * for no gain in meaning.
 */
export function NoteBlock({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="report-block my-8 border-l-2 border-pulse-gold bg-pulse-surface-2/50 py-5 pl-5 pr-5">
      {title && <p className="mono-label mb-3">{title}</p>}
      <div className="space-y-3.5 text-[0.9375rem] leading-[1.75] text-pulse-text-dim">
        {children}
      </div>
    </div>
  );
}
