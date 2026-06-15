"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Download, Trash2, FileText } from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";
import type { AssetWithUrl } from "@/lib/assets-shared";
import {
  ASSET_TAGS,
  TAG_TONE,
  formatBytes,
  isImageMime,
} from "@/lib/assets-shared";
import { AssetComments } from "@/components/assets/AssetComments";
import { cn } from "@/lib/utils/cn";

const TONE_ACTIVE: Record<string, string> = {
  neutral: "border-pulse-border-strong text-pulse-text bg-pulse-surface-2",
  gold: "border-pulse-gold/40 text-pulse-gold bg-pulse-gold/10",
  success: "border-pulse-success/40 text-pulse-success bg-pulse-success/10",
  warn: "border-pulse-warn/40 text-pulse-warn bg-pulse-warn/10",
  danger: "border-pulse-danger/40 text-pulse-danger bg-pulse-danger/10",
};

export function AssetDetail({
  asset,
  role,
  currentUserId,
  onClose,
}: {
  asset: AssetWithUrl;
  role: "client" | "admin";
  currentUserId: string;
  onClose: () => void;
}) {
  const supabase = useSupabaseClient();
  const router = useRouter();
  const [tags, setTags] = useState<string[]>(asset.tags ?? []);
  const canEdit = role === "admin" || asset.uploaded_by === currentUserId;

  async function toggleTag(tag: string) {
    if (!canEdit) return;
    const next = tags.includes(tag)
      ? tags.filter((t) => t !== tag)
      : [...tags, tag];
    setTags(next);
    await supabase.from("assets").update({ tags: next }).eq("id", asset.id);
  }

  async function remove() {
    if (!canEdit) return;
    if (!window.confirm(`Delete "${asset.name}"? This can't be undone.`)) return;
    await supabase.storage.from("pulse-assets").remove([asset.storage_path]);
    await supabase.from("assets").delete().eq("id", asset.id);
    onClose();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div className="relative ml-auto flex h-full w-full max-w-md flex-col border-l border-pulse-border bg-pulse-surface">
        <div className="flex items-center justify-between gap-2 border-b border-pulse-border px-4 py-3">
          <p className="truncate text-sm font-medium text-pulse-text">
            {asset.name}
          </p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {isImageMime(asset.mime_type) && asset.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.url}
              alt={asset.name}
              className="w-full rounded-[var(--radius-card)] border border-pulse-border"
            />
          ) : (
            <div className="flex h-32 items-center justify-center rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface-2 text-pulse-text-mute">
              <FileText size={28} strokeWidth={1.5} />
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-pulse-text-mute">
            <span className="data-mono">{asset.folder ?? "Unfiled"}</span>
            <span>·</span>
            <span className="data-mono">{formatBytes(asset.size_bytes)}</span>
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
              <Trash2 size={13} /> Delete asset
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
