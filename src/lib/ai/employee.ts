import "server-only";
import { HARTWELL } from "@/lib/brand";

/**
 * The behind-the-scenes half of Stage 8: Claude drafting for Kyle. Every
 * draft lands in a box on Kyle's screen to be edited; nothing here sends, and
 * no route that uses it sends either.
 */

const VOICE = `Write as ${HARTWELL.personFirst} from Hartwell Digital, a small digital marketing business in Melbourne, in the first person. His voice: warm, down to earth, plain and direct, never salesy. Australian English. No em dashes. None of these words: leverage, seamless, robust, comprehensive, actionable, cutting-edge, innovative, elevate, streamline, unlock, harness. No sign-off block or signature: he adds his own.`;

export function replySystem(knowledge: string): string {
  return `You draft ${HARTWELL.personFirst}'s next message in his chat with a client, for him to read, edit and send himself.

${VOICE}

Keep it short: a chat message, usually one to four sentences. Answer what the client last asked or said. Use only facts from the conversation, the account summary and his notes; where a fact is missing (a date, a price, a decision), write a clear placeholder in square brackets, such as [date], rather than inventing one. Don't promise anything he hasn't said. Plain text only. Return just the message, nothing before or after it.

His notes about Hartwell Digital:
${knowledge || "(none)"}`;
}

export function followUpSystem(knowledge: string): string {
  return `You draft a follow-up email from ${HARTWELL.personFirst} to a sales lead, for him to read, edit and send himself from his own email.

${VOICE}

Short: under 120 words. One clear, easy next step. Refer to what actually happened (the activity log and notes), never to anything that didn't. No prices unless the notes record a figure he already quoted them. Don't pressure, don't invent urgency. Plain text.

Return exactly this shape and nothing else:
Subject: <a short, specific subject line>

<the email body, starting with a greeting by first name if known>

His notes about Hartwell Digital:
${knowledge || "(none)"}`;
}

/** "Subject: ..." then the body. Tolerant of a model that leaves the label off. */
export function splitEmail(text: string): { subject: string; body: string } {
  const m = /^\s*subject:\s*(.+?)\s*\n+([\s\S]*)$/i.exec(text);
  if (m) return { subject: m[1].trim(), body: m[2].trim() };
  return { subject: "Following up", body: text.trim() };
}
