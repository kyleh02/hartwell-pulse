"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { UploadCloud } from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";
import { kindFromMime, folderSlug } from "@/lib/assets-shared";
import { cn } from "@/lib/utils/cn";

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function AssetUploader({
  clientId,
  role,
  folder,
}: {
  clientId: string;
  role: "client" | "admin";
  folder: string;
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
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${clientId}/${folderSlug(folder)}/${newId()}-${safe}`;
        const up = await supabase.storage
          .from("pulse-assets")
          .upload(path, file, {
            contentType: file.type || "application/octet-stream",
          });
        if (up.error) throw new Error(up.error.message);

        const ins = await supabase.from("assets").insert({
          client_id: clientId,
          uploaded_by: userId,
          uploader_role: role,
          name: file.name,
          storage_path: path,
          mime_type: file.type || null,
          size_bytes: file.size,
          kind: kindFromMime(file.type),
          folder,
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
        Into {folder} · images, documents and copy
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
