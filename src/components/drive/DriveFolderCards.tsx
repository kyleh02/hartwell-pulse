import Link from "next/link";
import { ArrowRight, FolderOpen } from "lucide-react";

export interface DriveFolderCard {
  id: string;
  title: string;
}

/**
 * The shared Drive folders, at the top of Assets. They lead the page because
 * they are what Kyle has sent; the client's own uploads sit underneath.
 */
export function DriveFolderCards({
  links,
  base,
  role,
}: {
  links: DriveFolderCard[];
  base: string;
  role: "client" | "admin";
}) {
  if (links.length === 0) return null;
  return (
    <section className="mb-8">
      <p className="mono-label mb-3">{role === "client" ? "Shared with you" : "Shared from Drive"}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <Link
            key={l.id}
            href={`${base}/drive/${l.id}`}
            className="group flex items-center gap-3 rounded-[var(--radius-card)] border border-pulse-gold/30 bg-pulse-surface p-4 transition-colors hover:border-pulse-gold/60"
            style={{
              backgroundImage:
                "radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--pulse-gold) 10%, transparent) 0%, transparent 60%)",
            }}
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-pulse-gold/12 text-pulse-gold">
              <FolderOpen size={22} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium text-pulse-text">{l.title}</span>
              <span className="block text-xs text-pulse-text-dim">
                {role === "client" ? "Open, download, or drop files in" : "As the client sees it"}
              </span>
            </span>
            <ArrowRight
              size={16}
              aria-hidden="true"
              className="shrink-0 text-pulse-text-mute transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
            />
          </Link>
        ))}
      </div>
    </section>
  );
}
