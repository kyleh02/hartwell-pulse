"use client";

import { useState } from "react";
import { FileText, FolderOpen } from "lucide-react";
import type { AssetWithUrl } from "@/lib/assets-shared";
import {
  ASSET_FOLDERS,
  TAG_TONE,
  formatBytes,
  isImageMime,
} from "@/lib/assets-shared";
import { AssetUploader } from "@/components/assets/AssetUploader";
import { AssetDetail } from "@/components/assets/AssetDetail";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils/cn";

function TagBadges({ tags }: { tags: string[] }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {tags.slice(0, 3).map((t) => (
        <Badge key={t} tone={TAG_TONE[t] ?? "neutral"}>
          {t}
        </Badge>
      ))}
    </div>
  );
}

export function AssetsView({
  role,
  currentUserId,
  assets,
  selfClientId,
  clients,
}: {
  role: "client" | "admin";
  currentUserId: string;
  assets: AssetWithUrl[];
  selfClientId?: string;
  clients?: { id: string; business_name: string }[];
}) {
  const [folder, setFolder] = useState<string>("All");
  const [clientId, setClientId] = useState<string>("all");
  const [selected, setSelected] = useState<AssetWithUrl | null>(null);

  const uploadClientId =
    role === "client" ? (selfClientId ?? null) : clientId !== "all" ? clientId : null;
  const uploadFolder = folder === "All" ? "Website Assets" : folder;

  const filtered = assets.filter(
    (a) =>
      (folder === "All" || a.folder === folder) &&
      (role === "client" || clientId === "all" || a.client_id === clientId),
  );
  const images = filtered.filter((a) => isImageMime(a.mime_type));
  const files = filtered.filter((a) => !isImageMime(a.mime_type));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {role === "admin" && clients && (
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-1.5 text-xs text-pulse-text-dim focus:outline-none"
          >
            <option value="all">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.business_name}
              </option>
            ))}
          </select>
        )}
        <div className="flex flex-wrap gap-1">
          {["All", ...ASSET_FOLDERS].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFolder(f)}
              className={cn(
                "rounded-full px-3 py-1 text-xs transition-colors",
                folder === f
                  ? "bg-pulse-surface-2 text-pulse-text"
                  : "text-pulse-text-dim hover:text-pulse-text",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {uploadClientId ? (
        <div className="mb-6">
          <AssetUploader
            clientId={uploadClientId}
            role={role}
            folder={uploadFolder}
          />
        </div>
      ) : (
        role === "admin" && (
          <p className="mb-6 text-xs text-pulse-text-mute">
            Pick a single client above to upload on their behalf.
          </p>
        )
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={20} strokeWidth={1.75} />}
          title="Nothing here yet"
          description={
            role === "client"
              ? "Drop your images and copy in above. Sort them into folders and Kyle can leave notes right on each one."
              : "No assets in this view. Client uploads land here automatically."
          }
        />
      ) : (
        <div className="space-y-8">
          {images.length > 0 && (
            <div>
              <p className="mono-label mb-3">Images</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {images.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelected(a)}
                    className="group text-left"
                  >
                    <div className="aspect-square overflow-hidden rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface-2">
                      {a.url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={a.url}
                          alt={a.name}
                          className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
                        />
                      )}
                    </div>
                    <p className="mt-1.5 truncate text-xs text-pulse-text-dim">
                      {a.name}
                    </p>
                    {role === "admin" && a.client_name && (
                      <p className="data-mono text-[10px] text-pulse-text-mute">
                        {a.client_name}
                      </p>
                    )}
                    <TagBadges tags={a.tags} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {files.length > 0 && (
            <div>
              <p className="mono-label mb-3">Files</p>
              <div className="space-y-2">
                {files.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelected(a)}
                    className="flex w-full items-center gap-3 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface p-3 text-left transition-colors hover:border-pulse-border-strong"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-input)] bg-pulse-surface-2 text-pulse-text-mute">
                      <FileText size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-pulse-text">{a.name}</p>
                      <p className="data-mono truncate text-xs text-pulse-text-mute">
                        {a.folder ?? "Unfiled"} · {formatBytes(a.size_bytes)}
                        {role === "admin" && a.client_name
                          ? ` · ${a.client_name}`
                          : ""}
                      </p>
                    </div>
                    <TagBadges tags={a.tags} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selected && (
        <AssetDetail
          asset={selected}
          role={role}
          currentUserId={currentUserId}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
