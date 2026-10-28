import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

// The website's buttons: square corners, uppercase, spaced out, and the gold
// one rises with a glow.
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-pulse-gold text-pulse-bg hover:bg-pulse-gold-light hover:-translate-y-px hover:shadow-[0_12px_32px_rgba(181,166,117,0.25)]",
  secondary:
    "bg-pulse-surface-2 text-pulse-text border border-pulse-border hover:border-pulse-border-strong",
  ghost: "text-pulse-text-dim hover:text-pulse-text hover:bg-pulse-surface-2",
  danger:
    "bg-transparent text-pulse-danger border border-pulse-border hover:bg-pulse-danger/10",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[11px] gap-1.5",
  md: "h-10 px-5 text-xs gap-2",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md") {
  return cn(
    "inline-flex items-center justify-center rounded-[2px] whitespace-nowrap font-bold uppercase tracking-[0.14em]",
    "transition-[color,background-color,border-color,transform,box-shadow] duration-200 disabled:opacity-50 disabled:pointer-events-none",
    "motion-reduce:hover:translate-y-0",
    "focus-visible:outline-2 focus-visible:outline-pulse-gold focus-visible:outline-offset-2",
    VARIANTS[variant],
    SIZES[size],
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button className={cn(buttonClasses(variant, size), className)} {...props} />
  );
}
