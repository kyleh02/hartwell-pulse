"use client";

import { WorkItemRow } from "@/components/work/WorkItemRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { TZ, type WorkRow } from "@/lib/work-shared";

function whenLabel(r: WorkRow): string {
  const at = r.done_at ?? r.dropped_at;
  if (!at) return "";
  return new Date(at).toLocaleDateString("en-AU", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * What has been finished, and what was decided against.
 *
 * Two reasons this exists. A tick that makes something vanish with no way back
 * is a tick nobody makes confidently, and every row here has Put it back on
 * it. And a decision not to do something is worth being able to read later:
 * "why is this not on the list" has no answer if the row is gone, which is
 * why Not doing drops rather than deletes.
 *
 * The last fifty, newest first. This is a place to check something, not an
 * archive to browse.
 */
export function DoneList({ rows }: { rows: WorkRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing finished yet"
        description="Things you tick off, and things you decide against, collect here with a way to put them back."
      />
    );
  }

  const done = rows.filter((r) => r.state === "done");
  const dropped = rows.filter((r) => r.state === "dropped");

  return (
    <div>
      {done.length > 0 && (
        <section className="mb-10">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="mono-label">Done</span>
            <span className="data-mono text-xs text-pulse-text-mute">
              {done.length}
            </span>
            <span className="h-px flex-1 bg-pulse-border" />
          </div>
          <div className="space-y-2.5">
            {done.map((r) => (
              <div key={r.id}>
                <p className="mb-1 text-xs text-pulse-text-mute">{whenLabel(r)}</p>
                <WorkItemRow row={r} />
              </div>
            ))}
          </div>
        </section>
      )}

      {dropped.length > 0 && (
        <section className="mb-10">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="mono-label">Not doing</span>
            <span className="data-mono text-xs text-pulse-text-mute">
              {dropped.length}
            </span>
            <span className="h-px flex-1 bg-pulse-border" />
          </div>
          <div className="space-y-2.5">
            {dropped.map((r) => (
              <div key={r.id}>
                <p className="mb-1 text-xs text-pulse-text-mute">
                  {whenLabel(r)}
                  {r.drop_reason && ` · ${r.drop_reason}`}
                </p>
                <WorkItemRow row={r} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
