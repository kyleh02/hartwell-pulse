import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { verifySvix } from "@/lib/svix-verify";

/**
 * Resend delivery events.
 *
 * Resend signs webhooks with Svix, the same library Clerk uses, so the secret
 * is verified rather than trusted. An unverified endpoint here would let anyone
 * on the internet mark an invoice as bounced.
 *
 * Events arrive out of order. A "delivered" and a "sent" for the same message
 * can land in either sequence, so status only ever moves FORWARD through RANK
 * below. Without that, a late-arriving "sent" would quietly overwrite a bounce
 * and the whole point of this would be lost.
 */

const RANK: Record<string, number> = {
  sent: 0,
  delivered: 1,
  opened: 2,
  clicked: 3,
  // Terminal outcomes outrank everything. A bounce is the most important thing
  // that can be known about a message and nothing later should hide it.
  failed: 90,
  complained: 95,
  bounced: 99,
};

const EVENT_TO_STATUS: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivery_delayed": "sent",
  "email.failed": "failed",
};

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return new Response("Webhook not configured (set RESEND_WEBHOOK_SECRET)", {
      status: 503,
    });
  }

  const body = await req.text();
  const ok = verifySvix({
    secret,
    body,
    id: req.headers.get("svix-id") ?? "",
    timestamp: req.headers.get("svix-timestamp") ?? "",
    signature: req.headers.get("svix-signature") ?? "",
  });
  if (!ok) return new Response("Bad signature", { status: 400 });

  let event: { type?: string; data?: { email_id?: string; to?: string[] } };
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  const status = EVENT_TO_STATUS[event.type ?? ""];
  const providerId = event.data?.email_id;
  // An event about something we did not send, or one we do not track, is not
  // an error. Acknowledge it so Resend stops retrying.
  if (!status || !providerId) return Response.json({ ok: true, ignored: true });

  const supabase = createAdminSupabase();
  const { data: existing } = await supabase
    .from("email_events")
    .select("id, status")
    .eq("provider_id", providerId)
    .maybeSingle();
  const row = existing as { id: string; status: string } | null;
  if (!row) return Response.json({ ok: true, unknown: true });

  if ((RANK[status] ?? 0) <= (RANK[row.status] ?? 0)) {
    return Response.json({ ok: true, stale: true });
  }

  await supabase
    .from("email_events")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", row.id);

  return Response.json({ ok: true, status });
}
