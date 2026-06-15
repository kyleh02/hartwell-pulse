import { cn } from "@/lib/utils/cn";

/**
 * Monospace small-caps section header, e.g. PERFORMANCE / GOOGLE ADS.
 * Pass the parts and they render with a dim slash between them.
 */
export function SectionLabel({
  parts,
  className,
}: {
  parts: string[];
  className?: string;
}) {
  return (
    <span className={cn("mono-label inline-flex items-center", className)}>
      {parts.map((part, i) => (
        <span key={i} className="inline-flex items-center">
          {i > 0 && <span className="mx-2 text-pulse-text-mute">/</span>}
          <span className={i === parts.length - 1 ? "text-pulse-text-dim" : "text-pulse-text-mute"}>
            {part}
          </span>
        </span>
      ))}
    </span>
  );
}
