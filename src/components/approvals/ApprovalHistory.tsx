import { CircleCheck, MessageSquare, MessageSquareWarning, Send } from "lucide-react";
import type { ApprovalEvent } from "@/lib/approvals-shared";
import { BUSINESS_TZ } from "@/lib/business-time";
import { cn } from "@/lib/utils/cn";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    timeZone: BUSINESS_TZ,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Everything that has happened to a piece of work, oldest first. */
export function ApprovalHistory({ events }: { events: ApprovalEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-pulse-text-mute">Nothing yet.</p>;
  }
  return (
    <ol className="space-y-4">
      {events.map((e) => {
        const Icon =
          e.kind === "sent" ? Send : e.kind === "approved" ? CircleCheck : e.kind === "changes" ? MessageSquareWarning : MessageSquare;
        const who = e.author_name || (e.author_role === "admin" ? "Kyle" : "Client");
        const headline =
          e.kind === "sent"
            ? e.round > 1
              ? `${who} sent version ${e.round}`
              : `${who} sent it for approval`
            : e.kind === "approved"
              ? `${who} approved it`
              : e.kind === "changes"
                ? `${who} asked for changes`
                : who;
        return (
          <li key={e.id} className="flex gap-3">
            <span
              className={cn(
                "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                e.kind === "approved"
                  ? "bg-pulse-success/15 text-pulse-success"
                  : e.kind === "changes"
                    ? "bg-pulse-warn/15 text-pulse-warn"
                    : "bg-pulse-gold/12 text-pulse-gold",
              )}
            >
              <Icon size={14} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-pulse-text">
                <span className="font-semibold">{headline}</span>{" "}
                <span className="text-xs text-pulse-text-mute">{when(e.created_at)}</span>
              </p>
              {e.body && (
                <p className="mt-1 rounded-[12px] bg-pulse-surface-2 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-pulse-text-dim">
                  {e.body}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
