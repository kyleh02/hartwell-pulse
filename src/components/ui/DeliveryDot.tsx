import { AlertTriangle, Check, CheckCheck, Clock, Eye, XCircle } from "lucide-react";
import type { EmailStatus } from "@/lib/types/database";
import { cn } from "@/lib/utils/cn";

/**
 * What happened to one email.
 *
 * "Sent" means handed to Resend and nothing more, so it is deliberately grey
 * rather than green. The difference between "we sent it" and "it arrived" is
 * the entire reason this exists, and colouring the first one green would throw
 * that away.
 */
const LOOK: Record<
  EmailStatus,
  { label: string; className: string; Icon: typeof Check; title: string }
> = {
  sent: {
    label: "sent",
    className: "text-pulse-text-mute",
    Icon: Clock,
    title: "Handed to the mail provider. No delivery confirmation yet.",
  },
  delivered: {
    label: "delivered",
    className: "text-pulse-success",
    Icon: CheckCheck,
    title: "Accepted by their mail server.",
  },
  opened: {
    label: "opened",
    className: "text-pulse-success",
    Icon: Eye,
    title: "Opened. Image blocking makes this a floor, not a fact.",
  },
  clicked: {
    label: "clicked",
    className: "text-pulse-success",
    Icon: Eye,
    title: "They clicked through to the portal.",
  },
  bounced: {
    label: "bounced",
    className: "text-pulse-danger",
    Icon: XCircle,
    title: "Rejected. Check the address.",
  },
  complained: {
    label: "marked as spam",
    className: "text-pulse-danger",
    Icon: AlertTriangle,
    title: "Reported as spam. Stop emailing this address.",
  },
  failed: {
    label: "failed",
    className: "text-pulse-danger",
    Icon: XCircle,
    title: "Never left. It was not sent.",
  },
};

export function DeliveryDot({
  status,
  className,
}: {
  status: EmailStatus;
  className?: string;
}) {
  const look = LOOK[status] ?? LOOK.sent;
  const Icon = look.Icon;
  return (
    <span
      title={look.title}
      className={cn(
        "inline-flex items-center gap-1 text-[11px]",
        look.className,
        className,
      )}
    >
      <Icon size={11} strokeWidth={2.25} />
      {look.label}
    </span>
  );
}
