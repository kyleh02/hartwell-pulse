/**
 * Replies (Stage 6), the pure part, tested in replies-rules.test.ts: reading
 * a Gmail message, cutting their words from the quoted original, sorting a
 * message into bounce, out-of-office, opt-out or reply, and the auto-pause
 * rules from Kyle's brief. replies.ts does the reading and the writing.
 *
 * When in doubt the rules lean towards honouring an opt-out: a false "no"
 * costs one prospect; a missed one is an email to someone who said stop.
 */

// ---------- Gmail's message shape (format=full) ----------

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
}

export interface Incoming {
  id: string;
  threadId: string;
  receivedAt: string;
  from: string;
  fromEmail: string;
  subject: string;
  /** Lower-case header names, the first value of each. */
  headers: Record<string, string>;
  /** What they wrote: the text/plain part, or the HTML part as text. */
  text: string;
  /** Every readable part, for a bounce's delivery report and original headers. */
  allText: string;
  /** Message-IDs from In-Reply-To, References and anywhere in the text. */
  messageIds: string[];
}

function decode(data: string | undefined, contentType: string): string {
  if (!data) return "";
  const bytes = Buffer.from(data, "base64url");
  const charset = /charset="?([^";\s]+)"?/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

function header(part: GmailPart | undefined, name: string): string {
  return part?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
}

