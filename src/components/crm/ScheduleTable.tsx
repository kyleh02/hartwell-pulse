"use client";

import Link from "next/link";
import { Check, Clock, Send, XCircle } from "lucide-react";
import type { PlanRow } from "@/components/crm/SendPlan";
import { cn } from "@/lib/utils/cn";

const TZ = "Australia/Brisbane";

/**
 * Every scheduled email in one list, in the order it goes out.
 *
 * The day-grouped plan answers "what am I doing today" well and "when is
 * everything going" badly, because the answer is spread over six headings and
 * three sections. This is the whole week on one screen, which is the question
 * actually being asked when someone says "show me the schedule".
 *
 * Status is the point of the last column. Scheduled and approved are different
 * things and the difference decides whether anything happens: a time with no
 * approval is a plan, not a send.
 */
export function ScheduleTable({ rows }: { rows: PlanRow[] }) {
  const scheduled = rows
    .filter((r) => r.scheduled_send_at)
    .sort((a, b) => (a.scheduled_send_at! < b.scheduled_send_at! ? -1 : 1));

  if (scheduled.length === 0) return null;

  const now = Date.now();
  let lastDay = "";

  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="border-b border-pulse-border text-left">
            <th className="mono-label px-4 py-2.5 font-medium">When</th>
            <th className="mono-label px-4 py-2.5 font-medium">Company</th>
            <th className="mono-label px-4 py-2.5 font-medium">To</th>
            <th className="mono-label px-4 py-2.5 text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {scheduled.map((r) => {
            const d = new Date(r.scheduled_send_at!);
            const day = d.toLocaleDateString("en-AU", {
              timeZone: TZ,
              weekday: "short",
              day: "numeric",
              month: "short",
            });
            const newDay = day !== lastDay;
            lastDay = day;

            const sent = Boolean(r.send_attempted_at) && !r.send_error;
            const failed = Boolean(r.send_error);
            const armed = Boolean(r.send_approved_at) && !sent;
            const overdue = armed && d.getTime() <= now;

            return (
              <tr
                key={r.id}
                className={cn(
                  "border-b border-pulse-border last:border-0",
                  newDay && "border-t-2 border-t-pulse-border-strong",
                )}
              >
                <td className="whitespace-nowrap px-4 py-2.5 align-top">
                  <span className="data-mono text-xs text-pulse-text">
                    {newDay ? day : ""}
                  </span>
                  <span
                    className={cn(
                      "data-mono block text-xs",
                      sent ? "text-pulse-text-mute" : "text-pulse-text-dim",
                    )}
                  >
                    {d
                      .toLocaleTimeString("en-AU", {
                        timeZone: TZ,
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                      .toLowerCase()}
                  </span>
                </td>
                <td className="px-4 py-2.5 align-top">
                  <Link
                    href={`/admin/crm/${r.id}`}
                    className="text-pulse-text hover:text-pulse-gold"
                  >
                    {r.trading_name ?? r.legal_name}
                  </Link>
                  <span className="data-mono block text-[11px] text-pulse-text-mute">
                    #{r.rank} · {r.state}
                  </span>
                </td>
                <td className="data-mono px-4 py-2.5 align-top text-[11px] text-pulse-text-mute">
                  {r.contact?.email_as_published}
                </td>
                <td className="px-4 py-2.5 text-right align-top">
                  {failed ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-pulse-danger">
                      <XCircle size={11} /> failed
                    </span>
                  ) : sent ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-pulse-success">
                      <Send size={11} /> sent
                    </span>
                  ) : overdue ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-pulse-warn">
                      <Clock size={11} /> goes within 5 min
                    </span>
                  ) : armed ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-pulse-success">
                      <Check size={11} /> approved
                    </span>
                  ) : (
                    // A time with no approval is a plan, not a send.
                    <span className="text-[11px] text-pulse-text-mute">
                      not approved
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
