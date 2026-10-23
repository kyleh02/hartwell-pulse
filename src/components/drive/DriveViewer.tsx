"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, LoaderCircle, X } from "lucide-react";
import type { DriveEntry } from "@/lib/drive-shared";
import { formatBytes } from "@/lib/assets-shared";
import { DriveKindIcon } from "@/components/drive/DriveKindIcon";
import { cn } from "@/lib/utils/cn";

const FRAMED = new Set(["pdf", "doc", "sheet", "slides", "drawing"]);

/**
 * A shared file, full screen, with the rest of the folder a key press away.
 *
 * Images, video and audio play in place; PDFs and Google Docs open in a frame
 * (Docs as a PDF export, since a client has no Google access to them). On an
 * iPhone a framed PDF shows only its first page, so "Open" gives the whole
 * thing in Safari's own viewer. Everything else gets a clear download.
 */
export function DriveViewer({
  entries,
  index,
  onIndex,
  onClose,
}: {
  entries: DriveEntry[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const entry = entries[index];
  // Which file has finished loading, rather than a flag reset on each change:
  // a picture fetched ahead loads before any reset could run, and the reset
  // would then hide it behind the spinner for good.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const loaded = loadedId === entry?.id;
  const setLoaded = (v: boolean) => setLoadedId(v ? (entry?.id ?? null) : null);
  const seen = (el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth > 0) setLoadedId(entry?.id ?? null);
  };
  const [menu, setMenu] = useState(false);
  const touchX = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const hasPrev = index > 0;
  const hasNext = index < entries.length - 1;

  useEffect(() => {
    setMenu(false);
  }, [entry?.id]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Claimed, so a chat panel underneath stays open.
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft" && hasPrev) onIndex(index - 1);
      else if (e.key === "ArrowRight" && hasNext) onIndex(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, hasPrev, hasNext, onIndex, onClose]);

  // The next and previous pictures are fetched ahead, so stepping through a
  // folder of photos does not stop to load each one.
  useEffect(() => {
    for (const n of [entries[index - 1], entries[index + 1]]) {
      if (n?.kind === "image" && n.view) {
        const img = new Image();
        img.src = n.view;
      }
    }
  }, [entries, index]);

  if (!entry) return null;
  const framed = FRAMED.has(entry.kind) && !!entry.view;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={entry.name}
      className="fixed inset-0 z-[60] flex flex-col bg-black/95 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        if (start === null || framed) return;
        const dx = (e.changedTouches[0]?.clientX ?? start) - start;
        if (dx > 60 && hasPrev) onIndex(index - 1);
        else if (dx < -60 && hasNext) onIndex(index + 1);
      }}
    >
      {/* ---- header ---- */}
      <div className="flex shrink-0 items-center gap-2 px-3 py-2.5 text-white sm:px-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{entry.name}</p>
          <p className="data-mono text-[11px] text-white/50">
            {index + 1} of {entries.length}
            {entry.size ? ` · ${formatBytes(entry.size)}` : ""}
          </p>
        </div>
        {framed && entry.view && (
          <a
            href={entry.view}
            target="_blank"
            rel="noreferrer"
            className="flex h-10 items-center gap-1.5 rounded-[var(--radius-input)] px-3 text-sm text-white/80 hover:bg-white/10 hover:text-white"
          >
            <ExternalLink size={16} /> <span className="hidden sm:inline">Open</span>
          </a>
        )}
        {entry.downloadAs.length > 1 ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu((m) => !m)}
              aria-expanded={menu}
              className="flex h-10 items-center gap-1.5 rounded-[var(--radius-input)] px-3 text-sm text-white/80 hover:bg-white/10 hover:text-white"
            >
              <Download size={16} /> <span className="hidden sm:inline">Download</span>
            </button>
            {menu && (
              <div className="absolute right-0 top-11 z-10 w-44 overflow-hidden rounded-[var(--radius-input)] border border-white/15 bg-neutral-900 py-1 shadow-xl">
                {entry.downloadAs.map((d) => (
                  <a
                    key={d.label}
                    href={d.url}
                    onClick={() => setMenu(false)}
                    className="block px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white"
                  >
                    As {d.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        ) : entry.download ? (
          <a
            href={entry.download}
            className="flex h-10 items-center gap-1.5 rounded-[var(--radius-input)] px-3 text-sm text-white/80 hover:bg-white/10 hover:text-white"
          >
            <Download size={16} /> <span className="hidden sm:inline">Download</span>
          </a>
        ) : null}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-input)] text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X size={22} />
        </button>
      </div>

      {/* ---- the file ---- */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-3 sm:px-16">
        {!loaded && entry.view && (
          <LoaderCircle size={28} className="absolute animate-spin text-white/50" aria-label="Loading" />
        )}
        {entry.kind === "image" && entry.view ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={entry.id}
            ref={seen}
            src={entry.view}
            alt={entry.name}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
            className={cn(
              "max-h-full max-w-full object-contain transition-opacity duration-200",
              loaded ? "opacity-100" : "opacity-0",
            )}
          />
        ) : framed ? (
          <iframe
            key={entry.id}
            src={entry.view as string}
            title={entry.name}
            onLoad={() => setLoaded(true)}
            className="h-full w-full max-w-5xl rounded-md bg-white"
          />
        ) : entry.kind === "video" && entry.view ? (
          <video
            key={entry.id}
            src={entry.view}
            controls
            playsInline
            onLoadedData={() => setLoaded(true)}
            onError={() => setLoaded(true)}
            className="max-h-full max-w-full"
          />
        ) : entry.kind === "audio" && entry.view ? (
          <audio key={entry.id} src={entry.view} controls onLoadedData={() => setLoaded(true)} className="w-full max-w-md" />
        ) : (
          <div className="flex flex-col items-center text-center text-white/80">
            <DriveKindIcon kind={entry.kind} size={48} className="text-white/60" />
            <p className="mt-4 text-sm">There&apos;s no preview for this kind of file.</p>
            {entry.download && (
              <a
                href={entry.download}
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-[10px] bg-pulse-gold px-4 text-sm font-medium text-pulse-bg"
              >
                <Download size={16} /> Download
              </a>
            )}
          </div>
        )}

        {hasPrev && (
          <button
            type="button"
            onClick={() => onIndex(index - 1)}
            aria-label="Previous file"
            className="absolute left-1 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:flex"
          >
            <ChevronLeft size={26} />
          </button>
        )}
        {hasNext && (
          <button
            type="button"
            onClick={() => onIndex(index + 1)}
            aria-label="Next file"
            className="absolute right-1 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:flex"
          >
            <ChevronRight size={26} />
          </button>
        )}
      </div>
    </div>
  );
}
