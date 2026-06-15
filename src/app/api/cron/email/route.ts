import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { sendEmail, emailLayout, escapeHtml } from "@/lib/email";
import { cronAuthorized } from "@/lib/cron-auth";
import type { Notification } from "@/lib/types/database";

export const dynamic = "force-dynamic";

// Emails any pending "instant" notifications (e.g. a message from Kyle).
export async function GET(req: NextRequest) {
  const auth = cronAuthorized(req);
  if (!auth.ok) {
    return new Response(
      auth.status === 503 ? "Cron not configured (set CRON_SECRET)" : "Unauthorized",
      { status: auth.status },
    );
  }

  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("channel", "instant")
    .is("emailed_at", null)
    .order("created_at", { ascending: true })
    .limit(50);
  const notes = (data as Notification[] | null) ?? [];

  let sent = 0;
  for (const n of notes) {
    const { data: cu } = await supabase
      .from("client_users")
      .select("email")
      .eq("clerk_user_id", n.recipient_user_id)
      .maybeSingle();
    const email = (cu as { email: string | null } | null)?.email;
    if (email) {
      const html = emailLayout(
        n.title,
        n.body ? `<p>${escapeHtml(n.body)}</p>` : "",
        "Open Pulse",
        n.link ?? "/",
      );
      await sendEmail({ to: email, subject: n.title, html });
      sent++;
    }
    await supabase
      .from("notifications")
      .update({ emailed_at: new Date().toISOString() })
      .eq("id", n.id);
  }

  return Response.json({ processed: notes.length, sent });
}
