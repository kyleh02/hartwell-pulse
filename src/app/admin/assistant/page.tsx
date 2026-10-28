import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { BUSINESS_TZ } from "@/lib/business-time";
import { aiConfigured } from "@/lib/ai/claude";
import { assistantSettings, type Transcript } from "@/lib/assistant";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Assistant" };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-AU", { timeZone: BUSINESS_TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Every conversation clients have had with the portal assistant, newest first. */
export default async function AssistantPage() {
  const supabase = await createServerSupabase();
  const [{ data, error }, { data: clientRows }, { data: people }, settings] = await Promise.all([
    supabase.from("assistant_conversations").select("*").order("last_message_at", { ascending: false }).limit(50),
    supabase.from("clients").select("id, business_name"),
    supabase.from("client_users").select("clerk_user_id, full_name"),
    assistantSettings(supabase),
  ]);
  const missing = !!error && (error.code === "PGRST205" || error.code === "42P01");
  const convs = (data as Omit<Transcript, "messages">[] | null) ?? [];
  const ids = convs.map((c) => c.id);
  const { data: msgRows } = ids.length
    ? await supabase.from("assistant_messages").select("conversation_id, role, content, handed_off, created_at").in("conversation_id", ids).order("created_at")
    : { data: [] };
  const byConv = new Map<string, Transcript["messages"]>();
  for (const m of (msgRows as (Transcript["messages"][number] & { conversation_id: string })[] | null) ?? []) {
    const arr = byConv.get(m.conversation_id) ?? [];
    arr.push(m);
    byConv.set(m.conversation_id, arr);
  }
  const names = new Map(((clientRows as { id: string; business_name: string }[] | null) ?? []).map((c) => [c.id, c.business_name]));
  const who = new Map(((people as { clerk_user_id: string; full_name: string | null }[] | null) ?? []).map((p) => [p.clerk_user_id, p.full_name]));
  const live = settings.enabled && aiConfigured();

  return (
    <div>
      <PageHeader
        label={["Assistant"]}
        title="Portal assistant"
        description="What clients have asked the Quick answers assistant, and what it told them. Anything it passed to you is marked."
      />
      {missing ? (
        <p className="rounded-[16px] border border-pulse-border bg-pulse-surface p-5 text-sm text-pulse-text-dim">Run migration 0059 in the Supabase SQL Editor to switch the assistant on.</p>
      ) : (
        <>
          {!live && (
            <p className="mb-6 rounded-[16px] border border-pulse-gold/40 bg-pulse-gold/[0.06] p-5 text-sm text-pulse-text-dim">
              {aiConfigured() ? "The assistant is switched off, so clients don't see it." : "The assistant needs an Anthropic API key in Vercel before it can answer."}{" "}
              <Link href="/admin/settings" className="font-semibold text-pulse-gold underline-offset-4 hover:underline">
                Settings
              </Link>
            </p>
          )}
          {convs.length === 0 ? (
            <p className="rounded-[16px] border border-pulse-border bg-pulse-surface p-5 text-sm text-pulse-text-dim">No conversations yet.</p>
          ) : (
            <ul className="space-y-4">
              {convs.map((c) => (
                <li key={c.id} className="rounded-[20px] border border-pulse-border bg-pulse-surface p-5">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-pulse-text">
                      {names.get(c.client_id) ?? "A former client"}
                      <span className="font-normal text-pulse-text-dim"> · {who.get(c.user_id) ?? "someone"}</span>
                    </p>
                    <p className="text-xs text-pulse-text-mute">
                      {when(c.started_at)}
                      {c.handed_off && <span className="ml-2 font-semibold text-pulse-gold">Passed to you</span>}
                    </p>
                  </div>
                  <ul className="space-y-2">
                    {(byConv.get(c.id) ?? []).map((m, i) => (
                      <li
                        key={i}
                        className={cn(
                          "rounded-[12px] px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap",
                          m.role === "user" ? "bg-pulse-surface-2 text-pulse-text" : "border-l-2 border-pulse-border text-pulse-text-dim",
                          m.handed_off && "border-pulse-gold",
                        )}
                      >
                        {m.content}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
