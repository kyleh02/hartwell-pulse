"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Paperclip, X } from "lucide-react";
import { uploadReportPdf, removeReportPdf } from "@/app/admin/reports/actions";
import { Button, buttonClasses } from "@/components/ui/Button";

/**
 * The PDF that goes out with the send email.
 *
 * A client is told their report is ready and handed a link into a portal they
 * have to sign in to. For the person who wants to read it on a phone between
 * meetings, or forward it to a business partner who has no login at all, that
 * is a wall in front of the thing they were promised. The PDF removes it.
 *
 * Uploaded rather than generated, and the upload is the point: Kyle prints the
 * viewer, reads what the client will read, and attaches that. A renderer on
 * the server would produce a document nobody had looked at.
 */
export function ReportPdf({
  reportId,
  pdfName,
  pdfUploadedAt,
  reportUpdatedAt,
}: {
  reportId: string;
  pdfName: string | null;
  pdfUploadedAt: string | null;
  reportUpdatedAt: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * A PDF older than the last edit says what the report used to say, over the
   * letterhead of the one it says now. Nothing can detect that from the file
   * itself, so the two timestamps are simply shown to disagree.
   */
  const stale =
    Boolean(pdfUploadedAt) &&
    new Date(pdfUploadedAt!).getTime() < new Date(reportUpdatedAt).getTime();

  function upload(file: File) {
    setError(null);
    const fd = new FormData();
    fd.append("reportId", reportId);
    fd.append("file", file);
    startTransition(async () => {
      const res = await uploadReportPdf(fd);
      if (!res.ok) setError(res.message);
      else router.refresh();
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await removeReportPdf(reportId);
      if (!res.ok) setError(res.message);
      else router.refresh();
    });
  }

  return (
    <div className="mb-4 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mono-label">PDF for the email</p>
          {pdfName ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-pulse-text">
              <FileText size={14} className="shrink-0 text-pulse-gold" />
              <span className="truncate">{pdfName}</span>
            </p>
          ) : (
            <p className="mt-1.5 max-w-md text-xs text-pulse-text-dim">
              Nothing attached. The email will link to the portal only, so she
              has to sign in to read it. Print the report from the viewer and
              attach it here to send it with the email.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
            }}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => fileRef.current?.click()}
            className={buttonClasses("secondary", "sm")}
          >
            <Paperclip size={14} />
            {pending ? "Working…" : pdfName ? "Replace" : "Attach PDF"}
          </button>
          {pdfName && (
            <Button variant="ghost" size="sm" onClick={remove} disabled={pending}>
              <X size={14} /> Remove
            </Button>
          )}
        </div>
      </div>

      {stale && (
        <p className="mt-3 rounded-[var(--radius-input)] border border-pulse-warn/40 bg-pulse-warn/10 px-3 py-2 text-xs text-pulse-warn">
          This PDF was attached before the last edit to the report, so it is out
          of date. Print it again and replace it before sending, or the email
          carries one version and the portal shows another.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
          {error}
        </p>
      )}
    </div>
  );
}
