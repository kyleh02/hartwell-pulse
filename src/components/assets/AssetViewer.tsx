"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  Download,
  Trash2,
  FileText,
  ChevronLeft,
  ChevronRight,
  Lock,
  Unlock,
  Share2,
  Loader2,
} from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";
import type { AssetWithUrl } from "@/lib/assets-shared";
import type { AssetFolder } from "@/lib/types/database";
import {
  ASSET_TAGS,
  TAG_TONE,
  formatBytes,
  isImageMime,
} from "@/lib/assets-shared";
import { AssetComments } from "@/components/assets/AssetComments";
import { createShare } from "@/lib/actions/shares";
import { cn } from "@/lib/utils/cn";

const TONE_ACTIVE: Record<string, string> = {
  neutral: "border-pulse-border-strong text-pulse-text bg-pulse-surface-2",
  gold: "border-pulse-gold/40 text-pulse-gold bg-pulse-gold/10",
  success: "border-pulse-success/40 text-pulse-success bg-pulse-success/10",
  warn: "border-pulse-warn/40 text-pulse-warn bg-pulse-warn/10",
  danger: "border-pulse-danger/40 text-pulse-danger bg-pulse-danger/10",
};

const isPdf = (m: string | null) => m === "application/pdf";
const isVideo = (m: string | null) => !!m && m.startsWith("video/");

