import Anthropic from "@anthropic-ai/sdk";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { ASSISTANT_MODEL, claude } from "@/lib/ai/claude";
import {
  CONVERSATION_GAP_MS,
  DAILY_LIMIT,
  MAX_QUESTION,
  PASS_TO_KYLE,
  accountFacts,
  assistantSettings,
  systemBlocks,
} from "@/lib/assistant";
import { notifyAdmins } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The client's "Quick answers" chat (0059).
 *
 * GET: the conversation still under way, so a reopened panel carries on.
 * POST { message }: saves the question, streams the answer back as plain
 * text, then saves the answer. A route handler rather than a server action,
 * because an action has ten seconds on Hobby and a streamed answer is
 * better shown as it comes.
 *
 * The service role writes everything, after the session check here: a client
 * only ever reads their own rows (RLS), and never writes them directly.
 */

const NOT_NOW = "The quick answers aren't available right now. Message Kyle instead and he'll get back to you.";
const SORRY = "Sorry, I couldn't answer that just now. Message Kyle instead and he'll get back to you.";

type Msg = { role: "user" | "assistant"; content: string; handed_off: boolean; created_at: string };

async function who() {
  const session = await getPulseSession();
  if (!session?.clientId || session.role !== "client") return null;
  return session;
}

async function currentConversation(sb: ReturnType<typeof createAdminSupabase>, userId: string) {
  const { data } = await sb
    .from("assistant_conversations")
    .select("id, last_message_at, emailed_at")
    .eq("user_id", userId)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const c = data as { id: string; last_message_at: string; emailed_at: string | null } | null;
  // Once Kyle has had his email about a conversation, the next question starts
  // a new one: one email per conversation, and none goes stale.
  return c && !c.emailed_at && Date.now() - Date.parse(c.last_message_at) < CONVERSATION_GAP_MS ? c.id : null;
}

export async function GET() {
  const session = await who();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const sb = createAdminSupabase();
  const settings = await assistantSettings(sb);
  if (!settings.enabled || !claude()) return Response.json({ enabled: false, messages: [] });
  const id = await currentConversation(sb, session.clerkUserId);
  if (!id) return Response.json({ enabled: true, messages: [] });
  const { data } = await sb.from("assistant_messages").select("role, content, handed_off, created_at").eq("conversation_id", id).order("created_at");
  return Response.json({ enabled: true, messages: (data as Msg[] | null) ?? [] });
}

export async function POST(req: Request) {
  const session = await who();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const api = claude();
  const sb = createAdminSupabase();
  const settings = await assistantSettings(sb);
  if (!settings.enabled || !api) return new Response(NOT_NOW, { status: 503 });

  let message = "";
  try {
    message = String(((await req.json()) as { message?: unknown }).message ?? "").trim();
  } catch {
    return new Response("Expected JSON", { status: 400 });
  }
  if (!message) return new Response("Ask a question first.", { status: 400 });
  if (message.length > MAX_QUESTION) return new Response(`Keep it under ${MAX_QUESTION} characters, or message Kyle.`, { status: 400 });

  // A day's limit per person keeps a runaway loop, or a curious teenager, from
  // becoming a bill.
  const { data: mine } = await sb.from("assistant_conversations").select("id").eq("user_id", session.clerkUserId).gte("last_message_at", new Date(Date.now() - 86_400_000).toISOString());
  const ids = ((mine as { id: string }[] | null) ?? []).map((c) => c.id);
  if (ids.length) {
    const { count } = await sb.from("assistant_messages").select("id", { count: "exact", head: true }).in("conversation_id", ids).eq("role", "user").gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
    if ((count ?? 0) >= DAILY_LIMIT) return new Response("That's a lot of questions for one day. Message Kyle and he'll pick it up from here.", { status: 429 });
  }

  const facts = await accountFacts(sb, session.clientId!, session.profile?.full_name?.trim().split(/\s+/)[0] ?? null);
  if (!facts) return new Response(NOT_NOW, { status: 503 });

  let convId = await currentConversation(sb, session.clerkUserId);
  if (!convId) {
    const { data, error } = await sb.from("assistant_conversations").insert({ client_id: session.clientId, user_id: session.clerkUserId }).select("id").single();
    if (error || !data) return new Response(NOT_NOW, { status: 503 });
    convId = (data as { id: string }).id;
  }
  const { data: past } = await sb.from("assistant_messages").select("role, content").eq("conversation_id", convId).order("created_at", { ascending: false }).limit(20);
  const history = (((past as { role: "user" | "assistant"; content: string }[] | null) ?? []).reverse()).map(
    (m): Anthropic.Beta.BetaMessageParam => ({ role: m.role, content: m.content }),
  );
  // The question is kept before anything else can fail, so Kyle sees it whatever happens next.
  await sb.from("assistant_messages").insert({ conversation_id: convId, role: "user", content: message });

  const messages: Anthropic.Beta.BetaMessageParam[] = [...history, { role: "user", content: message }];
  const system = systemBlocks(settings.knowledge, facts);
  const encoder = new TextEncoder();
  const conversationId = convId;
  const clientId = session.clientId!;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = "";
      let handedOff = false;
      const say = (t: string) => {
        answer += t;
        controller.enqueue(encoder.encode(t));
      };
      try {
        for (let turn = 0; turn < 3; turn++) {
          // Haiku 5.5: no server-side fallback exists for it, so none is sent.
          // Thinking counts toward max_tokens, hence the room for a short reply.
          const stream = api.beta.messages.stream({
            model: ASSISTANT_MODEL,
            max_tokens: 2048,
            output_config: { effort: "low" },
            system,
            tools: [PASS_TO_KYLE],
            messages,
          });
          stream.on("text", say);
          const final = await stream.finalMessage();
          if (final.stop_reason === "refusal") {
            if (!answer) say("I can't help with that one here. Message Kyle and he'll sort it out.");
            break;
          }
          const calls = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
          if (final.stop_reason !== "tool_use" || !calls.length) break;
          messages.push({ role: "assistant", content: final.content });
          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const call of calls) {
            const input = call.input as { question?: unknown; reason?: unknown };
            if (call.name !== "pass_to_kyle" || typeof input.question !== "string") {
              results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: "Unknown tool or missing question." });
              continue;
            }
            handedOff = true;
            await notifyAdmins(
              clientId,
              "assistant",
              { title: `${facts.business}: a question for you`, body: input.question.slice(0, 300), link: "/admin/assistant" },
              "in_portal",
            );
            results.push({ type: "tool_result", tool_use_id: call.id, content: "Passed to Kyle. He will reply in their Messages." });
          }
          messages.push({ role: "user", content: results });
          if (answer && !/\s$/.test(answer)) say("\n\n");
        }
      } catch (e) {
        console.error("[assistant]", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
        say(answer ? `\n\n${SORRY}` : SORRY);
      }
      if (!answer.trim()) say(SORRY);
      await sb.from("assistant_messages").insert({ conversation_id: conversationId, role: "assistant", content: answer.trim(), handed_off: handedOff });
      const { data: conv } = await sb.from("assistant_conversations").select("message_count, handed_off").eq("id", conversationId).maybeSingle();
      const c = conv as { message_count: number; handed_off: boolean } | null;
      await sb
        .from("assistant_conversations")
        .update({ last_message_at: new Date().toISOString(), message_count: (c?.message_count ?? 0) + 2, handed_off: (c?.handed_off ?? false) || handedOff })
        .eq("id", conversationId);
      controller.close();
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
