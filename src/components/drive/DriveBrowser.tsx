"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ChevronRight,
  CircleAlert,
  CloudUpload,
  Download,
  ExternalLink,
  Folder,
  FolderOpen,
  LayoutGrid,
  List,
  LoaderCircle,
  Play,
  Search,
  X,
} from "lucide-react";
import {
  decodePath,
  encodePath,
  type DriveEntry,
  type DriveListing,
} from "@/lib/drive-shared";
import { formatBytes } from "@/lib/assets-shared";
import { BUSINESS_TZ } from "@/lib/business-time";
import { DriveKindIcon } from "@/components/drive/DriveKindIcon";
import { DriveViewer } from "@/components/drive/DriveViewer";
import { useDriveUploads, type UploadItem } from "@/components/drive/useDriveUploads";
import { cn } from "@/lib/utils/cn";

// ---------------------------------------------------------------------------
// listings, cached across the whole visit
// ---------------------------------------------------------------------------

/**
 * Folders already seen are shown at once and refreshed behind the scenes, and
 * a folder is fetched while the pointer is still on its way to it. Together
 * that is most of what makes moving around feel instant. A listing carries
 * signed file URLs that last about an hour, so one older than twenty minutes
 * is never shown, only replaced.
 */
const CACHE = new Map<string, { data: DriveListing; at: number }>();
const INFLIGHT = new Map<string, Promise<DriveListing>>();
const FRESH_MS = 15_000;
const MAX_AGE_MS = 20 * 60_000;

class ListError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function cacheKey(linkId: string, pathKey: string) {
  return `${linkId}|${pathKey}`;
}

function fetchListing(linkId: string, pathKey: string): Promise<DriveListing> {
  const key = cacheKey(linkId, pathKey);
  const existing = INFLIGHT.get(key);
  if (existing) return existing;
  const p = fetch(`/api/drive/list?link=${linkId}&p=${encodeURIComponent(pathKey)}`, {
    cache: "no-store",
  })
    .then(async (r) => {
      const json = (await r.json().catch(() => null)) as (DriveListing & { message?: string }) | null;
      if (!r.ok || !json) {
        throw new ListError(json?.message ?? "Couldn't open this folder. Try again.", r.status);
      }
      CACHE.set(key, { data: json, at: Date.now() });
      return json;
    })
    .finally(() => INFLIGHT.delete(key));
  INFLIGHT.set(key, p);
  return p;
}

function usable(linkId: string, pathKey: string) {
  const c = CACHE.get(cacheKey(linkId, pathKey));
  return c && Date.now() - c.at < MAX_AGE_MS ? c : null;
}

