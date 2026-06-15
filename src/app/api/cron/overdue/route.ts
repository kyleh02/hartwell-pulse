import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { sendEmail, emailLayout } from "@/lib/email";
import { formatMoney } from "@/lib/invoices-shared";
import type { Invoice } from "@/lib/types/database";

export const dynamic = "force-dynamic";

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function prettyDate(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Daily: gently remind clients about overdue (sent, unpaid, past-due) invoices,
// at most once a week per invoice. Run each morning (see vercel.json).
export async function GET(req: NextRequest) {
  const auth = cronAuthorized(req);
  if (!auth.ok) {
    return new Response(
      auth.status === 503 ? "Cron not configured (set CRON_SECRET)" : "Unauthorized",
      { status: auth.status },
    );
  }

  const supabase = createAdminSupabase();
  const today = fmt(new Date());
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const { data } = await supabase
    .from("invoices")
    .select("*")
    .eq("status", "sent")
    .lt("due_date", today);
  const overdue = (data as Invoice[] | null) ?? [];

  let reminders = 0;
  for (const inv of overdue) {
    if (inv.reminder_sent_at && new Date(inv.reminder_sent_at) > weekAgo) continue;

    const { data: users } = await supabase
      .from("client_users")
      .select("clerk_user_id, email")
      .eq("client_id", inv.client_id)
      .eq("role", "client");

    const title = `Reminder: invoice ${inv.invoice_number} is overdue`;
    const body = `${formatMoney(inv.total)} was due ${prettyDate(inv.due_date)}.`;
    const now = new Date().toISOString();

    for (const u of (users as { clerk_user_id: string; email: string | null }[] | null) ?? []) {
      await supabase.from("notifications").insert({
        recipient_user_id: u.clerk_user_id,
        client_id: inv.client_id,
        type: "invoice",
        title,
        body,
        link: `/invoices/${inv.id}`,
        channel: "instant",
        emailed_at: now,
      });
      if (u.email) {
        const html = emailLayout(
          "A quick reminder",
          `<p>Hi,</p><p>Just a gentle nudge that invoice <strong>${inv.invoice_number}</strong> for ${formatMoney(inv.total)} was due on ${prettyDate(inv.due_date)}. You can view and pay it in your portal.</p>`,
          "View invoice",
          `/invoices/${inv.id}`,
        );
        await sendEmail({ to: u.email, subject: title, html });
      }
    }
    await supabase.from("invoices").update({ reminder_sent_at: now }).eq("id", inv.id);
    reminders += 1;
  }

  return Response.json({ reminders });
}
