"use client";

import { useState } from "react";
import { ExternalLink, Monitor, Smartphone, Tablet } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface PreviewItem {
  id: string;
  title: string;
  url: string;
  note: string | null;
}

/**
 * The website, live, inside the portal.
 *
 * An iframe rather than screenshots, because a screenshot is out of date the
 * moment it is taken and the whole point is that the client is watching
 * something being built. It is also the real page, so they can click around it.
 *
 * THE FRAME CAN BE REFUSED AND THERE IS NO RELIABLE WAY TO DETECT IT. A site
 * sending X-Frame-Options or a frame-ancestors policy renders blank here, and
 * cross-origin rules mean this page cannot ask why. So "Open in a new tab" is
 * always visible rather than a fallback that appears after a failure nobody can
 * see, and the note underneath says what a blank panel means.
 *
 * The device widths are the point for a client rather than a nicety. "How does
 * it look on my phone" is the first question anyone asks about a new site, and
 * answering it here saves a round trip.
 */
const DEVICES = [
  { key: "desktop", label: "Desktop", width: "100%", Icon: Monitor },
  { key: "tablet", label: "Tablet", width: "768px", Icon: Tablet },
  { key: "mobile", label: "Mobile", width: "390px", Icon: Smartphone },
] as const;

export function SitePreview({ items }: { items: PreviewItem[] }) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? "");
  const [device, setDevice] = useState<(typeof DEVICES)[number]["key"]>("desktop");

  const active = items.find((i) => i.id === activeId) ?? items[0];
  if (!active) return null;

  const width = DEVICES.find((d) => d.key === device)!.width;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {items.length > 1 && (
          <div className="inline-flex flex-wrap gap-1 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface p-1">
            {items.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => setActiveId(i.id)}
                className={cn(
                  "rounded-[var(--radius-input)] px-3 py-1.5 text-xs transition-colors",
                  i.id === active.id
                    ? "bg-pulse-surface-2 text-pulse-text"
                    : "text-pulse-text-mute hover:text-pulse-text-dim",
                )}
              >
                {i.title}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface p-1">
            {DEVICES.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setDevice(key)}
                aria-label={label}
                title={label}
                className={cn(
                  "flex h-8 w-9 items-center justify-center rounded-[var(--radius-input)] transition-colors",
                  device === key
                    ? "bg-pulse-surface-2 text-pulse-text"
                    : "text-pulse-text-mute hover:text-pulse-text-dim",
                )}
              >
                <Icon size={15} />
              </button>
            ))}
          </div>
          <a
            href={active.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-input)] bg-pulse-gold px-4 text-sm font-medium text-pulse-bg transition-colors hover:bg-pulse-gold-light"
          >
            <ExternalLink size={15} /> Open in a new tab
          </a>
        </div>
      </div>

      {active.note && (
        <p className="mb-3 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2/50 px-3 py-2 text-sm text-pulse-text-dim">
          {active.note}
        </p>
      )}

      <div className="overflow-hidden rounded-[var(--radius-card)] border border-pulse-border bg-white">
        <div
          className="mx-auto transition-[width] duration-200"
          style={{ width, maxWidth: "100%" }}
        >
          <iframe
            key={`${active.id}-${device}`}
            src={active.url}
            title={active.title}
            className="h-[70vh] w-full border-0 bg-white"
            sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        </div>
      </div>

      <p className="mt-2 text-[11px] text-pulse-text-mute">
        If the panel above stays blank, the site is set to refuse being shown
        inside another page. Use Open in a new tab instead, it is the same site.
      </p>
    </div>
  );
}
