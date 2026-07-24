import { type NextRequest } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

const GRACE_DAYS = 30;

/**
 * Permanently purges the PORTAL data of clients soft-deleted for more than 30
 * days.
 *
 * Deliberately NEVER touched, so financial records survive:
 *   - public.invoices
 *   - public.invoice_line_items
 *   - the public.clients row itself (kept as a named invoice anchor; we only
 *     stamp purged_at + park its status)
 *
 * Every write uses .throwOnError() so a query-level failure aborts that client's
 * purge with purged_at still null — it is retried on the next run rather than
 * being left half-purged and silently skipped forever (Supabase returns errors
 * rather than throwing, so without this a failed delete would be invisible).
 */
export async function GET(req: NextRequest) {
  const auth = cronAuthorized(req);
  if (!auth.ok) {
    return new Response(
      auth.status === 503 ? "Cron not configured (set CRON_SECRET)" : "Unauthorized",
      { status: auth.status },
    );
  }

  const supabase = createAdminSupabase();
  const cutoff = new Date(Date.now() - GRACE_DAYS * 86_400_000).toISOString();

  const { data: due, error: dueErr } = await supabase
    .from("clients")
    .select("id")
    .lt("deleted_at", cutoff)
    .is("purged_at", null);
  if (dueErr) {
    return new Response(`Could not list clients to purge: ${dueErr.message}`, {
      status: 500,
    });
  }
  const clients = (due as { id: string }[] | null) ?? [];

  let purged = 0;
  let failed = 0;
  for (const { id } of clients) {
    try {
      // 1) Remove the client's login(s) from Clerk.
      const { data: users, error: usersErr } = await supabase
        .from("client_users")
        .select("clerk_user_id")
        .eq("client_id", id);
      if (usersErr) throw new Error(usersErr.message);
      const clerk = await clerkClient();
      for (const u of (users as { clerk_user_id: string }[] | null) ?? []) {
        try {
          await clerk.users.deleteUser(u.clerk_user_id);
        } catch {
          // already gone — keep going
        }
      }

      // 2) Delete the client's portal data, children first. INVOICES AND
      //    INVOICE_LINE_ITEMS ARE INTENTIONALLY ABSENT. .throwOnError() makes a
      //    query failure abort this client (caught below) with purged_at null.
      await supabase.from("message_reactions").delete().eq("client_id", id).throwOnError();
      await supabase.from("asset_comments").delete().eq("client_id", id).throwOnError();
      await supabase.from("report_sections").delete().eq("client_id", id).throwOnError();
      await supabase.from("messages").delete().eq("client_id", id).throwOnError();
      await supabase.from("assets").delete().eq("client_id", id).throwOnError();
      await supabase.from("reports").delete().eq("client_id", id).throwOnError();
      await supabase.from("metrics").delete().eq("client_id", id).throwOnError();
      await supabase.from("services").delete().eq("client_id", id).throwOnError();
      await supabase.from("api_connections").delete().eq("client_id", id).throwOnError();
      await supabase.from("board_cards").delete().eq("client_id", id).throwOnError();
      await supabase.from("notifications").delete().eq("client_id", id).throwOnError();
      await supabase.from("client_users").delete().eq("client_id", id).throwOnError();

      // 3) Only once every delete above has succeeded, keep the clients row as
      //    an invoice anchor and stamp purged_at so we don't reprocess it.
      await supabase
        .from("clients")
        .update({ purged_at: new Date().toISOString(), status: "paused" })
        .eq("id", id)
        .throwOnError();

      purged++;
    } catch {
      // A failure leaves purged_at null, so this client is retried next run.
      // Re-deleting already-absent rows on retry is a harmless no-op.
      failed++;
    }
  }

  // ---- Conversations soft-deleted for more than 30 days: purge for good. ----
  // Everything is scoped to THIS conversation — a client can now hold several
  // threads (private per user + group), and purging one must never touch the
  // others. Attachments first (their paths only live on the message rows), then
  // the conversation row: messages, reactions and member rows go with it via FK
  // cascade. Old unread alerts were already cleared at soft-delete time.
  const { data: convDue } = await supabase
    .from("conversations")
    .select("id, client_id")
    .lt("deleted_at", cutoff);
  const convs = (convDue as { id: string; client_id: string }[] | null) ?? [];

  let convPurged = 0;
  let convFailed = 0;
  for (const cv of convs) {
    try {
      const { data: msgs } = await supabase
        .from("messages")
        .select("attachments")
        .eq("conversation_id", cv.id)
        .throwOnError();
      const paths = ((msgs as { attachments: { path?: string }[] | null }[] | null) ?? [])
        .flatMap((m) => m.attachments ?? [])
        .map((a) => a.path)
        .filter((p): p is string => !!p);
      for (let i = 0; i < paths.length; i += 100) {
        const { error: rmErr } = await supabase.storage
          .from("pulse-assets")
          .remove(paths.slice(i, i + 100));
        if (rmErr) throw new Error(rmErr.message);
      }

      await supabase.from("conversations").delete().eq("id", cv.id).throwOnError();
      convPurged++;
    } catch {
      // Conversation row survives, so this purge is retried on the next run.
      convFailed++;
    }
  }

  return Response.json({
    candidates: clients.length,
    purged,
    failed,
    conversations: { candidates: convs.length, purged: convPurged, failed: convFailed },
  });
}
