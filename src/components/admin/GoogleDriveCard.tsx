"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, HardDrive, TriangleAlert } from "lucide-react";
import type { DriveStatus } from "@/lib/google-drive";
import { disconnectDrive } from "@/app/admin/clients/drive-actions";
import { Button, buttonClasses } from "@/components/ui/Button";

/** What happened on the way back from Google, in words. */
const OUTCOME: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Google Drive is connected." },
  declined: { ok: false, text: "Google Drive wasn't connected: the approval was cancelled." },
  expired: { ok: false, text: "That approval took too long or came from another tab. Press Connect again." },
  no_drive_scope: {
    ok: false,
    text: "Google didn't grant Drive access. Press Connect again and tick the box to see and edit your Drive files.",
  },
  no_refresh: { ok: false, text: "Google didn't return a lasting connection. Press Connect again." },
  not_configured: { ok: false, text: "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel first." },
  failed: { ok: false, text: "Google refused the connection. Check the client ID and secret in Vercel." },
  error: { ok: false, text: "Something went wrong saving the connection. Try again." },
};

/**
 * Connect Kyle's Google Drive, once, so client folders can be shown in the
 * portal. Shows exactly what is missing when it is not ready, in the order it
 * has to be done.
 */
export function GoogleDriveCard({
  status,
  outcome,
}: {
  status: DriveStatus;
  outcome: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const note = outcome ? OUTCOME[outcome] : null;

  function disconnect() {
    if (
      !window.confirm(
        "Disconnect Google Drive? Clients will stop seeing their shared folders until you connect it again. Nothing in Drive is changed.",
      )
    )
      return;
    start(async () => {
      const res = await disconnectDrive();
      if (!res.ok) setError(res.message);
      router.refresh();
    });
  }

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-medium text-pulse-text">Google Drive</h2>
      <div className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-pulse-gold/12 text-pulse-gold">
            <HardDrive size={20} strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            {status.connected ? (
              <>
                <p className="flex items-center gap-1.5 text-sm text-pulse-text">
                  <CircleCheck size={15} className="text-pulse-success" aria-hidden="true" />
                  Connected as <span className="font-medium">{status.email ?? "your Google account"}</span>
                </p>
                <p className="mt-0.5 text-xs text-pulse-text-dim">
                  Share a folder with a client from their card on the Clients page (the Drive button).
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-pulse-text">Not connected</p>
                <p className="mt-0.5 text-xs text-pulse-text-dim">
                  Connect once to show client folders from your Drive in their portal. Nothing gets
                  shared in Google.
                </p>
              </>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            {status.connected ? (
              <>
                <a href="/api/google/connect" className={buttonClasses("secondary", "sm")}>
                  Reconnect
                </a>
                <Button variant="danger" size="sm" onClick={disconnect} disabled={pending}>
                  Disconnect
                </Button>
              </>
            ) : status.configured && !status.tablesMissing ? (
              <a href="/api/google/connect" className={buttonClasses("primary", "sm")}>
                Connect Google Drive
              </a>
            ) : null}
          </div>
        </div>

        {(status.tablesMissing || !status.configured) && (
          <ol className="mt-4 list-decimal space-y-1 border-t border-pulse-border pt-3 pl-5 text-xs text-pulse-text-dim">
            {status.tablesMissing && <li>Run migration 0053 in the Supabase SQL Editor.</li>}
            {!status.configured && (
              <li>
                Add <span className="data-mono">GOOGLE_CLIENT_ID</span> and{" "}
                <span className="data-mono">GOOGLE_CLIENT_SECRET</span> in Vercel, then redeploy.
              </li>
            )}
            <li>Come back here and press Connect Google Drive.</li>
          </ol>
        )}

        {(note || error) && (
          <p
            className={
              note?.ok && !error
                ? "mt-3 flex items-center gap-1.5 text-xs text-pulse-success"
                : "mt-3 flex items-center gap-1.5 text-xs text-pulse-danger"
            }
          >
            {note?.ok && !error ? <CircleCheck size={13} /> : <TriangleAlert size={13} />}
            {error ?? note?.text}
          </p>
        )}
      </div>
    </section>
  );
}
