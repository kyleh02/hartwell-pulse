import { cn } from "@/lib/utils/cn";

/**
 * Empty states are invitations to act, not mood pieces. Give it a plain title,
 * a short line on what to do, and (optionally) the action itself.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[var(--radius-card)]",
        "border border-dashed border-pulse-border bg-pulse-surface/40 px-6 py-14 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-pulse-border bg-pulse-surface-2 text-pulse-gold">
          {icon}
        </div>
      )}
      <h3 className="text-base font-medium text-pulse-text">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-pulse-text-dim">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
