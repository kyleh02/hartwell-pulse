import { notFound } from "next/navigation";
import { Download, FileText } from "lucide-react";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolveShare } from "@/lib/shares";
import { getPulseSession } from "@/lib/auth/session";
import type { Asset } from "@/lib/types/database";
import { formatBytes, isImageMime } from "@/lib/assets-shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shared with you" };

const isPdf = (m: string | null) => m === "application/pdf";
const isVideo = (m: string | null) => !!m && m.startsWith("video/");

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-4xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <p className="data-mono text-xs uppercase tracking-widest text-pulse-text-mute">
          Hartwell Pulse · Shared
        </p>
      </div>
      <h1 className="mb-6 truncate text-lg font-medium text-pulse-text">{title}</h1>
      {children}
    </div>
  );
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Middleware already enforces login; this also rejects unprovisioned users.
  await getPulseSession();

  const share = await resolveShare(token);
  if (!share) notFound();

  const admin = createAdminSupabase();
  // Count the view (best-effort; never blocks rendering).
  await admin
    .from("shares")
    .update({
      use_count: share.use_count + 1,
      last_accessed_at: new Date().toISOString(),
    })
    .eq("id", share.id);

  const rawBase = `/share/${token}/raw`;

  // ---- Single asset ----
  if (share.asset_id) {
    const { data } = await admin
      .from("assets")
      .select("*")
      .eq("id", share.asset_id)
      .eq("client_id", share.client_id)
      .maybeSingle();
    const asset = data as Asset | null;
    if (!asset) notFound();

    return (
      <Shell title={asset.name}>
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
          {isImageMime(asset.mime_type) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={rawBase} alt={asset.name} className="mx-auto max-h-[75vh]" />
          ) : isPdf(asset.mime_type) ? (
            <iframe
              src={rawBase}
              title={asset.name}
              className="h-[80vh] w-full bg-white"
            />
          ) : isVideo(asset.mime_type) ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={rawBase} controls className="mx-auto max-h-[75vh]" />
          ) : (
            <div className="p-10 text-center text-pulse-text-mute">
              <FileText size={40} strokeWidth={1.25} className="mx-auto" />
              <p className="mt-3 text-sm text-pulse-text-dim">
                {formatBytes(asset.size_bytes)}
              </p>
            </div>
          )}
        </div>
        <a
          href={rawBase}
          className="mt-4 inline-flex items-center gap-1.5 rounded-[var(--radius-input)] border border-pulse-border px-3 py-2 text-sm text-pulse-gold hover:border-pulse-border-strong"
        >
          <Download size={14} /> Download
        </a>
      </Shell>
    );
  }

  // ---- Folder ----
  const { data: rows } = await admin
    .from("assets")
    .select("*")
    .eq("folder_id", share.folder_id)
    .eq("client_id", share.client_id)
    .order("created_at", { ascending: false })
    .limit(300);
  const assets = (rows as Asset[] | null) ?? [];
  const { data: folderRow } = await admin
    .from("asset_folders")
    .select("name")
    .eq("id", share.folder_id)
    .maybeSingle();
  const folderName = (folderRow as { name: string } | null)?.name ?? "Shared folder";

  return (
    <Shell title={folderName}>
      {assets.length === 0 ? (
        <p className="text-sm text-pulse-text-mute">This folder is empty.</p>
      ) : (
        <div className="space-y-2">
          {assets.map((a) => (
            <a
              key={a.id}
              href={`${rawBase}?asset=${a.id}`}
              className="flex items-center gap-3 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface p-3 transition-colors hover:border-pulse-border-strong"
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
              <Download size={15} className="shrink-0 text-pulse-text-mute" />
            </a>
          ))}
        </div>
      )}
    </Shell>
  );
}
