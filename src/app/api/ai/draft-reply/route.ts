import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { aiConfigured, draft } from "@/lib/ai/claude";
import { replySystem } from "@/lib/ai/employee";
import { accountFacts, assistantSettings } from "@/lib/assistant";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Kyle's "Draft" button in a client chat: a suggested reply for the composer.
 * Admin only. Returns text; sends nothing. A route rather than a server action
 * because a model call can outlast an action's ten seconds on Hobby.
 */
export async function POST(req: Request) {
  const session = await getPulseSession();
  if (session?.role !== "admin") return new Response("Unauthorized", { status: 401 });
  if (!aiConfigured()) return Response.json({ error: "Add an Anthropic API key in Vercel to draft replies." }, { status: 503 });
  const { conversationId } = (await req.json().catch(() => ({}))) as { conversationId?: string };
  if (!conversationId) return Response.json({ error: "No conversation." }, { status: 400 });

  const sb = createAdminSupabase();
  const { data: conv } = await sb.from("conversations").select("id, client_id").eq("id", conversationId).maybeSingle();
  const c = conv as { id: string; client_id: string } | null;
  if (!c) return Response.json({ error: "That conversation no longer exists." }, { status: 404 });
  const [{ data: rows }, settings, facts] = await Promise.all([
    sb.from("messages").select("sender_role, sender_user_id, body, created_at").eq("conversation_id", c.id).order("created_at", { ascending: false }).limit(30),
    assistantSettings(sb),
    accountFacts(sb, c.client_id, null),
  ]);
  const msgs = ((rows as { sender_role: string; body: string | null; created_at: string }[] | null) ?? []).reverse().filter((m) => m.body?.trim());
  if (!msgs.length) return Response.json({ error: "Nothing in this chat to reply to yet." }, { status: 400 });

  const transcript = msgs.map((m) => `${m.sender_role === "admin" ? "Kyle" : "Client"} (${m.created_at.slice(0, 16).replace("T", " ")} UTC): ${m.body}`).join("\n");
  try {
    const text = await draft({
      system: replySystem(settings.knowledge),
      prompt: `Account summary:\n${facts?.text ?? "(unavailable)"}\n\nThe chat so far, oldest first:\n${transcript}\n\nDraft Kyle's next message.`,
    });
    if (!text) return Response.json({ error: "Claude didn't draft anything for that one. Write this reply yourself." }, { status: 422 });
    return Response.json({ text });
  } catch (e) {
    console.error("[draft-reply]", e);
    return Response.json({ error: "Couldn't reach Claude just now. Try again in a moment." }, { status: 502 });
  }
}
