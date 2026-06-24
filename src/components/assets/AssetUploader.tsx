"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { UploadCloud } from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";
import { kindFromMime } from "@/lib/assets-shared";
import { cn } from "@/lib/utils/cn";

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Make a small WebP thumbnail in the browser (no paid Supabase transforms, no
 * Vercel optimiser). Returns null on any failure — thumbnails are best-effort.
 */
async function makeThumb(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const max = 480;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/webp", 0.8),
    );
  } catch {
    return null;
  }
}

export function AssetUploader({
  clientId,
  role,
  folderId,
  folderName,
}: {
  clientId: string;
  role: "client" | "admin";
  folderId: string | null;
  folderName: string;
}) {
  const supabase = useSupabaseClient();
  const { userId } = useAuth();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!userId || list.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of list) {
        const id = newId();
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${clientId}/${folderId ?? "root"}/${id}-${safe}`;
        const up = await supabase.storage
          .from("pulse-assets")
          .upload(path, file, {
            contentType: file.type || "application/octet-stream",
          });
        if (up.error) throw new Error(up.error.message);

        // Best-effort thumbnail for images, stored alongside under _thumb/.
        let thumbPath: string | null = null;
        if ((file.type || "").startsWith("image/")) {
          const thumb = await makeThumb(file);
          if (thumb) {
            const tp = `${clientId}/_thumb/${id}.webp`;
            const tup = await supabase.storage
              .from("pulse-assets")
              .upload(tp, thumb, { contentType: "image/webp" });
            if (!tup.error) thumbPath = tp;
          }
        }

        const ins = await supabase.from("assets").insert({
          client_id: clientId,
          uploaded_by: userId,
          uploader_role: role,
          name: file.name,
          storage_path: path,
          thumb_path: thumbPath,
          mime_type: file.type || null,
          size_bytes: file.size,
          kind: kindFromMime(file.type),
          folder_id: folderId,
          folder: folderId ? folderName : null,
          tags: [],
        });
        if (ins.error) throw new Error(ins.error.message);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void uploadFiles(e.dataTransfer.files);
      }}
      className={cn(
        "rounded-[var(--radius-card)] border border-dashed p-6 text-center transition-colors",
        drag
          ? "border-pulse-gold bg-pulse-gold/5"
          : "border-pulse-border bg-pulse-surface/40",
      )}
    >
      <UploadCloud className="mx-auto text-pulse-text-mute" size={22} />
      <p className="mt-2 text-sm text-pulse-text-dim">
        {busy ? "Uploading…" : "Drag files here, or "}
        {!busy && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-pulse-gold hover:underline"
          >
            browse
          </button>
        )}
      </p>
      <p className="mt-1 text-xs text-pulse-text-mute">
        Into {folderName} · images, documents and copy
      </p>
      {error && <p className="mt-2 text-xs text-pulse-danger">{error}</p>}
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void uploadFiles(e.target.files);
        }}
      />
    </div>
  );
}
