import { cn } from "@/lib/utils/cn";

type Tone = "neutral" | "gold" | "success" | "warn" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "border-pulse-border text-pulse-text-dim bg-pulse-surface-2",
  gold: "border-pulse-gold/30 text-pulse-gold bg-pulse-gold/10",
  success: "border-pulse-success/30 text-pulse-success bg-pulse-success/10",
  warn: "border-pulse-warn/30 text-pulse-warn bg-pulse-warn/10",
  danger: "border-pulse-danger/30 text-pulse-danger bg-pulse-danger/10",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5",
        "data-mono text-[10px] uppercase tracking-[0.12em]",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
