import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { businessToday } from "@/lib/business-time";
import type { LeadSource } from "@/lib/pipeline-shared";
import { notifyAdmins } from "@/lib/notify";
import { pushToUsers } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * Website enquiries into the pipeline. The website's /api/enquiry function
 * posts here AFTER Kyle's own notification email has gone, so nothing this
 * route does can lose a lead: at worst the enquiry is in his inbox and not on
 * the board.
 *
 * Public in middleware (under /api/webhooks/), so the shared secret is the only
 * thing between it and the world. It fails CLOSED: no LEAD_WEBHOOK_SECRET in
 * Vercel means every request is refused, never allowed. The same value goes in
 * the website's Cloudflare settings as PULSE_LEAD_SECRET.
 *
 * Someone who enquires again while their lead is still open gets a note on the
 * existing lead rather than a second card.
 */

const MAX_BODY = 20_000;

function authorised(req: NextRequest): boolean | null {
  const secret = process.env.LEAD_WEBHOOK_SECRET;
  if (!secret) return null;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** How the alert names what came in. */
const ARRIVED: Record<string, string> = { website: "Enquiry", quiz: "Quiz result", audit: "Audit request" };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "") || null;

/**
 * Tell Kyle a lead has landed: a bell notification (with a desktop pop-up while
 * the portal is open) and a push to every device he has switched push on for.
 * The bell entry is `in_portal` because the website has already emailed him;
 * a second email for the same enquiry would be noise. Never allowed to fail
 * the request: the lead is saved whatever happens here.
 */
async function tellKyle(sb: ReturnType<typeof createAdminSupabase>, n: { title: string; body: string; id: string }) {
  try {
    const link = `/admin/pipeline/${n.id}`;
    const { data } = await sb.from("client_users").select("clerk_user_id").eq("role", "admin");
    const admins = ((data as { clerk_user_id: string }[] | null) ?? []).map((a) => a.clerk_user_id);
    await Promise.all([
      notifyAdmins(null, "lead", { title: n.title, body: n.body, link }, "in_portal"),
      pushToUsers(admins, { title: n.title, body: n.body, url: link, tag: `lead-${n.id}` }),
    ]);
  } catch (e) {
    console.error("[lead] could not notify:", e);
  }
}

export async function POST(req: NextRequest) {
  const auth = authorised(req);
  if (auth === null) return new Response("Not configured (set LEAD_WEBHOOK_SECRET)", { status: 503 });
  if (!auth) return new Response("Unauthorized", { status: 401 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response("Too large", { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Expected JSON", { status: 400 });
  }

  // The website already emailed Kyle a flagged copy. A bot does not belong on
  // the board as well.
  if (body.likelySpam === true) return Response.json({ ok: true, skipped: "spam" }, { status: 202 });

  const email = text(body.email, 200);
  const name = text(body.name, 120);
  if (!email?.includes("@") || !name) return new Response("Name and email are required", { status: 422 });

  const source: LeadSource = body.source === "audit" ? "audit" : body.source === "quiz" ? "quiz" : "website";
  const message = text(body.message, 4000);
  const spend = text(body.spend, 80);
  const notes = [message, spend && `Google Ads spend: ${spend}`].filter(Boolean).join("\n\n") || null;
  const today = businessToday();
  const supabase = createAdminSupabase();

  const { data: open, error: readErr } = await supabase
    .from("leads")
    .select("id, follow_up_on")
    .ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`))
    .not("stage", "in", "(won,lost)")
    .order("created_at", { ascending: false })
    .limit(1);
  if (readErr) return new Response(readErr.message, { status: 500 });

  const existing = (open as { id: string; follow_up_on: string | null }[] | null)?.[0];
  if (existing) {
    await supabase.from("lead_activity").insert({
      lead_id: existing.id,
      kind: "note",
      body: `Enquired again through the website${message ? `:\n\n${message}` : "."}`,
      created_by: "website",
    });
    await supabase
      .from("leads")
      .update({
        follow_up_on: !existing.follow_up_on || existing.follow_up_on > today ? today : existing.follow_up_on,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    await tellKyle(supabase, {
      id: existing.id,
      title: `${text(body.business, 160) ?? name} enquired again`,
      body: message ? message.slice(0, 140) : "Another enquiry through the website. It's on their lead.",
    });
    return Response.json({ ok: true, id: existing.id, merged: true });
  }

  const { data, error } = await supabase
    .from("leads")
    .insert({
      name,
      business: text(body.business, 160),
      email,
      phone: text(body.phone, 40),
      website: text(body.website, 300),
      service: text(body.service, 200),
      source,
      notes,
      next_action: source === "audit" ? "Send their written audit" : "Reply to their enquiry",
      // An enquiry is answered the day it arrives, so it is due today.
      follow_up_on: today,
      created_by: "website",
    })
    .select("id")
    .single();
  if (error) return new Response(error.message, { status: 500 });
  const id = (data as { id: string }).id;
  await supabase.from("lead_activity").insert({
    lead_id: id,
    kind: "created",
    body: source === "audit" ? "Asked for an audit on the website" : "Enquired through the website",
    created_by: "website",
  });
  const business = text(body.business, 160);
  const service = text(body.service, 200);
  await tellKyle(supabase, {
    id,
    title: `New lead: ${business ?? name}`,
    body: `${ARRIVED[source] ?? "Enquiry"} from ${name}${business ? ` at ${business}` : ""}${service ? `, about ${service}` : ""}. Due today.`,
  });
  return Response.json({ ok: true, id });
}
