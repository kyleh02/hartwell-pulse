import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-pulse-gold text-pulse-bg hover:bg-pulse-gold-light font-medium",
  secondary:
    "bg-pulse-surface-2 text-pulse-text border border-pulse-border hover:border-pulse-border-strong",
  ghost: "text-pulse-text-dim hover:text-pulse-text hover:bg-pulse-surface-2",
  danger:
    "bg-transparent text-pulse-danger border border-pulse-border hover:bg-pulse-danger/10",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md") {
  return cn(
    "inline-flex items-center justify-center rounded-[var(--radius-input)] whitespace-nowrap",
    "transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none",
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
