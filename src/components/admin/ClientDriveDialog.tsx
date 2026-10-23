"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  HardDrive,
  Mail,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";
import type { DriveStatus } from "@/lib/google-drive";
import { drivePagePath } from "@/lib/drive-shared";
import {
  driveStatus,
  emailDriveLink,
  linkDriveFolder,
  unlinkDriveFolder,
  updateDriveLink,
} from "@/app/admin/clients/drive-actions";
import { Button, buttonClasses } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none";

interface Row {
  id: string;
  folder_id: string;
  drive_name: string | null;
  title: string;
  allow_uploads: boolean;
}

/**
 * The Drive folders a client sees in their portal.
 *
 * Linking checks the folder in Drive straight away, so a wrong link is caught
 * here rather than by the client. Removing a link only stops the sharing;
 * nothing in Drive is touched.
 */
export function ClientDriveDialog({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const supabase = useSupabaseClient();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [form, setForm] = useState({ link: "", title: "" });
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    const [s, { data, error: e }] = await Promise.all([
      driveStatus(),
      supabase
        .from("drive_links")
        .select("id, folder_id, drive_name, title, allow_uploads")
        .eq("client_id", clientId)
        .order("position"),
    ]);
    setStatus(s);
    if (e && (e.code === "PGRST205" || e.code === "42P01")) setRows([]);
    else setRows((data as Row[] | null) ?? []);
  }, [supabase, clientId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, done?: string) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.message ?? "That didn't work.");
      else if (done) setNote(done);
      await load();
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    run(async () => {
      const res = await linkDriveFolder(clientId, form.link, form.title);
      if (res.ok) setForm({ link: "", title: "" });
      return res;
    }, `Shared with ${clientName}. Copy the link or email it to them below.`);
  }

  function rename(r: Row, title: string) {
    if (title.trim() === r.title) return;
    run(() => updateDriveLink(r.id, { title }));
  }

  function toggleUploads(r: Row) {
    run(() => updateDriveLink(r.id, { allow_uploads: !r.allow_uploads }));
  }

  function remove(r: Row) {
    if (
      !window.confirm(
        `Stop sharing "${r.title}" with ${clientName}? It disappears from their portal. Nothing in Drive is changed.`,
      )
    )
      return;
    run(() => unlinkDriveFolder(r.id));
  }

  function email(r: Row) {
    if (!window.confirm(`Email everyone at ${clientName} a link to "${r.title}"?`)) return;
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await emailDriveLink(r.id);
      if (!res.ok) setError(res.message);
      else setNote(`Emailed ${res.sentTo.join(", ")}.`);
    });
  }

  async function copy(r: Row) {
    const url = `${window.location.origin}${drivePagePath(r.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(r.id);
      setTimeout(() => setCopied((c) => (c === r.id ? null : c)), 1800);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  const ready = status?.connected && !status.tablesMissing;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClasses("secondary", "sm")}
      >
        <HardDrive size={14} /> Drive
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            aria-label="Close"
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label={`${clientName} shared folders`}
            className="relative max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface"
          >
            <div className="flex items-center justify-between border-b border-pulse-border px-4 py-3">
              <p className="text-sm font-medium text-pulse-text">
                {clientName} · shared Drive folders
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 p-4">
              {status && !ready && (
                <p className="rounded-[var(--radius-input)] border border-pulse-warn/40 bg-pulse-warn/10 px-3 py-2 text-xs text-pulse-text">
                  {status.tablesMissing
                    ? "Run migration 0053 in Supabase, then connect Google Drive in Settings."
                    : "Connect Google Drive in Settings first."}{" "}
                  <Link href="/admin/settings" className="text-pulse-gold underline-offset-2 hover:underline">
                    Open Settings
                  </Link>
                </p>
              )}

              {rows === null ? (
                <p className="text-xs text-pulse-text-mute">Loading…</p>
              ) : rows.length === 0 ? (
                <p className="text-xs text-pulse-text-mute">
                  Nothing shared yet. Paste the link to their Client Shared (Portal) folder below and it
                  appears in their Assets.
                </p>
              ) : (
                rows.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 p-3"
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <input
                          defaultValue={r.title}
                          aria-label="Name the client sees"
                          onBlur={(e) => rename(r, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          className="w-full rounded-[6px] border border-transparent bg-transparent px-1 py-0.5 text-sm text-pulse-text hover:border-pulse-border focus:border-pulse-border-strong focus:outline-none"
                        />
                        <p className="data-mono truncate px-1 text-[11px] text-pulse-text-mute">
                          In Drive: {r.drive_name ?? r.folder_id}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => remove(r)}
                        disabled={pending}
                        aria-label={`Stop sharing ${r.title}`}
                        title="Stop sharing"
                        className="mt-1 text-pulse-text-mute hover:text-pulse-danger"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => copy(r)}
                        className={buttonClasses("secondary", "sm")}
                      >
                        {copied === r.id ? <Check size={13} /> : <Copy size={13} />}
                        {copied === r.id ? "Copied" : "Copy link"}
                      </button>
                      <button
                        type="button"
                        onClick={() => email(r)}
                        disabled={pending || !ready}
                        className={buttonClasses("secondary", "sm")}
                      >
                        <Mail size={13} /> Email link
                      </button>
                      <Link
                        href={`/admin/assets/drive/${r.id}`}
                        className={buttonClasses("secondary", "sm")}
                      >
                        <Eye size={13} /> View
                      </Link>
                      <a
                        href={`https://drive.google.com/drive/folders/${r.folder_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonClasses("ghost", "sm")}
                      >
                        <ExternalLink size={13} /> Drive
                      </a>
                      <button
                        type="button"
                        onClick={() => toggleUploads(r)}
                        disabled={pending}
                        aria-pressed={r.allow_uploads}
                        title={
                          r.allow_uploads
                            ? "They can drop files in. Click to make it view only."
                            : "View only. Click to let them upload."
                        }
                        className={cn(
                          buttonClasses("ghost", "sm"),
                          r.allow_uploads ? "text-pulse-success" : "text-pulse-text-mute",
                        )}
                      >
                        <Upload size={13} /> {r.allow_uploads ? "Uploads on" : "View only"}
                      </button>
                    </div>
                  </div>
                ))
              )}

              <form onSubmit={add} className="space-y-2 border-t border-pulse-border pt-3">
                <input
                  value={form.link}
                  onChange={(e) => setForm({ ...form, link: e.target.value })}
                  placeholder="Drive folder link, e.g. https://drive.google.com/drive/folders/…"
                  className={`${field} data-mono text-xs`}
                />
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Name the client sees (optional, defaults to Shared files)"
                  className={field}
                />
                {error && (
                  <p className="rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
                    {error}
                  </p>
                )}
                {note && !error && (
                  <p className="rounded-[var(--radius-input)] border border-pulse-success/40 bg-pulse-success/10 px-3 py-2 text-xs text-pulse-text">
                    {note}
                  </p>
                )}
                <Button type="submit" size="sm" disabled={pending || !ready || !form.link.trim()}>
                  <Plus size={14} /> {pending ? "Checking Drive…" : "Share folder"}
                </Button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
