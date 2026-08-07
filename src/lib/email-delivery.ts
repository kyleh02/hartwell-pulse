import type { EmailEvent } from "@/lib/types/database";

/**
 * The delivery result for one address on one send.
 *
 * Matched by "the earliest event for that address at or after this send",
 * because an email row carries no send id and giving it one would mean the
 * sender knowing about its own audit trail. Sends to the same person are
 * minutes apart at worst, so nearest-after is unambiguous in practice.
 *
 * The minute of slack absorbs clock skew between the row being written here
 * and Resend stamping the message. An unmatched send returns undefined and
 * shows no marker, rather than guessing.
 */
export function deliveryFor(
  events: EmailEvent[],
  address: string,
  sentAt: string,
): EmailEvent | undefined {
  const floor = new Date(sentAt).getTime() - 60_000;
  return events
    .filter(
      (e) =>
        e.recipient.toLowerCase() === address.toLowerCase() &&
        new Date(e.sent_at).getTime() >= floor,
    )
    .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime())[0];
}