export function AssetViewer({
  assets,
  index,
  onIndexChange,
  role,
  currentUserId,
  folders,
  onClose,
}: {
  assets: AssetWithUrl[];
  index: number;
  onIndexChange: (i: number) => void;
  role: "client" | "admin";
  currentUserId: string;
  folders: AssetFolder[];
  onClose: () => void;
}) {
  const supabase = useSupabaseClient();
  const router = useRouter();
  const asset = assets[index];
  const [tags, setTags] = useState<string[]>(asset?.tags ?? []);
  const [zoom, setZoom] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(true);

  useEffect(() => {
    setTags(asset?.tags ?? []);
    setZoom(false);
    setShareUrl(null);
    setShareBusy(false);
    setMediaLoading(true);
  }, [asset?.id, asset?.tags]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      else if (e.key === "ArrowRight" && index < assets.length - 1)
        onIndexChange(index + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, assets.length, onClose, onIndexChange]);

  if (!asset) return null;
  const canEdit =
    role === "admin" || (asset.uploaded_by === currentUserId && !asset.locked);
  const hasPreview =
    !!asset.url &&
    (isImageMime(asset.mime_type) ||
      isPdf(asset.mime_type) ||
      isVideo(asset.mime_type));

  async function toggleTag(tag: string) {
    if (!canEdit) return;
    const next = tags.includes(tag)
      ? tags.filter((t) => t !== tag)
      : [...tags, tag];
    setTags(next);
    await supabase.from("assets").update({ tags: next }).eq("id", asset.id);
  }

  async function moveTo(folderId: string | null) {
    if (!canEdit) return;
    const name = folderId
      ? (folders.find((f) => f.id === folderId)?.name ?? null)
      : null;
    await supabase
      .from("assets")
      .update({ folder_id: folderId, folder: name })
      .eq("id", asset.id);
    router.refresh();
  }

  async function remove() {
    if (!canEdit) return;
    if (!window.confirm(`Delete "${asset.name}"? This can't be undone.`)) return;
    const toRemove = [asset.storage_path];
    if (asset.thumb_path) toRemove.push(asset.thumb_path);
    await supabase.storage.from("pulse-assets").remove(toRemove);
    await supabase.from("assets").delete().eq("id", asset.id);
    onClose();
    router.refresh();
  }

  async function doShare() {
    setShareBusy(true);
    const res = await createShare({ assetId: asset.id, expiresInDays: 7 });
    setShareBusy(false);
    setShareUrl(res.ok ? `${window.location.origin}/share/${res.token}` : null);
  }

  async function toggleLock() {
    await supabase
      .from("assets")
      .update({ locked: !asset.locked })
      .eq("id", asset.id);
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-pulse-bg/95 lg:flex-row">
      {/* Preview */}
      <div className="relative flex min-h-[45vh] flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <p className="truncate text-sm text-pulse-text">{asset.name}</p>
          <span className="data-mono shrink-0 text-xs text-pulse-text-mute">
            {index + 1} / {assets.length}
          </span>
        </div>
        <div className="relative flex flex-1 items-center justify-center overflow-auto p-4">
          {index > 0 && (
            <button
              type="button"
              aria-label="Previous"
              onClick={() => onIndexChange(index - 1)}
              className="absolute left-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-pulse-surface/80 text-pulse-text-dim hover:text-pulse-text"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          {index < assets.length - 1 && (
            <button
              type="button"
              aria-label="Next"
              onClick={() => onIndexChange(index + 1)}
              className="absolute right-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-pulse-surface/80 text-pulse-text-dim hover:text-pulse-text"
            >
              <ChevronRight size={18} />
            </button>
          )}

          {hasPreview && mediaLoading && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <Loader2 size={28} className="animate-spin text-pulse-text-mute" />
            </div>
          )}

          {isImageMime(asset.mime_type) && asset.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.url}
              alt={asset.name}
              onLoad={() => setMediaLoading(false)}
              onError={() => setMediaLoading(false)}
              onClick={() => setZoom((z) => !z)}
              className={cn(
                "rounded-[var(--radius-card)] transition-transform",
                zoom
                  ? "max-w-none cursor-zoom-out"
                  : "max-h-full max-w-full cursor-zoom-in object-contain",
              )}
              style={zoom ? { transform: "scale(2)" } : undefined}
            />
          ) : isPdf(asset.mime_type) && asset.url ? (
            <iframe
              src={asset.url}
              title={asset.name}
              onLoad={() => setMediaLoading(false)}
              className="h-full min-h-[60vh] w-full rounded-[var(--radius-card)] border border-pulse-border bg-white"
            />
          ) : isVideo(asset.mime_type) && asset.url ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={asset.url}
              controls
              onLoadedData={() => setMediaLoading(false)}
              onError={() => setMediaLoading(false)}
              className="max-h-full max-w-full rounded-[var(--radius-card)]"
            />
          ) : (
            <div className="text-center text-pulse-text-mute">
              <FileText size={48} strokeWidth={1.25} className="mx-auto" />
              <p className="mt-3 max-w-xs truncate text-sm text-pulse-text-dim">
                {asset.name}
              </p>
              <p className="mt-1 text-xs">No inline preview for this file type.</p>
              {asset.url && (
                <a
                  href={asset.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-input)] border border-pulse-border px-3 py-1.5 text-xs text-pulse-gold hover:border-pulse-border-strong"
                >
                  <Download size={13} /> Download
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Info panel */}
      <aside className="flex w-full shrink-0 flex-col border-t border-pulse-border bg-pulse-surface lg:w-80 lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between gap-2 border-b border-pulse-border px-4 py-3">
          <p className="truncate text-sm font-medium text-pulse-text">Details</p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <div className="flex items-center gap-2 text-xs text-pulse-text-mute">
            <span className="data-mono">{formatBytes(asset.size_bytes)}</span>
            {asset.locked && (
              <span className="inline-flex items-center gap-1 text-pulse-warn">
                <Lock size={11} /> Locked
              </span>
            )}
            {asset.url && (
              <a
                href={asset.url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-pulse-gold hover:underline"
              >
                <Download size={13} /> Download
              </a>
            )}
          </div>

          {canEdit && (
            <div>
              <p className="mono-label mb-2">Folder</p>
              <select
                value={asset.folder_id ?? ""}
                onChange={(e) => moveTo(e.target.value || null)}
                className="w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text-dim focus:outline-none"
              >
                <option value="">Top level</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <p className="mono-label mb-2">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {ASSET_TAGS.map((tag) => {
                const on = tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    disabled={!canEdit}
                    className={cn(
                      "data-mono rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-wider transition-colors",
                      on
                        ? TONE_ACTIVE[TAG_TONE[tag] ?? "neutral"]
                        : "border-pulse-border text-pulse-text-mute hover:text-pulse-text-dim",
                      !canEdit && "cursor-default opacity-60",
                    )}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 border-t border-pulse-border pt-4">
            <button
              type="button"
              onClick={doShare}
              disabled={shareBusy}
              className="inline-flex items-center gap-1.5 text-xs text-pulse-text-dim hover:text-pulse-text disabled:opacity-60"
            >
              <Share2 size={13} />{" "}
              {shareBusy ? "Creating link…" : "Create share link"}
            </button>
            {shareUrl && (
              <div className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 p-2">
                <p className="text-[11px] text-pulse-text-mute">
                  Private link · sign-in required · expires in 7 days
                </p>
                <div className="mt-1.5 flex items-center gap-1">
                  <input
                    readOnly
                    value={shareUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface px-2 py-1 text-[11px] text-pulse-text-dim focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(shareUrl)}
                    className="shrink-0 rounded-[var(--radius-input)] border border-pulse-border px-2 py-1 text-[11px] text-pulse-gold hover:border-pulse-border-strong"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
            {role === "admin" && (
              <button
                type="button"
                onClick={toggleLock}
                className="flex items-center gap-1.5 text-xs text-pulse-text-dim hover:text-pulse-text"
              >
                {asset.locked ? (
                  <>
                    <Unlock size={13} /> Unlock for client
                  </>
                ) : (
                  <>
                    <Lock size={13} /> Lock (view-only for client)
                  </>
                )}
              </button>
            )}
          </div>

          <AssetComments
            assetId={asset.id}
            clientId={asset.client_id}
            role={role}
          />
        </div>

        {canEdit && (
          <div className="border-t border-pulse-border p-3">
            <button
              onClick={remove}
              className="inline-flex items-center gap-1.5 text-xs text-pulse-text-mute hover:text-pulse-danger"
            >
              <Trash2 size={13} /> Delete file
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
