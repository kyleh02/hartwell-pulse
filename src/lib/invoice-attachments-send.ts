// Gathering an invoice's extra documents for the send. Kept apart from
// invoices-send.ts, and with type-only imports, so it can be tested against a
// stand-in for Supabase.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ExtraAttachment {
  filename: string;
  /** Base64, which is what Resend takes. */
  content: string;
}

export interface CollectedExtras {
  files: ExtraAttachment[];
  /** What actually went, in order, for the email text and the send record. */
  names: string[];
  /** What was meant to go and could not be read. Only ever filled when unattended. */
  skipped: string[];
}

/** Postgres and PostgREST codes for "that table does not exist". */
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

/**
 * Read every document attached to an invoice, ready to send.
 *
 * Two failure rules, and the difference between them is whether anyone is
 * watching.
 *
 * Sent by hand: a document that cannot be read STOPS the send, naming it, and
 * this runs before any email is sent so nothing has gone out. Kyle attached it
 * on purpose, and an email that quietly arrives without it while saying nothing
 * is the failure that never gets noticed.
 *
 * Sent unattended, by a scheduled job: the invoice goes regardless and the
 * missing document is reported back, because the rule for invoices is that one
 * which does not arrive is worse than one that arrives incomplete, and there is
 * nobody at the keyboard to fix it.
 *
 * A table that does not exist yet means nothing can be attached, so it is not
 * an error. Without that, shipping this code before its migration was run would
 * have stopped every invoice send in the portal.
 */
export async function collectExtraAttachments(
  supabase: SupabaseClient,
  invoiceId: string,
  opts: { unattended: boolean },
): Promise<CollectedExtras> {
  const out: CollectedExtras = { files: [], names: [], skipped: [] };

  const { data, error } = await supabase
    .from("invoice_attachments")
    .select("file_name, storage_path")
    .eq("invoice_id", invoiceId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    if (MISSING_TABLE.has((error as { code?: string }).code ?? "")) return out;
    if (opts.unattended) {
      out.skipped.push("the attached documents (their list could not be read)");
      return out;
    }
    throw new Error(
      `Could not read the documents attached to this invoice, so nothing was sent: ${error.message}`,
    );
  }

  const rows = (data as { file_name: string; storage_path: string }[] | null) ?? [];
  for (const row of rows) {
    const { data: file, error: dlErr } = await supabase.storage
      .from("pulse-reports")
      .download(row.storage_path);
    if (dlErr || !file) {
      if (opts.unattended) {
        out.skipped.push(row.file_name);
        continue;
      }
      throw new Error(
        `Could not read "${row.file_name}" to attach it, so nothing was sent. Remove it, attach it again, then send.`,
      );
    }
    out.files.push({
      filename: row.file_name,
      content: Buffer.from(await file.arrayBuffer()).toString("base64"),
    });
    out.names.push(row.file_name);
  }
  return out;
}
