import type { EmailEvent, InvoiceSend } from "@/lib/types/database";
import { DeliveryDot } from "@/components/ui/DeliveryDot";
import { deliveryFor } from "@/lib/email-delivery";

/**
 * One line at the top of an invoice: when it last went, to whom, and whether
 * it arrived.
 *
 * The full history sits underneath the invoice preview, which on a long
 * invoice is well below the fold. That put the answer to "did that actually
 * send" in the one place nobody was looking, and the first thing anyone did
 * after pressing Resend was go and check Resend's own dashboard. This is the
 * same information where the eye already is.
 */
export function LastSent({
  sends,
  events,
}: {
  sends: InvoiceSend[];
  events: EmailEvent[];
}) {
  const last = sends[0]; // the page orders these newest first
  if (!last) return null;

  const when = new Date(last.sent_at).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-pulse-text-mute">
      <span>
        {last.kind === "resend" ? "Resent" : "Sent"} {when}
      </span>
      {last.sent_to.map((address) => {
        const ev = deliveryFor(events, address, last.sent_at);
        return (
          <span key={address} className="flex items-center gap-1.5">
            <span className="data-mono break-all">{address}</span>
            {ev && <DeliveryDot status={ev.status} />}
          </span>
        );
      })}
    </p>
  );
}
