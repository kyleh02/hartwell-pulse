import Link from "next/link";
import { FileText } from "lucide-react";
import type { CopyDocument, CopyDocStatus } from "@/lib/types/database";
import { cn } from "@/lib/utils/cn";

const STATUS: Record<CopyDocStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "text-pulse-text-mute" },
  submitted: { label: "Submitted", cls: "text-pulse-warn" },
  approved: { label: "Approved", cls: "text-pulse-success" },
  changes_requested: { label: "Changes requested", cls: "text-pulse-danger" },
};

export function CopyDocList({
  docs,
  basePath,
}: {
  docs: CopyDocument[];
  basePath: string;
}) {
  return (
    <div className="space-y-2">
      {docs.map((d) => {
        const st = STATUS[d.status];
        return (
          <Link
            key={d.id}
            href={`${basePath}/${d.id}`}
            className="flex items-center gap-3 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface p-3 transition-colors hover:border-pulse-border-strong"
          >
            <FileText size={16} className="shrink-0 text-pulse-text-mute" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-pulse-text">
                {d.title || "Untitled"}
              </p>
              <p className="data-mono truncate text-xs text-pulse-text-mute">
                Updated {new Date(d.updated_at).toLocaleDateString("en-AU")}
              </p>
            </div>
            <span
              className={cn(
                "data-mono shrink-0 text-[10px] uppercase tracking-wider",
                st.cls,
              )}
            >
              {st.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
