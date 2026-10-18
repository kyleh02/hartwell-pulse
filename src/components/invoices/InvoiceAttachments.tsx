"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Paperclip, X } from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";
import {
  addInvoiceAttachment,
  removeInvoiceAttachment,
} from "@/app/admin/invoices/actions";
import {
  ACCEPT_ATTRIBUTE,
  MAX_ATTACHMENTS,
  MAX_TOTAL_ATTACHMENT_BYTES,
  attachmentPath,
  checkNewAttachment,
  megabytes,
} from "@/lib/invoice-attachments";
import type { InvoiceAttachment, InvoiceStatus } from "@/lib/types/database";
import { Button } from "@/components/ui/Button";

function newId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

/**
 * Documents sent alongside an invoice's own PDF.
 *
 * One component for the admin, who attaches and removes, and the client, who
 * downloads. Two would drift, and the first sign would be a document Kyle can
 * see and the client cannot.
 */
export function InvoiceAttachments(
  props:
    | { mode: "client"; attachments: InvoiceAttachment[] }
    | {
        mode: "admin";
        attachments: InvoiceAttachment[];
        invoiceId: string;
        clientId: string;
        status: InvoiceStatus;
        recurring: boolean;
      },
) {
  const { attachments } = props;
  const supabase = useSupabaseClient();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const admin = props.mode === "admin";
  const editable =
    admin && (props.status === "draft" || props.status === "sent");

  // A real download with the original name, through a link that lives for a
  // minute, minted under the viewer's own permissions. The same pattern chat
  // uses, so a client can only ever fetch a file in their own folder.
  async function download(a: InvoiceAttachment) {
    const { data, error } = await supabase.storage
      .from("pulse-reports")
      .createSignedUrl(a.storage_path, 60, { download: a.file_name });
    if (error || !data?.signedUrl) {
      setErrors([`Could not open "${a.file_name}": ${error?.message ?? "no link returned"}`]);
      return;
    }
    const link = document.createElement("a");
    link.href = data.signedUrl;
    link.download = a.file_name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function attach(files: FileList | null) {
    if (props.mode !== "admin" || !files || files.length === 0) return;
    const problems: string[] = [];
    // A running tally, so a batch picked together is held to the same limits
    // as files added one at a time.
    const tally = attachments.map((a) => ({ size_bytes: Number(a.size_bytes) }));

    // One at a time, on purpose. Uploading in parallel would let two files both
    // pass the limit check before either was counted.
    for (const file of Array.from(files)) {
      const problem = checkNewAttachment({ name: file.name, size: file.size }, tally);
      if (problem) {
        problems.push(problem);
        continue;
      }
      setBusy(`Uploading ${file.name}...`);
      const path = attachmentPath(props.clientId, props.invoiceId, newId(), file.name);
      const up = await supabase.storage.from("pulse-reports").upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (up.error) {
        problems.push(`"${file.name}" did not upload: ${up.error.message}`);
        continue;
      }
      const res = await addInvoiceAttachment(props.invoiceId, {
        path,
        name: file.name,
      });
      if (!res.ok) {
        problems.push(res.message);
        continue;
      }
      tally.push({ size_bytes: file.size });
    }

    setBusy(null);
    setErrors(problems);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  async function remove(a: InvoiceAttachment) {
    setBusy(`Removing ${a.file_name}...`);
    const res = await removeInvoiceAttachment(a.id);
    setBusy(null);
    setErrors(res.ok ? [] : [res.message]);
    router.refresh();
  }

  // Nothing to show a client, and nothing worth a panel on a closed invoice that
  // never had any.
  if (!admin && attachments.length === 0) return null;
  if (admin && !editable && attachments.length === 0) return null;

  const total = attachments.reduce((s, a) => s + Number(a.size_bytes), 0);

  return (
    <div className="no-print mb-5 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="mono-label flex items-center gap-2">
          <Paperclip size={13} />
          {admin ? "Sent with the invoice" : "Documents with this invoice"}
        </p>
        {admin && (
          <p className="data-mono text-xs text-pulse-text-mute">
            {attachments.length} of {MAX_ATTACHMENTS} · {megabytes(total)} of{" "}
            {megabytes(MAX_TOTAL_ATTACHMENT_BYTES)}
          </p>
        )}
      </div>

      {admin && (
        <p className="mt-1 text-xs text-pulse-text-dim">
          Anything attached here goes in the same email as the invoice PDF, and
          the client can download it from the invoice in their portal.
        </p>
      )}

      {attachments.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2/30 px-3 py-2"
            >
              <FileText size={14} className="shrink-0 text-pulse-text-mute" />
              <button
                type="button"
                onClick={() => download(a)}
                className="min-w-0 flex-1 truncate text-left text-sm text-pulse-text hover:underline"
                title={`Download ${a.file_name}`}
              >
                {a.file_name}
              </button>
              <span className="data-mono shrink-0 text-xs text-pulse-text-mute">
                {megabytes(Number(a.size_bytes))}
              </span>
              <button
                type="button"
                onClick={() => download(a)}
                aria-label={`Download ${a.file_name}`}
                className="shrink-0 text-pulse-text-mute hover:text-pulse-text"
              >
                <Download size={14} />
              </button>
              {editable && (
                <button
                  type="button"
                  onClick={() => remove(a)}
                  disabled={busy !== null}
                  aria-label={`Remove ${a.file_name}`}
                  className="shrink-0 text-pulse-text-mute hover:text-pulse-danger disabled:opacity-50"
                >
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            className="hidden"
            onChange={(e) => attach(e.target.files)}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null || attachments.length >= MAX_ATTACHMENTS}
          >
            <Paperclip size={14} /> Attach a document
          </Button>
          <span className="text-xs text-pulse-text-mute">
            PDF, Word, Excel, PowerPoint, CSV, text or images. Up to{" "}
            {MAX_ATTACHMENTS} files, {megabytes(MAX_TOTAL_ATTACHMENT_BYTES)} together.
          </span>
        </div>
      )}

      {busy && <p className="mt-2 text-xs text-pulse-text-dim">{busy}</p>}

      {admin && props.status === "sent" && editable && (
        <p className="mt-2 text-xs text-pulse-gold">
          Already sent. Adding or removing a document here does not send
          anything. Press Resend to send the invoice again with them.
        </p>
      )}
      {admin && !editable && (
        <p className="mt-2 text-xs text-pulse-text-mute">
          Closed record. These are the documents it was sent with.
        </p>
      )}
      {admin && props.recurring && (
        <p className="mt-2 text-xs text-pulse-text-mute">
          The monthly invoices made from this template do not carry these
          documents. They are sent the moment they are made, so there is no
          point at which one could be added.
        </p>
      )}

      {errors.length > 0 && (
        <ul className="mt-2 space-y-1">
          {errors.map((e, i) => (
            <li
              key={i}
              className="rounded-[var(--radius-input)] border border-pulse-danger/30 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger"
            >
              {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