const VIEW_KEY = "pulse.drive.view";

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-AU", {
    timeZone: BUSINESS_TZ,
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function meta(e: DriveEntry): string {
  return [e.size ? formatBytes(e.size) : null, shortDate(e.modifiedTime)].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// the browser
// ---------------------------------------------------------------------------

/**
 * A client's shared Google Drive folder, inside the portal.
 *
 * The address carries the folder (?p=), so the back button, a refresh and a
 * copied link all land in the same place. Moving between folders changes the
 * address without reloading the page.
 *
 * Files can be dropped anywhere on the page. They go straight to Google, with
 * progress shown bottom left, and appear in the folder when they land.
 */
export function DriveBrowser({
  linkId,
  title,
  role,
  backHref,
  backLabel,
}: {
  linkId: string;
  title: string;
  role: "client" | "admin";
  backHref: string;
  backLabel: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pathKey = searchParams.get("p") ?? "";
  const path = useMemo(() => decodePath(pathKey) ?? [], [pathKey]);

  const [listing, setListing] = useState<{ key: string; data: DriveListing } | null>(() => {
    const c = usable(linkId, pathKey);
    return c ? { key: pathKey, data: c.data } : null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [viewer, setViewer] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const currentKey = useRef(pathKey);
  currentKey.current = pathKey;
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "list" || v === "grid") setView(v);
    } catch {
      // private window: grid it is
    }
  }, []);

  function chooseView(v: "grid" | "list") {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // not remembered, still switched
    }
  }

  const refresh = useCallback(
    (key: string, quiet: boolean) => {
      if (!quiet) {
        setLoading(true);
        setError(null);
      }
      fetchListing(linkId, key)
        .then((data) => {
          if (currentKey.current === key) {
            setListing({ key, data });
            setError(null);
          }
        })
        .catch((e: Error) => {
          if (currentKey.current === key && !quiet) setError(e.message);
        })
        .finally(() => {
          if (currentKey.current === key) setLoading(false);
        });
    },
    [linkId],
  );

  // Show what is cached straight away; fetch what is missing or stale.
  useEffect(() => {
    setViewer(null);
    const c = usable(linkId, pathKey);
    if (c) {
      setListing({ key: pathKey, data: c.data });
      setError(null);
      setLoading(false);
      if (Date.now() - c.at > FRESH_MS) refresh(pathKey, true);
    } else {
      refresh(pathKey, false);
    }
  }, [linkId, pathKey, refresh]);

  // Coming back to the tab picks up anything added in Drive meanwhile, which
  // is how a file Claude saved shows up without anyone pressing anything.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible") return;
      const c = CACHE.get(cacheKey(linkId, currentKey.current));
      if (!c || Date.now() - c.at > FRESH_MS) refresh(currentKey.current, !!c);
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [linkId, refresh]);

  const go = useCallback(
    (next: string[]) => {
      const p = encodePath(next);
      window.history.pushState(null, "", p ? `${pathname}?p=${p}` : pathname);
      setFilter("");
    },
    [pathname],
  );

  function prefetch(next: string[]) {
    const key = encodePath(next);
    const c = CACHE.get(cacheKey(linkId, key));
    if (!c || Date.now() - c.at > FRESH_MS) void fetchListing(linkId, key).catch(() => {});
  }

  // ---- uploads ----
  const onBatchDone = useCallback(
    (key: string, ids: string[]) => {
      void fetch("/api/drive/uploaded", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link: linkId, p: key, files: ids.map((id) => ({ id })) }),
      }).catch(() => {});
      CACHE.delete(cacheKey(linkId, key));
      if (currentKey.current === key) refresh(key, true);
    },
    [linkId, refresh],
  );
  const uploads = useDriveUploads({ linkId, onBatchDone });
  const enqueue = uploads.enqueue;

  const shown = listing && listing.key === pathKey ? listing.data : null;
  const canUpload = !!shown?.canUpload;
  const folderName = shown?.crumbs.at(-1)?.name ?? shown?.link.title ?? title;

  const takeFiles = useCallback(
    (files: File[], skippedFolders = 0) => {
      if (skippedFolders > 0) {
        setNotice(
          skippedFolders === 1
            ? "Folders can't be dropped in yet. Open the folder on your computer and drop the files inside."
            : `${skippedFolders} folders were skipped. Drop the files inside them instead.`,
        );
      }
      if (files.length) enqueue(files, pathKey);
    },
    [enqueue, pathKey],
  );

  // Drop anywhere on the page. Handled on the window so the browser never
  // opens the file in place of the portal, even where uploads are off. The
  // listeners are attached once and read the latest state through refs: a
  // re-render mid-drag must not reset the enter/leave count, or the overlay
  // flickers off while a file is still over the page.
  const canUploadRef = useRef(canUpload);
  canUploadRef.current = canUpload;
  const takeRef = useRef(takeFiles);
  takeRef.current = takeFiles;
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = canUploadRef.current ? "copy" : "none";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (!canUploadRef.current || !e.dataTransfer) return;
      const files: File[] = [];
      let skipped = 0;
      for (const item of Array.from(e.dataTransfer.items)) {
        if (item.kind !== "file") continue;
        const entry = item.webkitGetAsEntry?.();
        if (entry?.isDirectory) {
          skipped += 1;
          continue;
        }
        const f = item.getAsFile();
        if (f) files.push(f);
      }
      takeRef.current(files, skipped);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const q = filter.trim().toLowerCase();
  const entries = useMemo(
    () => (shown?.entries ?? []).filter((e) => !q || e.name.toLowerCase().includes(q)),
    [shown, q],
  );
  const folders = entries.filter((e) => e.kind === "folder");
  const files = entries.filter((e) => e.kind !== "folder");

  return (
    <div className="pb-16">
      {/* ---- where you are ---- */}
      <nav aria-label="Folder path" className="mb-4 flex flex-wrap items-center gap-1 text-sm">
        <Link href={backHref} className="rounded px-1.5 py-0.5 text-pulse-text-mute hover:text-pulse-text">
          {backLabel}
        </Link>
        <ChevronRight size={14} className="text-pulse-text-mute" aria-hidden="true" />
        <button
          type="button"
          onClick={() => go([])}
          onPointerEnter={() => path.length && prefetch([])}
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:text-pulse-text",
            path.length === 0 ? "text-pulse-text" : "text-pulse-text-mute",
          )}
        >
          <FolderOpen size={14} className="text-pulse-gold" aria-hidden="true" />
          {shown?.link.title ?? title}
        </button>
        {(shown?.crumbs ?? []).map((c, i, all) => (
          <span key={c.id} className="inline-flex items-center gap-1">
            <ChevronRight size={14} className="text-pulse-text-mute" aria-hidden="true" />
            <button
              type="button"
              onClick={() => go(path.slice(0, i + 1))}
              onPointerEnter={() => prefetch(path.slice(0, i + 1))}
              className={cn(
                "max-w-[12rem] truncate rounded px-1.5 py-0.5 hover:text-pulse-text",
                i === all.length - 1 ? "text-pulse-text" : "text-pulse-text-mute",
              )}
            >
              {c.name}
            </button>
          </span>
        ))}
      </nav>

      {/* ---- tools ---- */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-48">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pulse-text-mute" aria-hidden="true" />
          <span className="sr-only">Filter this folder</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Search ${folderName}`}
            className="h-10 w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface pl-9 pr-3 text-base text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none sm:text-sm"
          />
        </label>
        <div className="flex h-10 overflow-hidden rounded-[var(--radius-input)] border border-pulse-border" role="group" aria-label="Layout">
          {(["grid", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => chooseView(v)}
              aria-pressed={view === v}
              aria-label={v === "grid" ? "Show as tiles" : "Show as a list"}
              className={cn(
                "flex w-10 items-center justify-center transition-colors",
                view === v ? "bg-pulse-surface-2 text-pulse-text" : "text-pulse-text-mute hover:text-pulse-text",
              )}
            >
              {v === "grid" ? <LayoutGrid size={17} /> : <List size={17} />}
            </button>
          ))}
        </div>
        {shown?.driveUrl && (
          <a
            href={shown.driveUrl}
            target="_blank"
            rel="noreferrer"
            className="flex h-10 items-center gap-1.5 rounded-[var(--radius-input)] border border-pulse-border px-3 text-sm text-pulse-text-dim hover:border-pulse-border-strong hover:text-pulse-text"
          >
            <ExternalLink size={15} /> Drive
          </a>
        )}
        {canUpload && (
          <>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex h-10 items-center gap-2 rounded-[var(--radius-input)] bg-pulse-gold px-4 text-sm font-medium text-pulse-bg transition-colors hover:bg-pulse-gold-light"
            >
              <CloudUpload size={17} /> Upload
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                takeFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>

      {notice && (
        <p className="mb-4 flex items-start gap-2 rounded-[var(--radius-input)] border border-pulse-warn/40 bg-pulse-warn/10 px-3 py-2 text-xs text-pulse-text">
          <CircleAlert size={14} className="mt-px shrink-0 text-pulse-warn" aria-hidden="true" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-pulse-text-mute hover:text-pulse-text">
            <X size={14} />
          </button>
        </p>
      )}

      {/* ---- the folder ---- */}
      {loading && shown === null && !error ? (
        <>
          <div className="pulse-progress no-print" aria-hidden="true" />
          <Skeleton view={view} />
        </>
      ) : error && !shown ? (
        <div className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-8 text-center">
          <CircleAlert size={22} className="mx-auto text-pulse-text-mute" aria-hidden="true" />
          <p className="mt-3 text-sm text-pulse-text">{error}</p>
          <button
            type="button"
            onClick={() => refresh(pathKey, false)}
            className="mt-4 inline-flex h-9 items-center rounded-[var(--radius-input)] border border-pulse-border px-4 text-sm text-pulse-text hover:border-pulse-border-strong"
          >
            Try again
          </button>
        </div>
      ) : shown && entries.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-pulse-border p-10 text-center">
          <FolderOpen size={26} className="mx-auto text-pulse-text-mute" aria-hidden="true" />
          <p className="mt-3 text-sm text-pulse-text">
            {q ? `Nothing here matches "${filter.trim()}".` : "This folder is empty."}
          </p>
          {!q && canUpload && (
            <p className="mt-1 text-xs text-pulse-text-dim">
              {role === "client"
                ? "Drop files anywhere on this page, or press Upload, to send them to Kyle."
                : "Add files in Drive, or drop them here."}
            </p>
          )}
        </div>
      ) : shown ? (
        <div className={cn("transition-opacity duration-150", loading && "opacity-60")}>
          {folders.length > 0 && (
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => go([...path, f.id])}
                  onPointerEnter={() => prefetch([...path, f.id])}
                  onFocus={() => prefetch([...path, f.id])}
                  className="flex min-w-0 items-center gap-2.5 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-3 text-left transition-colors hover:border-pulse-border-strong"
                >
                  <Folder size={19} className="shrink-0 text-pulse-gold" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm text-pulse-text">{f.name}</span>
                </button>
              ))}
            </div>
          )}

          {files.length > 0 &&
            (view === "grid" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {files.map((f, i) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setViewer(i)}
                    className="group flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface text-left transition-colors hover:border-pulse-border-strong"
                  >
                    <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-pulse-surface-2">
                      <Thumb entry={f} iconSize={34} />
                      {f.kind === "video" && (
                        <span className="absolute flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white">
                          <Play size={18} fill="currentColor" aria-hidden="true" />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 p-2.5">
                      <p className="line-clamp-2 break-words text-[13px] leading-snug text-pulse-text">{f.name}</p>
                      <p className="data-mono mt-1 truncate text-[11px] text-pulse-text-mute">{meta(f)}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
                {files.map((f, i) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-3 border-b border-pulse-border px-3 py-2 last:border-b-0 hover:bg-pulse-surface-2/60"
                  >
                    <button
                      type="button"
                      onClick={() => setViewer(i)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-pulse-surface-2">
                        <Thumb entry={f} iconSize={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-pulse-text">{f.name}</span>
                        <span className="data-mono block truncate text-[11px] text-pulse-text-mute">{meta(f)}</span>
                      </span>
                    </button>
                    {f.download && (
                      <a
                        href={f.download}
                        aria-label={`Download ${f.name}`}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
                      >
                        <Download size={16} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ))}
        </div>
      ) : null}

      {/* ---- drop anywhere ---- */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[55] flex items-center justify-center bg-pulse-bg/80 p-6 backdrop-blur-sm">
          <div
            className={cn(
              "flex w-full max-w-md flex-col items-center rounded-2xl border-2 border-dashed px-6 py-12 text-center",
              canUpload ? "border-pulse-gold bg-pulse-gold/10" : "border-pulse-border bg-pulse-surface",
            )}
          >
            <CloudUpload size={36} className={canUpload ? "text-pulse-gold" : "text-pulse-text-mute"} aria-hidden="true" />
            <p className="mt-3 text-base font-medium text-pulse-text">
              {canUpload ? `Drop to upload to ${folderName}` : "This folder is view only"}
            </p>
            {canUpload && role === "client" && (
              <p className="mt-1 text-sm text-pulse-text-dim">It goes straight to Kyle.</p>
            )}
          </div>
        </div>
      )}

      <UploadTray items={uploads.items} onDismiss={uploads.dismiss} />

      {viewer !== null && files[viewer] && (
        <DriveViewer entries={files} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// pieces
// ---------------------------------------------------------------------------

/**
 * A thumbnail that fades in, and falls back to an icon if Drive has none.
 *
 * A thumbnail the browser already has can finish loading before React is
 * listening, so its load event is never heard and it would stay invisible.
 * The ref checks for that on mount. Nothing resets the state afterwards for
 * the same reason: a reset can land after the load and hide it for good.
 */
function Thumb({ entry, iconSize }: { entry: DriveEntry; iconSize: number }) {
  const [state, setState] = useState<"loading" | "ok" | "none">(entry.thumb ? "loading" : "none");
  const seen = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete) setState(el.naturalWidth > 0 ? "ok" : "none");
  }, []);
  return (
    <>
      {state !== "ok" && <DriveKindIcon kind={entry.kind} size={iconSize} className="text-pulse-text-mute" />}
      {entry.thumb && state !== "none" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={seen}
          src={entry.thumb}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setState("ok")}
          onError={() => setState("none")}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100",
            state === "ok" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </>
  );
}

function Skeleton({ view }: { view: "grid" | "list" }) {
  if (view === "list") {
    return (
      <div className="space-y-2" aria-busy="true">
        <span className="sr-only" role="status">Loading</span>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-14" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-busy="true">
      <span className="sr-only" role="status">Loading</span>
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
          <div className="skeleton aspect-[4/3] rounded-none" />
          <div className="p-2.5">
            <div className="skeleton h-3 w-3/4" />
            <div className="skeleton mt-2 h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Uploads in progress, bottom left, clear of the chat bubble on the right and
 * above the phone tab bar.
 */
function UploadTray({ items, onDismiss }: { items: UploadItem[]; onDismiss: () => void }) {
  if (items.length === 0) return null;
  const active = items.filter((i) => i.state === "queued" || i.state === "uploading").length;
  const failed = items.filter((i) => i.state === "error").length;
  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-4 z-40 w-[min(22rem,calc(100vw-6.5rem))] overflow-hidden rounded-xl border border-pulse-border bg-pulse-surface shadow-[0_12px_40px_rgba(0,0,0,0.35)] lg:bottom-6 lg:left-[calc(16rem+1.5rem)]"
    >
      <div className="flex items-center justify-between border-b border-pulse-border px-3 py-2">
        <p className="text-xs font-medium text-pulse-text">
          {active > 0
            ? `Uploading ${active} file${active === 1 ? "" : "s"}…`
            : failed > 0
              ? `${failed} upload${failed === 1 ? "" : "s"} didn't go through`
              : "All uploaded"}
        </p>
        {active === 0 && (
          <button type="button" onClick={onDismiss} aria-label="Close uploads" className="text-pulse-text-mute hover:text-pulse-text">
            <X size={15} />
          </button>
        )}
      </div>
      <ul className="max-h-52 overflow-y-auto">
        {items.map((i) => (
          <li key={i.key} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-pulse-text">{i.name}</span>
              {i.state === "uploading" || i.state === "queued" ? (
                <LoaderCircle size={13} className="shrink-0 animate-spin text-pulse-text-mute" aria-hidden="true" />
              ) : i.state === "done" ? (
                <span className="text-[11px] text-pulse-success">Done</span>
              ) : (
                <span className="text-[11px] text-pulse-danger">Failed</span>
              )}
            </div>
            {i.state === "error" ? (
              <p className="mt-0.5 text-[11px] text-pulse-danger">{i.error}</p>
            ) : (
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-pulse-surface-2">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-200",
                    i.state === "done" ? "bg-pulse-success" : "bg-pulse-gold",
                  )}
                  style={{ width: `${Math.round(i.progress * 100)}%` }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
