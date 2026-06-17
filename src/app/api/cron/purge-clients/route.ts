import { type NextRequest } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

const GRACE_DAYS = 30;

/**
 * Permanently purges the PORTAL data of clients that have been soft-deleted for
 * more than 30 days.
 *
 * Deliberately NEVER touched, so historical records survive:
 *   - public.invoices
 *   - public.invoice_line_items
 *   - the public.clients row itself (kept as an anonymous-but-named invoice
 *     anchor; we only stamp purged_at + park its status)
 *
 * Everything else belonging to the client is removed, children before parents.
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

  const { data: due } = await supabase
    .from("clients")
    .select("id")
    .lt("deleted_at", cutoff)
    .is("purged_at", null);
  const clients = (due as { id: string }[] | null) ?? [];

  let purged = 0;
  for (const { id } of clients) {
    try {
      // 1) Remove the client's login(s) from Clerk.
      const { data: users } = await supabase
        .from("client_users")
        .select("clerk_user_id")
        .eq("client_id", id);
      const clerk = await clerkClient();
      for (const u of (users as { clerk_user_id: string }[] | null) ?? []) {
        try {
          await clerk.users.deleteUser(u.clerk_user_id);
        } catch {
          // already gone — keep going
        }
      }

      // 2) Delete the client's portal data — children first to respect FKs.
      //    NOTE: invoices and invoice_line_items are intentionally absent.
      await supabase.from("message_reactions").delete().eq("client_id", id);
      await supabase.from("asset_comments").delete().eq("client_id", id);
      await supabase.from("report_sections").delete().eq("client_id", id);
      await supabase.from("messages").delete().eq("client_id", id);
      await supabase.from("assets").delete().eq("client_id", id);
      await supabase.from("reports").delete().eq("client_id", id);
      await supabase.from("metrics").delete().eq("client_id", id);
      await supabase.from("services").delete().eq("client_id", id);
      await supabase.from("api_connections").delete().eq("client_id", id);
      await supabase.from("board_cards").delete().eq("client_id", id);
      await supabase.from("notifications").delete().eq("client_id", id);
      await supabase.from("client_users").delete().eq("client_id", id);

      // 3) Keep the clients row as an invoice anchor (business_name retained so
      //    old invoices still show who they were for). Stamp purged_at so we
      //    don't reprocess it, and park its status.
      await supabase
        .from("clients")
        .update({ purged_at: new Date().toISOString(), status: "paused" })
        .eq("id", id);

      purged++;
    } catch {
      // Leave purged_at null so this client is retried on the next run rather
      // than half-purged silently.
    }
  }

  return Response.json({ candidates: clients.length, purged });
}