function walk(part: GmailPart | undefined, out: GmailPart[] = []): GmailPart[] {
  if (!part) return out;
  out.push(part);
  for (const p of part.parts ?? []) walk(p, out);
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** HTML as text, with the quoted original (Gmail's and Outlook's) cut off. */
export function htmlToText(html: string): string {
  const cut = html.search(/<div[^>]*class="?[^">]*gmail_quote|<div[^>]*id="?(divRplyFwdMsg|appendonsend)|<blockquote/i);
  return (cut >= 0 ? html.slice(0, cut) : html)
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+|#39);/gi, (whole, e: string) => {
      if (e[0] === "#") {
        const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
      }
      return ENTITIES[e.toLowerCase()] ?? whole;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function bareEmail(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim().toLowerCase();
}

/** A Gmail message, read. */
export function parseMessage(msg: GmailMessage): Incoming {
  const parts = walk(msg.payload);
  const headers: Record<string, string> = {};
  for (const h of msg.payload?.headers ?? []) {
    const k = h.name.toLowerCase();
    if (!(k in headers)) headers[k] = h.value;
  }
  const typeOf = (p: GmailPart) => (p.mimeType ?? "").toLowerCase();
  const ctOf = (p: GmailPart) => header(p, "content-type") || typeOf(p);
  const plain = parts.find((p) => typeOf(p) === "text/plain" && !p.filename && p.body?.data);
  const html = parts.find((p) => typeOf(p) === "text/html" && !p.filename && p.body?.data);
  const text = plain ? decode(plain.body?.data, ctOf(plain)) : html ? htmlToText(decode(html.body?.data, ctOf(html))) : (msg.snippet ?? "");
  const allText = parts
    .filter((p) => p.body?.data && !p.filename)
    .map((p) => decode(p.body?.data, ctOf(p)))
    .join("\n");
  const ids = `${headers["in-reply-to"] ?? ""} ${headers["references"] ?? ""} ${allText}`.match(/<[^<>\s@]+@[^<>\s]+>/g) ?? [];
  return {
    id: msg.id,
    threadId: msg.threadId,
    receivedAt: new Date(Number(msg.internalDate ?? Date.now())).toISOString(),
    from: headers["from"] ?? "",
    fromEmail: bareEmail(headers["from"] ?? ""),
    subject: headers["subject"] ?? "",
    headers,
    text: text.replace(/\r\n?/g, "\n"),
    allText,
    messageIds: [...new Set(ids)],
  };
}

// ---------- their words ----------

const QUOTE_STARTS = [
  /(^|\n)[ \t>]*On [^\n]{0,300}?(\n[^\n]{0,300}?)?wrote:[ \t]*(\n|$)/i,
  /(^|\n)[ \t]*-{2,}\s*Original Message\s*-{2,}/i,
  /(^|\n)[ \t]*_{8,}[ \t]*(\n|$)/,
  /(^|\n)[ \t]*\*?From:\*?[^\n]*\n(?:[^\n]*\n){0,3}?[ \t]*\*?(Sent|Date|To|Subject):/i,
  /(^|\n)[ \t]*Sent from my [^\n]*/i,
  /(^|\n)[ \t]*Get Outlook for (iOS|Android)/i,
];

/** What they wrote above the quoted original, with quoted lines dropped. */
export function theirWords(text: string): string {
  let t = text.replace(/\r\n?/g, "\n");
  let cut = t.length;
  for (const re of QUOTE_STARTS) {
    const m = re.exec(t);
    if (m && m.index < cut) cut = m.index;
  }
  t = t.slice(0, cut);
  return t
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Their words with any of our own lines taken out, wherever they were wrapped. */
export function withoutOurLines(text: string, ourLines: string[]): string {
  let t = text;
  for (const line of ourLines) {
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (words.join(" ").length < 12) continue;
    t = t.replace(new RegExp(words.map(escapeRe).join("\\s+"), "gi"), " ");
  }
  return t;
}

// ---------- what kind of message it is ----------

export type ReplyKind = "bounce" | "delay" | "auto_reply" | "opt_out" | "reply";

/** Words that mean stop. Matched on their own words only, never on what they quoted. */
export const OPT_OUT_WORDS =
  /\b(no thanks|no thank you|no thankyou|no thx|not interested|unsubscribe|opt(-| )?out|remove|take (me|us|this address|my email|our email|my address|our address) off|(?<!-)stop(?!-)|don'?t (email|e-mail|contact|send|write|bother|message)|do not (email|e-mail|contact|send|write|message)|no more (emails?|e-mails?|contact|messages)|leave (me|us) alone|never (email|contact|write)|spam|cease)\b/i;
const BARE_NO = /^\s*(no|nope|nah|no\.?\s*thanks?)\s*[.!]*\s*$/i;

/** A signature's legal footer ("if you are not the intended recipient, please remove..."), not their answer. */
const FOOTER =
  /intended recipient|received this (e-?mail|message|communication) in error|(this|the) (e-?mail|message|communication)[^.\n]{0,80}\b(confidential|privileged)|before printing|scanned for viruses|virus[- ]free/i;

/**
 * Their words up to a legal footer. Footers sit at the bottom, so everything
 * from the first footer line down goes; their answer above it stays, blank
 * line or not.
 */
export function withoutFooters(text: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => FOOTER.test(l));
  return at < 0 ? text : lines.slice(0, at).join("\n");
}

const AUTO_SUBJECT = /^\s*(auto(matic)?[ -]?(reply|response)|autoreply|auto:|out of (the )?office|ooo\b|away\b|on leave|on holiday|annual leave)/i;
const BOUNCE_SUBJECT =
  /^\s*(delivery status notification|undeliverable|undelivered mail|mail delivery failed|returned mail|delivery has failed|mail delivery failure|failure notice|delivery failure|message not delivered|non[- ]?delivery)/i;

export interface Classified {
  kind: ReplyKind;
  /** Their words, as written, for the record and the page. */
  quote: string;
}

export function classify(m: Incoming, ourLines: string[] = []): Classified {
  const words = theirWords(m.text);
  const quote = (words || m.text.trim()).slice(0, 2000);

  const fromRobot = /^(mailer-daemon|postmaster|mail-daemon|mailerdaemon)@/i.test(m.fromEmail) || /mail delivery (subsystem|system)/i.test(m.from);
  const ct = m.headers["content-type"] ?? "";
  const report = /multipart\/report/i.test(ct) && /delivery-status/i.test(ct);
  if (fromRobot || report || BOUNCE_SUBJECT.test(m.subject)) {
    const failed = /action:\s*failed|status:\s*5\.\d/i.test(m.allText) || /\(failure\)/i.test(m.subject);
    const delayed = /\(delay\)/i.test(m.subject) || /action:\s*delayed|will retry|temporary problem/i.test(m.allText);
    return { kind: !failed && delayed ? "delay" : "bounce", quote: m.text.trim().slice(0, 500) };
  }

  const auto = (m.headers["auto-submitted"] ?? "").trim();
  const precedence = (m.headers["precedence"] ?? "").trim();
  if (
    (auto && !/^no$/i.test(auto)) ||
    "x-autoreply" in m.headers ||
    "x-autorespond" in m.headers ||
    /^(auto_reply|bulk|junk|list)$/i.test(precedence) ||
    AUTO_SUBJECT.test(m.subject)
  ) {
    return { kind: "auto_reply", quote };
  }

  const own = withoutFooters(withoutOurLines(words, ourLines));
  if (OPT_OUT_WORDS.test(own) || BARE_NO.test(own)) return { kind: "opt_out", quote };
  // No guessing an out-of-office from its words: "I'll be back next week to
  // look at it" is a person. Real ones carry the headers or the subject
  // above; one without them waits for a label, the safe way round.
  return { kind: "reply", quote };
}

// ---------- labels ----------

export const REPLY_LABELS = ["interested", "question", "later", "sorted", "no_thanks", "wrong_fact", "complaint", "other"] as const;
export type ReplyLabel = (typeof REPLY_LABELS)[number];

export const LABEL_TEXT: Record<ReplyLabel, string> = {
  interested: "Interested",
  question: "Question",
  later: "Later",
  sorted: "Sorted",
  no_thanks: "No thanks",
  wrong_fact: "Wrong fact",
  complaint: "Complaint",
  other: "Other",
};

export function isReplyLabel(s: string): s is ReplyLabel {
  return (REPLY_LABELS as readonly string[]).includes(s);
}

/** These become a lead, due today. */
export const MAKES_LEAD: ReadonlySet<ReplyLabel> = new Set(["interested", "question"]);
/** These also go on do-not-contact (a real send only), on top of being closed. */
export const DO_NOT_CONTACT: ReadonlySet<ReplyLabel> = new Set(["no_thanks", "complaint"]);

// ---------- auto-pause (the brief, section 5) ----------

export interface SentFirst {
  bounced: boolean;
  /** Opted out, or labelled no thanks. */
  noThanks: boolean;
  /** Labelled interested or question. */
  interested: boolean;
}

/** Two "wrong fact" labels switch that fault off until Kyle turns it back on. */
export const WRONG_FACTS_TO_SWITCH_OFF = 2;

/**
 * Why Draper should stop everything, or null. `firsts` are real first emails
 * (never test sends), newest first, counted from the last time Kyle resumed,
 * so a pause he has looked at and lifted doesn't fire again on the same
 * evidence. A complaint pauses at once, where it's labelled.
 *   - more than 1 in 20 "no thanks" over the last 40 first emails;
 *   - bounces over 5% of the last 40;
 *   - 100 first emails with nobody interested.
 * Over the last 40, "more than 1 in 20" and "over 5%" both mean three or
 * more; with fewer than 40 sent, three is still the line.
 */
export function autoPauseReason(firsts: SentFirst[]): string | null {
  const last40 = firsts.slice(0, 40);
  const bounces = last40.filter((f) => f.bounced).length;
  if (bounces > 2) return `${bounces} bounces in the last ${last40.length} first emails (the limit is 2 in 40)`;
  const no = last40.filter((f) => f.noThanks).length;
  if (no > 2) return `${no} "no thanks" replies in the last ${last40.length} first emails (the limit is 1 in 20)`;
  if (firsts.length >= 100 && !firsts.slice(0, 100).some((f) => f.interested)) return "100 first emails without one interested reply";
  return null;
}

/** Where Kyle reads a thread in kyle@'s Gmail. */
export function gmailThreadUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/kyle@hartwelldigital.com/#all/${encodeURIComponent(threadId)}`;
}
