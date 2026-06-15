import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatDeltaPct, type Delta } from "@/lib/metrics";

const TONE: Record<Delta["tone"], string> = {
  good: "text-pulse-success",
  bad: "text-pulse-danger",
  neutral: "text-pulse-text-mute",
};

// The arrow shows which way the number moved; the colour shows whether that is
// good or bad for the client. So a falling cost per lead is a green down-arrow.
export function DeltaBadge({
  delta,
  className,
}: {
  delta: Delta;
  className?: string;
}) {
  const Icon =
    delta.direction === "up"
      ? ArrowUp
      : delta.direction === "down"
        ? ArrowDown
        : Minus;
  return (
    <span
      className={cn(
        "data-mono inline-flex items-center gap-1 text-xs",
        TONE[delta.tone],
        className,
      )}
    >
      <Icon size={13} strokeWidth={2} />
      {formatDeltaPct(delta.pct)}
    </span>
  );
}
