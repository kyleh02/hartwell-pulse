"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, Paperclip, RefreshCw, X } from "lucide-react";
import { uploadReportPdf, removeReportPdf } from "@/app/admin/reports/actions";
import { uploadInvoicePdf, removeInvoicePdf } from "@/app/admin/invoices/actions";
import { Button, buttonClasses } from "@/components/ui/Button";
import { requestDocumentPdf } from "@/lib/pdf-client";

/**
 * The PDF that goes out with the send email, for a report or an invoice.
 *
 * A client told their document is ready and handed a portal link has a sign-in
 * between them and the thing they were sent. On an invoice that is worse than
 * on a report: it goes to whoever pays the bills, which is often not the person
 * with the login, and a bookkeeper cannot pay what they cannot open.
 *
 * Made by the portal from the document itself. What stayed manual is the
 * LOOKING: the file is attached here and nothing sends it, so it can be opened
 * and read before Send is pressed. Uploading still works and is not a fallback
 * nobody thought about; if a render fails or comes out wrong, drop a file in by
 * hand and the send behaves identically.
 *
 * One component for both kinds. Two would drift, and the first sign of that
 * would be one document type quietly losing a safeguard the other kept.
 */
export function DocumentPdf({
  kind,
  id,
  pdfName,
  pdfUploadedAt,
  updatedAt,
  printUrl = null,
}: {
  kind: "report" | "invoice";
  id: string;
  pdfName: string | null;
  pdfUploadedAt: string | null;
  /** The document's own updated_at, for the staleness check. */
  updatedAt: string;
  /**
   * The page the renderer photographs, signed and openable.
   *
   * When a PDF comes out wrong, the first question is whether the page was
   * wrong or the rendering was, and there was no way to tell them apart.
   */
  printUrl?: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const noun = kind === "invoice" ? "invoice" : "report";

  /**
   * A PDF older than the last edit says what the document used to say, over the
   * letterhead of the one it says now. Nothing can detect that from the file
   * itself, so the two timestamps are simply shown to disagree.
   */
  const stale =
    Boolean(pdfUploadedAt) &&
    new Date(pdfUploadedAt!).getTime() < new Date(updatedAt).getTime();

  function generate() {
    setError(null);
    setNote("Rendering. A cold start takes a few seconds.");
    startTransition(async () => {
      const res = await requestDocumentPdf(kind, id);
      if (!res.ok) {
        setNote(null);
        setError(res.message);
        return;
      }
      setNote(`Made ${res.name}. Open it and read it before you send.`);
      router.refresh();
    });
  }

  function upload(file: File) {
    setError(null);
    const fd = new FormData();
    fd.append(kind === "invoice" ? "invoiceId" : "reportId", id);
    fd.append("file", file);
    startTransition(async () => {
      const res =
        kind === "invoice" ? await uploadInvoicePdf(fd) : await uploadReportPdf(fd);
      if (!res.ok) setError(res.message);
      else router.refresh();
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res =
        kind === "invoice" ? await removeInvoicePdf(id) : await removeReportPdf(id);
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
              {kind === "invoice"
                ? "Nothing attached yet. Sending will make one automatically, or press Make the PDF now to check it first."
                : "Nothing attached, so the email will link to the portal only. Publishing makes one automatically, or press Make the PDF now."}
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
            onClick={generate}
            className={buttonClasses("secondary", "sm")}
          >
            <RefreshCw size={14} />
            {pending ? "Working…" : pdfName ? "Make it again" : "Make the PDF"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => fileRef.current?.click()}
            className={buttonClasses("ghost", "sm")}
            title="Upload one yourself instead"
          >
            <Paperclip size={14} />
            Upload
          </button>
          {printUrl && (
            <a
              href={printUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonClasses("ghost", "sm")}
              title="Open the page the renderer photographs"
            >
              <ExternalLink size={14} />
              Print page
            </a>
          )}
          {pdfName && (
            <Button variant="ghost" size="sm" onClick={remove} disabled={pending}>
              <X size={14} /> Remove
            </Button>
          )}
        </div>
      </div>

      {stale && (
        <p className="mt-3 rounded-[var(--radius-input)] border border-pulse-warn/40 bg-pulse-warn/10 px-3 py-2 text-xs text-pulse-warn">
          {kind === "invoice"
            ? "This PDF was made before the last edit, so it may show a superseded amount or due date under the same invoice number. Press Make it again before sending."
            : `This PDF was made before the last edit to the ${noun}, so it is out of date. Press Make it again before sending, or the email carries one version and the portal shows another.`}
        </p>
      )}

      {note && <p className="mt-3 text-xs text-pulse-text-dim">{note}</p>}

      {error && (
        <p className="mt-3 rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
          {error}
        </p>
      )}
    </div>
  );
}
