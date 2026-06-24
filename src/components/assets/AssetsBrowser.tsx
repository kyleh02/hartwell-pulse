"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Folder,
  FolderPlus,
  FileText,
  ChevronRight,
  MoreVertical,
  Home,
} from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";
import type { AssetFolder } from "@/lib/types/database";
import type { FolderView } from "@/lib/folders";
import type { AssetWithUrl } from "@/lib/assets-shared";
import { TAG_TONE, formatBytes, isImageMime } from "@/lib/assets-shared";
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

function buildHref(base: string, clientParam: string | null, folderId: string | null) {
  const params = new URLSearchParams();
  if (clientParam) params.set("client", clientParam);
  if (folderId) params.set("folder", folderId);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Ids of every descendant of a folder, so a folder can't be moved into itself. */
function descendantsOf(all: AssetFolder[], folderId: string): Set<string> {
  const children = new Map<string | null, AssetFolder[]>();
  for (const f of all) {
    const arr = children.get(f.parent_id) ?? [];
    arr.push(f);
    children.set(f.parent_id, arr);
  }
  const out = new Set<string>();
  const stack = [folderId];
  while (stack.length) {
    const id = stack.pop() as string;
    for (const c of children.get(id) ?? []) {
      out.add(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

export function AssetsBrowser({
  role,
  currentUserId,
  clientId,
  view,
  assets,
  currentClientName,
}: {
  role: "client" | "admin";
  currentUserId: string;
  clientId: string;
  view: FolderView;
  assets: AssetWithUrl[];
  currentClientName?: string;
}) {
  const supabase = useSupabaseClient();
  const router = useRouter();
  const [selected, setSelected] = useState<AssetWithUrl | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [moving, setMoving] = useState<AssetFolder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = role === "admin" ? "/admin/assets" : "/assets";
  const clientParam = role === "admin" ? clientId : null;
  const currentFolderId = view.current?.id ?? null;
  const homeLabel = role === "admin" ? (currentClientName ?? "Files") : "Home";

  const images = assets.filter((a) => isImageMime(a.mime_type));
  const files = assets.filter((a) => !isImageMime(a.mime_type));

  function describeError(e: { code?: string; message: string }) {
    if (e.code === "23505") return "A folder with that name already exists here.";
    if (e.message.toLowerCase().includes("descendant"))
      return "You can't move a folder inside itself.";
    return e.message;
  }

  async function createFolder() {
    const name = window.prompt("New folder name")?.trim();
    if (!name) return;
    setError(null);
    const { error: e } = await supabase.from("asset_folders").insert({
      client_id: clientId,
      parent_id: currentFolderId,
      name,
      created_by: currentUserId,
    });
    if (e) return setError(describeError(e));
    router.refresh();
  }

  async function renameFolder(f: AssetFolder) {
    setMenuFor(null);
    const name = window.prompt("Rename folder", f.name)?.trim();
    if (!name || name === f.name) return;
    setError(null);
    const { error: e } = await supabase
      .from("asset_folders")
      .update({ name })
      .eq("id", f.id);
    if (e) return setError(describeError(e));
    router.refresh();
  }

  async function deleteFolder(f: AssetFolder) {
    setMenuFor(null);
    if (
      !window.confirm(
        `Delete "${f.name}"? Any files inside move up to the top level — nothing is deleted.`,
      )
    )
      return;
    setError(null);
    const { error: e } = await supabase.from("asset_folders").delete().eq("id", f.id);
    if (e) return setError(describeError(e));
    if (currentFolderId === f.id) {
      router.push(buildHref(base, clientParam, f.parent_id));
    } else {
      router.refresh();
    }
  }

  async function submitMove(targetId: string | null) {
    if (!moving) return;
    const f = moving;
    setMoving(null);
    setError(null);
    const { error: e } = await supabase
      .from("asset_folders")
      .update({ parent_id: targetId })
      .eq("id", f.id);
    if (e) return setError(describeError(e));
    router.refresh();
  }

  const blockedTargets = moving
    ? descendantsOf(view.allFolders, moving.id)
    : new Set<string>();

  return (
    <div onClick={() => menuFor && setMenuFor(null)}>
      {/* Breadcrumbs */}
      <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm">
        {role === "admin" && (
          <>
            <Link
              href="/admin/assets"
              className="text-pulse-text-mute hover:text-pulse-text"
            >
              All clients
            </Link>
            <ChevronRight size={14} className="text-pulse-text-mute" />
          </>
        )}
        <Link
          href={buildHref(base, clientParam, null)}
          className={cn(
            "inline-flex items-center gap-1 rounded-[var(--radius-input)] px-1.5 py-0.5 hover:text-pulse-text",
            currentFolderId === null
              ? "text-pulse-text"
              : "text-pulse-text-mute",
          )}
        >
          <Home size={14} /> {homeLabel}
        </Link>
        {view.breadcrumb.map((f, i) => {
          const last = i === view.breadcrumb.length - 1;
          return (
            <span key={f.id} className="inline-flex items-center gap-1">
              <ChevronRight size={14} className="text-pulse-text-mute" />
              <Link
                href={buildHref(base, clientParam, f.id)}
                className={cn(
                  "rounded-[var(--radius-input)] px-1.5 py-0.5 hover:text-pulse-text",
                  last ? "text-pulse-text" : "text-pulse-text-mute",
                )}
              >
                {f.name}
              </Link>
            </span>
          );
        })}
        <button
          type="button"
          onClick={createFolder}
          className="ml-2 inline-flex items-center gap-1 rounded-[var(--radius-input)] border border-pulse-border px-2 py-1 text-xs text-pulse-text-dim hover:border-pulse-border-strong hover:text-pulse-text"
        >
          <FolderPlus size={13} /> New folder
        </button>
      </nav>

      {error && (
        <p className="mb-3 rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
          {error}
        </p>
      )}

      <div className="mb-6">
        <AssetUploader
          clientId={clientId}
          role={role}
          folderId={currentFolderId}
          folderName={view.current?.name ?? "the top level"}
        />
      </div>

      {/* Sub-folders */}
      {view.folders.length > 0 && (
        <div className="mb-8">
          <p className="mono-label mb-3">Folders</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {view.folders.map((f) => (
              <div key={f.id} className="relative">
                <Link
                  href={buildHref(base, clientParam, f.id)}
                  className="flex items-center gap-2.5 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-3 transition-colors hover:border-pulse-border-strong"
                >
                  <Folder size={18} className="shrink-0 text-pulse-gold" />
                  <span className="truncate text-sm text-pulse-text">{f.name}</span>
                </Link>
                <button
                  type="button"
                  aria-label="Folder actions"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuFor(menuFor === f.id ? null : f.id);
                  }}
                  className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
                >
                  <MoreVertical size={15} />
                </button>
                {menuFor === f.id && (
                  <div
                    className="absolute right-1 top-9 z-10 w-32 overflow-hidden rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 py-1 shadow-lg"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => renameFolder(f)}
                      className="block w-full px-3 py-1.5 text-left text-xs text-pulse-text-dim hover:bg-pulse-surface hover:text-pulse-text"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuFor(null);
                        setMoving(f);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-xs text-pulse-text-dim hover:bg-pulse-surface hover:text-pulse-text"
                    >
                      Move
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteFolder(f)}
                      className="block w-full px-3 py-1.5 text-left text-xs text-pulse-danger hover:bg-pulse-surface"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Files in this folder */}
      {assets.length === 0 && view.folders.length === 0 ? (
        <EmptyState
          icon={<Folder size={20} strokeWidth={1.75} />}
          title="This folder is empty"
          description={
            role === "client"
              ? "Drop files above, or make a new folder to organise them. Kyle can leave notes right on anything you upload."
              : "Nothing here yet. Upload on the client's behalf, or make a folder to organise their files."
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
                          loading="lazy"
                          className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
                        />
                      )}
                    </div>
                    <p className="mt-1.5 truncate text-xs text-pulse-text-dim">
                      {a.name}
                    </p>
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
                        {formatBytes(a.size_bytes)}
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

      {/* Move-folder modal */}
      {moving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            aria-label="Cancel"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMoving(null)}
          />
          <div className="relative w-full max-w-sm rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-5">
            <p className="text-sm font-medium text-pulse-text">
              Move “{moving.name}”
            </p>
            <p className="mt-1 text-xs text-pulse-text-mute">
              Choose where this folder should live.
            </p>
            <div className="mt-4 max-h-64 space-y-1 overflow-y-auto">
              <button
                type="button"
                onClick={() => submitMove(null)}
                disabled={moving.parent_id === null}
                className="flex w-full items-center gap-2 rounded-[var(--radius-input)] px-3 py-2 text-left text-sm text-pulse-text-dim hover:bg-pulse-surface-2 disabled:opacity-40"
              >
                <Home size={14} /> Top level
              </button>
              {view.allFolders
                .filter((t) => t.id !== moving.id && !blockedTargets.has(t.id))
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => submitMove(t.id)}
                    disabled={t.id === moving.parent_id}
                    className="flex w-full items-center gap-2 rounded-[var(--radius-input)] px-3 py-2 text-left text-sm text-pulse-text-dim hover:bg-pulse-surface-2 disabled:opacity-40"
                  >
                    <Folder size={14} className="text-pulse-gold" /> {t.name}
                  </button>
                ))}
            </div>
            <button
              type="button"
              onClick={() => setMoving(null)}
              className="mt-4 text-xs text-pulse-text-mute hover:text-pulse-text"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {selected && (
        <AssetDetail
          asset={selected}
          role={role}
          currentUserId={currentUserId}
          folders={view.allFolders}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
