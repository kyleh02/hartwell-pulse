import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { aiConfigured, draft } from "@/lib/ai/claude";
import { followUpSystem, splitEmail } from "@/lib/ai/employee";
import { assistantSettings } from "@/lib/assistant";
import { onDoNotContact } from "@/lib/pipeline";
import { SOURCE_LABEL, STAGE_LABEL, type Lead, type LeadActivity } from "@/lib/pipeline-shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Draft a follow-up" on a lead: a subject and body for Kyle to edit and send
 * from his own email. Admin only, sends nothing, and refuses anyone on the
 * do-not-contact list, whose whole point is that they are not written to.
 */
export async function POST(req: Request) {
  const session = await getPulseSession();
  if (session?.role !== "admin") return new Response("Unauthorized", { status: 401 });
  if (!aiConfigured()) return Response.json({ error: "Add an Anthropic API key in Vercel to draft emails." }, { status: 503 });
  const { leadId } = (await req.json().catch(() => ({}))) as { leadId?: string };
  if (!leadId) return Response.json({ error: "No lead." }, { status: 400 });

  const sb = createAdminSupabase();
  const [{ data: leadRow }, { data: acts }, settings] = await Promise.all([
    sb.from("leads").select("*").eq("id", leadId).maybeSingle(),
    sb.from("lead_activity").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(20),
    assistantSettings(sb),
  ]);
  const l = leadRow as Lead | null;
  if (!l) return Response.json({ error: "That lead no longer exists." }, { status: 404 });
  if (l.email && (await onDoNotContact(sb, l.email))) {
    return Response.json({ error: `${l.email} is on your do-not-contact list, so there's nothing to draft.` }, { status: 409 });
  }

  const facts = [
    l.name && `Name: ${l.name}`,
    l.business && `Business: ${l.business}`,
    `Stage: ${STAGE_LABEL[l.stage]}`,
    `Came from: ${SOURCE_LABEL[l.source]}`,
    l.service && `Interested in: ${l.service}`,
    l.next_action && `Kyle's next action: ${l.next_action}`,
    l.notes && `Notes:\n${l.notes}`,
  ]
    .filter(Boolean)
    .join("\n");
  const log = ((acts as LeadActivity[] | null) ?? [])
    .reverse()
    .map((a) => `- ${a.created_at.slice(0, 10)} ${a.kind}${a.body ? `: ${a.body}` : ""}`)
    .join("\n");
  try {
    const text = await draft({
      system: followUpSystem(settings.knowledge),
      prompt: `The lead:\n${facts}\n\nWhat has happened so far, oldest first:\n${log || "(nothing logged)"}\n\nDraft the follow-up email.`,
    });
    if (!text) return Response.json({ error: "Claude didn't draft anything for that one. Write this one yourself." }, { status: 422 });
    return Response.json(splitEmail(text));
  } catch (e) {
    console.error("[draft-follow-up]", e);
    return Response.json({ error: "Couldn't reach Claude just now. Try again in a moment." }, { status: 502 });
  }
}
