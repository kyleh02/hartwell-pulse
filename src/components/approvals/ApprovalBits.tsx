import { MousePointerClick, Megaphone, Palette, PenLine, type LucideIcon } from "lucide-react";
import { KINDS, statusLabel, type ApprovalKind, type ApprovalStatus } from "@/lib/approvals-shared";
import { cn } from "@/lib/utils/cn";

export const KIND_ICON: Record<ApprovalKind, LucideIcon> = {
  copy: PenLine,
  design: Palette,
  social: Megaphone,
  ad: MousePointerClick,
};

/** Website copy, Design, Social post or Ad, with its icon. */
export function KindChip({ kind, channel }: { kind: ApprovalKind; channel?: string | null }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-pulse-gold/30 bg-pulse-gold/10 px-2.5 py-0.5 text-[11px] font-bold tracking-[0.12em] text-pulse-gold uppercase">
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      <span className="truncate">
        {KINDS[kind].label}
        {channel ? ` · ${channel}` : ""}
      </span>
    </span>
  );
}

const STATUS_TONE: Record<ApprovalStatus, string> = {
  draft: "border-pulse-border text-pulse-text-mute",
  waiting: "border-pulse-warn/50 bg-pulse-warn/10 text-pulse-warn",
  changes: "border-pulse-border-strong text-pulse-text-dim",
  approved: "border-pulse-success/50 bg-pulse-success/10 text-pulse-success",
};

export function StatusPill({ status, role }: { status: ApprovalStatus; role: "client" | "admin" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-[0.12em] uppercase",
        STATUS_TONE[status],
      )}
    >
      {statusLabel(status, role)}
    </span>
  );
}
