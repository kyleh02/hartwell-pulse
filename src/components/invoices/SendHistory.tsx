import type { EmailEvent, InvoiceSend } from "@/lib/types/database";
import { DeliveryDot } from "@/components/ui/DeliveryDot";
import { deliveryFor } from "@/lib/email-delivery";
import { formatMoney } from "@/lib/invoices-shared";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Every time this invoice was emailed, and what it said at the time.
 *
 * The reason it exists: an invoice can now be corrected and reissued under the
 * same number, which is the right thing to do for an unpaid one that was
 * wrong. Without a record, "what did Daryl actually receive on the 7th, and
 * for how much" has no answer once the invoice has been edited.
 *
 * Addresses rather than names, because the row is evidence of delivery and an
 * address is what was actually delivered to.
 */
export function SendHistory({
  sends,
  events = [],
}: {
  sends: InvoiceSend[];
  events?: EmailEvent[];
}) {
  if (sends.length === 0) return null;

  return (
    <div className="no-print rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
      <p className="mono-label mb-3">Send history</p>
      <ol className="space-y-2.5">
        {sends.map((s) => (
          <li
            key={s.id}
            className="border-l-2 border-pulse-border pl-3 text-xs leading-relaxed"
          >
            <p className="text-pulse-text">
              <span className="data-mono">{when(s.sent_at)}</span>
              <span className="text-pulse-text-mute">
                {" "}
                · {s.kind === "resend" ? "resent" : "sent"}
                {s.revision > 0 && ` · rev ${s.revision}`}
              </span>
            </p>
            <p className="data-mono text-pulse-text-dim">
              {formatMoney(Number(s.total))}
            </p>
            {s.sent_to.length > 0 ? (
              <ul className="mt-0.5 space-y-0.5">
                {s.sent_to.map((address) => {
                  const ev = deliveryFor(events, address, s.sent_at);
                  return (
                    <li
                      key={address}
                      className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                    >
                      <span className="data-mono break-all text-[11px] text-pulse-text-mute">
                        {address}
                      </span>
                      {ev && <DeliveryDot status={ev.status} />}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="data-mono text-[11px] text-pulse-text-mute">
                recipients not recorded
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
