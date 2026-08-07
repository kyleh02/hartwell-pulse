import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Recipient {
  clerk_user_id: string;
  email: string | null;
  full_name: string | null;
}

/**
 * Who on a client account a document goes to.
 *
 * ONE implementation, shared by invoices and reports and by every reminder
 * that follows them, because the rule below is easy to get subtly wrong and
 * three copies of it would drift.
 *
 * An empty `chosen` means EVERYONE on the account. That is what every invoice
 * and report predating the recipient columns carries, so nothing already in
 * the system changed behaviour when they were added, and it stays the right
 * answer for a client with a single contact who should never have to
 * configure anything.
 *
 * An id that is no longer on the account drops out. The account is the source
 * of truth for who exists, and resurrecting someone who has left because their
 * id lingers on an old document would be worse than silence. Callers must
 * treat an empty RESULT as a stop, never as a reason to fall back to everyone:
 * falling back would send to precisely the person who was deselected.
 */
export async function resolveRecipients(
  supabase: SupabaseClient,
  clientId: string,
  chosen: string[] | null | undefined,
): Promise<Recipient[]> {
  const { data } = await supabase
    .from("client_users")
    .select("clerk_user_id, email, full_name")
    .eq("client_id", clientId)
    .eq("role", "client");
  const all = (data as Recipient[] | null) ?? [];
  const picked = chosen ?? [];
  if (picked.length === 0) return all;
  return all.filter((u) => picked.includes(u.clerk_user_id));
}

/** "Daryl" out of "Daryl Hartwell", for the greeting line of an email. */
export function firstName(r: Recipient): string {
  const n = (r.full_name ?? "").trim();
  if (n) return n.split(/\s+/)[0];
  return "there";
}
