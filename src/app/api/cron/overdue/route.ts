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

// Daily, each morning (see vercel.json). Two jobs:
//
//   1. A heads-up a few days BEFORE the due date, once per invoice. This is the
//      one that prevents lateness rather than chasing it: paying is still
//      ordinary admin at that point, not an apology.
//   2. The overdue nudge afterwards, at most once a week per invoice, plus an
//      alert to Kyle the first time one tips over so he is not the last to know.
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

  const { data: settingsRow } = await supabase
    .from("business_settings")
    .select("reminder_days_before")
    .eq("id", 1)
    .maybeSingle();
  const daysBefore =
    (settingsRow as { reminder_days_before: number } | null)?.reminder_days_before ?? 3;

  // Everyone who should hear about an invoice going astray.
  const { data: adminRows } = await supabase
    .from("client_users")
    .select("clerk_user_id")
    .eq("role", "admin");
  const admins = ((adminRows as { clerk_user_id: string }[] | null) ?? []).map(
    (a) => a.clerk_user_id,
  );

  // ---- 1. Due soon, not yet reminded ----
  let heads_up = 0;
  if (daysBefore > 0) {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + daysBefore);
    const { data: soonData } = await supabase
      .from("invoices")
      .select("*")
      .eq("status", "sent")
      .is("pre_reminder_sent_at", null)
      .gte("due_date", today)
      .lte("due_date", fmt(horizon));
    const soon = (soonData as Invoice[] | null) ?? [];

    for (const inv of soon) {
      const { data: users } = await supabase
        .from("client_users")
        .select("clerk_user_id, email")
        .eq("client_id", inv.client_id)
        .eq("role", "client");
      const title = `Invoice ${inv.invoice_number} is due ${prettyDate(inv.due_date)}`;
      const now = new Date().toISOString();

      for (const u of (users as { clerk_user_id: string; email: string | null }[] | null) ?? []) {
        await supabase.from("notifications").insert({
          recipient_user_id: u.clerk_user_id,
          client_id: inv.client_id,
          type: "invoice",
          title,
          body: `${formatMoney(inv.total)} due shortly.`,
          link: `/invoices/${inv.id}`,
          channel: "instant",
          emailed_at: now,
        });
        if (u.email) {
          const html = emailLayout(
            "Coming up",
            `<p>Hi,</p><p>A heads-up that invoice <strong>${inv.invoice_number}</strong> for ${formatMoney(inv.total)} is due on ${prettyDate(inv.due_date)}. Nothing is late, this is just so it does not sneak up on you.</p>`,
            "View invoice",
            `/invoices/${inv.id}`,
          );
          await sendEmail({ to: u.email, subject: title, html });
        }
      }
      await supabase
        .from("invoices")
        .update({ pre_reminder_sent_at: now })
        .eq("id", inv.id);
      heads_up += 1;
    }
  }

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
    // Tell Kyle the first time it goes overdue, then leave him alone: the
    // client keeps getting the weekly nudge, but a repeat alert to the person
    // who cannot pay it is just noise.
    if (!inv.reminder_sent_at) {
      for (const adminId of admins) {
        await supabase.from("notifications").insert({
          recipient_user_id: adminId,
          client_id: inv.client_id,
          type: "invoice",
          title: `${inv.invoice_number} is now overdue`,
          body: `${formatMoney(inv.total)}, due ${prettyDate(inv.due_date)}. The client has been reminded.`,
          link: `/admin/invoices/${inv.id}`,
          channel: "in_portal",
        });
      }
    }

    await supabase.from("invoices").update({ reminder_sent_at: now }).eq("id", inv.id);
    reminders += 1;
  }

  return Response.json({ heads_up, reminders });
}
