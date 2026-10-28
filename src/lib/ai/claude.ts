import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * The one place the portal talks to Claude. Opus 5.5 throughout: Kyle asked
 * for it by name, and at $4 / $20 per million tokens a client question costs
 * a cent or two.
 *
 * Every request opts into server-side refusal fallback (`fallbacks:
 * "default"`): if Opus 5.5's safety classifiers decline a request, the API
 * re-runs it on Anthropic's recommended fallback model instead of returning
 * nothing. That is Anthropic's guidance for this model from day one, and in a
 * client-facing chat a silent non-answer is the worst outcome.
 *
 * Returns null without ANTHROPIC_API_KEY, so every caller has a plain "not set
 * up yet" path instead of an exception.
 */

export const MODEL = "claude-opus-5-5";
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
    model: MODEL,
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
