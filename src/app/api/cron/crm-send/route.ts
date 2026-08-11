import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { graphConfigured } from "@/lib/graph";
import { draftOutreach, type OutreachTarget, type OutreachContact } from "@/lib/crm-send";

/**
 * Puts a finished draft in Outlook when its scheduled time arrives.
 *
 * This used to send. It stopped sending because four Graph sends produced four
 * 550 5.7.708 rejections to four unrelated domains, while every message typed
 * in Outlook the same day arrived, including a cold one between two of the
 * failures. The submission path was the difference, so the portal now composes
 * and Outlook sends.
 *
 * Nothing here logs a touch. A draft is not a send.
 */
export async function GET(req: NextRequest) {
  const auth = cronAuthorized(req);
  if (!auth.ok) {
    return new Response(
      auth.status === 503 ? "Cron not configured (set CRON_SECRET)" : "Unauthorized",
      { status: auth.status },
    );
  }
  if (!graphConfigured()) {
    return new Response("Outlook is not configured", { status: 503 });
  }

  const supabase = createAdminSupabase();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("crm_organisations")
    .select(
      "id, legal_name, trading_name, email_subject, email_body, stage, hard_warning, send_approved_checks, crm_contacts(id, first_name, surname, email_as_published, opt_out_token, opt_out_at)",
    )
    .eq("brand", "ironpeak")
    .in("stage", ["queued", "contacted"])
    .not("send_approved_at", "is", null)
    .not("scheduled_send_at", "is", null)
    .lte("scheduled_send_at", now)
    // Already drafted is already done. Without this the same draft would pile
    // up in the folder every five minutes.
    .is("draft_created_at", null)
    .order("scheduled_send_at");
  if (error) return new Response(error.message, { status: 500 });

  type Row = OutreachTarget & {
    send_approved_checks: Record<string, unknown>;
    crm_contacts: OutreachContact[] | null;
  };
  const due = (data as Row[] | null) ?? [];
  const results: { company: string; status: string }[] = [];

  for (const org of due) {
    const contact = org.crm_contacts?.[0];
    if (!contact) {
      results.push({ company: org.legal_name, status: "skipped-no-contact" });
      continue;
    }

    const res = await draftOutreach(
      supabase,
      org,
      contact,
      org.send_approved_checks ?? {},
      org.stage === "queued" ? "email_1" : "email_2",
    );

    if (res.ok) {
      await supabase
        .from("crm_organisations")
        .update({
          draft_created_at: new Date().toISOString(),
          graph_message_id: res.id,
          graph_web_link: res.webLink,
          send_error: null,
          next_action: "Draft is in Outlook. Send it, then mark it sent here.",
        })
        .eq("id", org.id);
      results.push({ company: org.legal_name, status: "drafted" });
      continue;
    }

    // Clear the approval so a record that cannot be drafted stops being
    // retried every five minutes and starts being something to look at.
    await supabase
      .from("crm_organisations")
      .update({ send_error: res.message, send_approved_at: null })
      .eq("id", org.id);
    results.push({ company: org.legal_name, status: `failed:${res.message}` });
  }

  return Response.json({ checked: due.length, results });
}
