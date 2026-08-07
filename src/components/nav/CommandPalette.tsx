"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import { clientNav, adminNav } from "@/lib/nav";
import { searchEverything, type SearchHit } from "@/app/actions/search";
import { cn } from "@/lib/utils/cn";

const OPEN_EVENT = "pulse:command-palette";

/**
 * Opens the palette from anywhere without lifting its state into the shell.
 *
 * A window event rather than context because the palette owns a fair amount of
 * state (query, results, active row, in-flight request) and none of it is any
 * business of the header button that happens to open it.
 */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/**
 * Cmd+K from anywhere.
 *
 * The portal has clients, invoices, reports, messages, assets, copy and a
 * pipeline of prospects, all of them two or three clicks down a sidebar. This
 * turns every one of those into a keystroke and a few letters.
 *
 * With no query it lists the pages, so the shortcut is also just a faster
 * sidebar. Typing searches records. Searching happens on the server through
 * RLS, so a client account gets their own things and nothing else.
 */
export function CommandPalette({ variant }: { variant: "client" | "admin" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against a slow early request landing after a faster later one and
  // repainting the list with results for a query you have already changed.
  const seq = useRef(0);

  const nav = variant === "admin" ? adminNav : clientNav;

  const pages: SearchHit[] = nav
    .filter((n) =>
      query.trim() ? n.label.toLowerCase().includes(query.trim().toLowerCase()) : true,
    )
    .map((n) => ({
      id: `nav-${n.href}`,
      group: "Go to",
      title: n.label,
      subtitle: null,
      href: n.href,
    }));

  const results = [...pages, ...hits];

  // ---- open / close ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    };
    const openIt = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, openIt);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, openIt);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHits([]);
      setActive(0);
      // Next frame, so the input exists before we reach for it.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // ---- search, debounced ----
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await searchEverything(q);
        if (mine !== seq.current) return; // a newer query has already gone out
        setHits(r);
        setActive(0);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  const go = useCallback(
    (hit: SearchHit) => {
      setOpen(false);
      router.push(hit.href);
    },
    [router],
  );

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[active];
      if (hit) go(hit);
    }
  }

  if (!open) return null;

  let lastGroup = "";

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="relative flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-[var(--radius-card)] border border-pulse-border-strong bg-pulse-surface shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-pulse-border px-4">
          <Search size={16} className="shrink-0 text-pulse-text-mute" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search clients, invoices, reports, files…"
            className="h-12 flex-1 bg-transparent text-sm text-pulse-text placeholder:text-pulse-text-mute focus:outline-none"
          />
          {loading && (
            <span className="data-mono shrink-0 text-[11px] text-pulse-text-mute">
              searching
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-pulse-text-mute">
              {query.trim().length < 2
                ? "Type at least two letters."
                : loading
                  ? "Looking…"
                  : "Nothing matches that."}
            </p>
          ) : (
            results.map((hit, i) => {
              const newGroup = hit.group !== lastGroup;
              lastGroup = hit.group;
              return (
                <div key={hit.id}>
                  {newGroup && (
                    <p className="mono-label px-3 pb-1 pt-3 first:pt-1">
                      {hit.group}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => go(hit)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[var(--radius-input)] px-3 py-2 text-left",
                      i === active ? "bg-pulse-surface-2" : "hover:bg-pulse-surface-2/60",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-pulse-text">
                        {hit.title}
                      </span>
                      {hit.subtitle && (
                        <span className="data-mono block truncate text-[11px] text-pulse-text-mute">
                          {hit.subtitle}
                        </span>
                      )}
                    </span>
                    {i === active && (
                      <CornerDownLeft
                        size={13}
                        className="shrink-0 text-pulse-text-mute"
                      />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-pulse-border px-4 py-2">
          <span className="data-mono text-[11px] text-pulse-text-mute">
            ↑↓ to move · ⏎ to open · esc to close
          </span>
          <span className="data-mono text-[11px] text-pulse-text-mute">⌘K</span>
        </div>
      </div>
    </div>
  );
}
