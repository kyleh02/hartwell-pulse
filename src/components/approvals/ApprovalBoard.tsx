import Link from "next/link";
import { CalendarClock, Paperclip } from "lucide-react";
import { COLUMNS, dueLabel } from "@/lib/approvals-shared";
import type { ApprovalRow } from "@/lib/approvals";
import { businessToday } from "@/lib/business-time";
import { KIND_ICON, KindChip } from "@/components/approvals/ApprovalBits";
import { cn } from "@/lib/utils/cn";

/**
 * The approval board: what is waiting on the client, what is back with Kyle,
 * and what is signed off. On a phone the columns stack in that order, so the
 * first thing a client sees is what is theirs to do.
 */
export function ApprovalBoard({
  rows,
  role,
  hrefBase,
}: {
  rows: ApprovalRow[];
  role: "client" | "admin";
  hrefBase: string;
}) {
  const today = businessToday();
  const drafts = rows.filter((r) => r.status === "draft");

  return (
    <div className="space-y-8">
      {role === "admin" && drafts.length > 0 && (
        <section>
          <h2 className="card-title mb-3">Drafts, not sent yet</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {drafts.map((r) => (
              <Card key={r.id} row={r} role={role} href={`${hrefBase}/${r.id}`} today={today} />
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {COLUMNS.map((col) => {
          const items = rows.filter((r) => r.status === col.status);
          return (
            <section key={col.status} aria-label={role === "client" ? col.client : col.admin}>
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h2 className="card-title">{role === "client" ? col.client : col.admin}</h2>
                <span className="data-mono text-xs text-pulse-text-mute">{items.length}</span>
              </div>
              <div className="space-y-3">
                {items.length === 0 ? (
                  <p className="rounded-[20px] border border-dashed border-pulse-border px-4 py-6 text-center text-sm text-pulse-text-mute">
                    {role === "client" ? col.empty.client : col.empty.admin}
                  </p>
                ) : (
                  items.map((r) => (
                    <Card key={r.id} row={r} role={role} href={`${hrefBase}/${r.id}`} today={today} />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Card({
  row,
  role,
  href,
  today,
}: {
  row: ApprovalRow;
  role: "client" | "admin";
  href: string;
  today: string;
}) {
  const Icon = KIND_ICON[row.kind];
  const due = dueLabel(row.due_on);
  const late = row.due_on && row.status === "waiting" && row.due_on < today;
  const yours = role === "client" && row.status === "waiting";
  return (
    <Link
      href={href}
      className={cn(
        "lift group flex flex-col overflow-hidden rounded-[20px] border bg-pulse-surface",
        yours ? "border-pulse-warn/40" : "border-pulse-border",
      )}
    >
      {row.cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.cover} alt="" loading="lazy" className="aspect-[16/10] w-full object-cover" />
      ) : (
        <div className="flex aspect-[16/10] w-full items-center justify-center bg-pulse-gold/5">
          <Icon size={30} strokeWidth={1.4} className="text-pulse-gold/60" aria-hidden="true" />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-5">
        <p className="text-[15px] leading-snug font-extrabold tracking-[0.02em] break-words text-pulse-text uppercase transition-colors group-hover:text-pulse-gold">
          {row.title}
        </p>
        <div>
          <KindChip kind={row.kind} channel={row.channel} />
        </div>
        {role === "admin" && row.clientName && <p className="text-xs text-pulse-text-dim">{row.clientName}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-pulse-text-mute">
          {due && (
            <span className={cn("inline-flex items-center gap-1", late && "text-pulse-warn")}>
              <CalendarClock size={12} aria-hidden="true" /> {late ? "Was due" : "Due"} {due}
            </span>
          )}
          {row.round > 1 && <span>Version {row.round}</span>}
          {row.fileCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Paperclip size={12} aria-hidden="true" /> {row.fileCount}
            </span>
          )}
        </div>
        {yours && (
          <p className="pt-1 text-[11px] font-bold tracking-[0.16em] text-pulse-gold uppercase">Review it</p>
        )}
      </div>
    </Link>
  );
}
