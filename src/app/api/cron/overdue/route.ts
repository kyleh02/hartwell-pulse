import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { sendEmail, emailLayout } from "@/lib/email";
import { formatMoney } from "@/lib/invoices-shared";
import { invoiceRecipients } from "@/lib/invoices-send";
import type { Invoice } from "@/lib/types/database";
import { businessToday } from "@/lib/business-time";
import { outstandingOf } from "@/lib/invoices-shared";
import { daysOverdue, reminderDue } from "@/lib/invoice-reminders";
import { isMissingColumn } from "@/lib/db-errors";

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

// Daily at 08:00 UTC, 7pm Melbourne in summer (see vercel.json). Two jobs:
//
//   1. A heads-up a few days BEFORE the due date, once per invoice. This is the
//      one that prevents lateness rather than chasing it: paying is still
//      ordinary admin at that point, not an apology.
//   2. The overdue chase afterwards: a gentle nudge, a firmer one two days
//      later, then the firm one weekly (invoice-reminders.ts, Kyle 23 Nov
//      2026), plus an alert to Kyle when it first tips over and when the
//      firmer one first goes.
export async function GET(req: NextRequest) {
  const auth = cronAuthorized(req);
  if (!auth.ok) {
    return new Response(
      auth.status === 503 ? "Cron not configured (set CRON_SECRET)" : "Unauthorized",
      { status: auth.status },
    );
  }

  const supabase = createAdminSupabase();
  const today = businessToday();

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
      // Never chase an invoice that has been split. Its instalments do the
      // chasing now, each for its own amount and its own date.
      .is("split_at", null)
      .is("pre_reminder_sent_at", null)
      .gte("due_date", today)
      .lte("due_date", fmt(horizon));
    const soon = (soonData as Invoice[] | null) ?? [];

    for (const inv of soon) {
      // Same recipients the invoice itself went to. A reminder landing with
      // someone who never received the invoice is worse than no reminder.
      const users = await invoiceRecipients(supabase, inv);
      if (users.length === 0) continue;
      const title = `Invoice ${inv.invoice_number} is due ${prettyDate(inv.due_date)}`;
      const now = new Date().toISOString();

      for (const u of users) {
        await supabase.from("notifications").insert({
          recipient_user_id: u.clerk_user_id,
          client_id: inv.client_id,
          type: "invoice",
          title,
          body: `${formatMoney(outstandingOf(inv))} due shortly.`,
          link: `/invoices/${inv.id}`,
          channel: "instant",
          emailed_at: now,
        });
        if (u.email) {
          const html = emailLayout(
            "Coming up",
            `<p>Hi,</p><p>A heads-up that invoice <strong>${inv.invoice_number}</strong> for ${formatMoney(outstandingOf(inv))} is due on ${prettyDate(inv.due_date)}. Nothing is late, this is just so it does not sneak up on you.</p>`,
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
    .is("split_at", null)
    .lt("due_date", today);
  const overdue = (data as Invoice[] | null) ?? [];

  let reminders = 0;
  for (const inv of overdue) {
    // Gentle first, firmer two days later, then the firm one weekly
    // (invoice-reminders.ts). Without migration 0069 the count is unknown and
    // the old weekly gentle nudge stands.
    const count = (inv as Invoice & { reminder_count?: number }).reminder_count;
    const step = reminderDue(count, inv.reminder_sent_at, new Date());
    if (!step.due) continue;

    const users = await invoiceRecipients(supabase, inv);
    if (users.length === 0) continue;

    const urgent = step.tone === "urgent";
    const late = daysOverdue(inv.due_date, today);
    const title = urgent
      ? `Overdue: invoice ${inv.invoice_number}, ${late} day${late === 1 ? "" : "s"} late`
      : `Reminder: invoice ${inv.invoice_number} is overdue`;
    const body = `${formatMoney(outstandingOf(inv))} was due ${prettyDate(inv.due_date)}.`;
    const now = new Date().toISOString();

    for (const u of users) {
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
        const html = urgent
          ? emailLayout(
              "Payment overdue",
              `<p>Hi,</p><p>Invoice <strong>${inv.invoice_number}</strong> for ${formatMoney(outstandingOf(inv))} was due on ${prettyDate(inv.due_date)} and is now ${late} day${late === 1 ? "" : "s"} overdue. Please pay it today, or reply and let me know when it will be paid.</p><p>If it has already gone through, thank you. Please send the remittance so I can match it up.</p>`,
              "View and pay invoice",
              `/invoices/${inv.id}`,
            )
          : emailLayout(
              "A quick reminder",
              `<p>Hi,</p><p>Just a gentle nudge that invoice <strong>${inv.invoice_number}</strong> for ${formatMoney(outstandingOf(inv))} was due on ${prettyDate(inv.due_date)}. You can view and pay it in your portal.</p>`,
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
          body: `${formatMoney(outstandingOf(inv))}, due ${prettyDate(inv.due_date)}. The client has been reminded.`,
          link: `/admin/invoices/${inv.id}`,
          channel: "in_portal",
        });
      }
    }

    // The first time the firmer one goes, Kyle hears about it too.
    if (urgent && count === 1) {
      for (const adminId of admins) {
        await supabase.from("notifications").insert({
          recipient_user_id: adminId,
          client_id: inv.client_id,
          type: "invoice",
          title: `${inv.invoice_number}: firmer reminder sent`,
          body: `${formatMoney(outstandingOf(inv))}, ${late} days overdue. Weekly from here until it's paid.`,
          link: `/admin/invoices/${inv.id}`,
          channel: "in_portal",
        });
      }
    }

    await supabase.from("invoices").update({ reminder_sent_at: now }).eq("id", inv.id);
    // The count in its own update, so a database without 0069 refuses only this.
    if (count !== undefined && count !== null) {
      const { error: cErr } = await supabase.from("invoices").update({ reminder_count: count + 1 }).eq("id", inv.id);
      if (cErr && !isMissingColumn(cErr)) console.error("[overdue] reminder_count:", cErr.message);
    }
    reminders += 1;
  }

  return Response.json({ heads_up, reminders });
}
