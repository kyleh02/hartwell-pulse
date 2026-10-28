import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * The one place the portal talks to Claude. Two models, chosen by Kyle on 28
 * October 2026 to spend less than Opus 5.5 everywhere:
 *
 * - Clients' Quick answers run on Haiku 5.5 ($0.10 / $0.50 per million
 *   tokens, under a tenth of a cent a question). The job suits it: short
 *   answers from facts the portal hands over, anything hard passed to Kyle.
 *   Haiku 5.5 has NO server-side refusal fallback, so its requests must not
 *   send `fallbacks` (a list of models is a 400); a decline is handled by the
 *   caller with a "message Kyle" reply.
 * - Kyle's drafts run on Sonnet 5.5 ($2 / $10): few a day, written in his
 *   voice, where the writing matters. These opt into server-side fallback
 *   (`fallbacks: "default"`), Anthropic's guidance for the model, so a decline
 *   is re-run rather than coming back empty.
 *
 * Both think adaptively; effort is the only lever. Never send
 * `thinking: {type: "disabled"}` to Sonnet 5.5 (a 400) or force `tool_choice`
 * (a 400 on Sonnet 5.5).
 *
 * Returns null without ANTHROPIC_API_KEY, so every caller has a plain "not set
 * up yet" path instead of an exception.
 */

export const ASSISTANT_MODEL = "claude-haiku-5-5";
export const DRAFT_MODEL = "claude-sonnet-5-5";
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client: Anthropic | null = null;

export function claude(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic();
  return client;
}

export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** The text of a finished message, ignoring thinking and tool blocks. */
export function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * A short piece of writing for Kyle to edit: a reply, a follow-up email.
 * Not streamed (it is a paragraph or two, shown when done), low effort, and
 * with the same refusal fallback as everything else. Never sent anywhere by
 * the caller: the text goes back to Kyle's screen.
 */
export async function draft(opts: { system: string; prompt: string; maxTokens?: number }): Promise<string | null> {
  const api = claude();
  if (!api) return null;
  const res = await api.beta.messages.create({
    model: DRAFT_MODEL,
    max_tokens: opts.maxTokens ?? 2000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
  });
  if (res.stop_reason === "refusal") return null;
  return textOf(res.content) || null;
}
