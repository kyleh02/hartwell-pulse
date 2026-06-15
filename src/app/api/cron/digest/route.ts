import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { sendEmail, emailLayout, escapeHtml } from "@/lib/email";
import { cronAuthorized } from "@/lib/cron-auth";
import type { Notification } from "@/lib/types/database";

export const dynamic = "force-dynamic";

// Batches pending "digest" notifications into one weekly email per recipient.
// Schedule this for Monday morning (see vercel.json).
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
    .eq("channel", "digest")
    .is("emailed_at", null);
  const notes = (data as Notification[] | null) ?? [];

  const byUser = new Map<string, Notification[]>();
  for (const n of notes) {
    const arr = byUser.get(n.recipient_user_id) ?? [];
    arr.push(n);
    byUser.set(n.recipient_user_id, arr);
  }

  let sent = 0;
  for (const [uid, list] of byUser) {
    const { data: cu } = await supabase
      .from("client_users")
      .select("email")
      .eq("clerk_user_id", uid)
      .maybeSingle();
    const email = (cu as { email: string | null } | null)?.email;
    if (email) {
      const itemsHtml = list
        .map(
          (n) =>
            `<li style="margin-bottom:10px"><strong>${escapeHtml(n.title)}</strong>${n.body ? `<br><span style="color:#666">${escapeHtml(n.body)}</span>` : ""}</li>`,
        )
        .join("");
      const html = emailLayout(
        "Your week with Hartwell Digital",
        `<p>Here is what happened this week:</p><ul style="padding-left:18px">${itemsHtml}</ul>`,
        "Open Pulse",
        "/",
      );
      await sendEmail({
        to: email,
        subject: "Your weekly Hartwell Digital summary",
        html,
      });
      sent++;
    }
    await supabase
      .from("notifications")
      .update({ emailed_at: new Date().toISOString() })
      .in(
        "id",
        list.map((n) => n.id),
      );
  }

  return Response.json({ recipients: byUser.size, sent });
}
