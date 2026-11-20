/**
 * Gmail for Draper (Stage 5, decision 5): Google's OAuth for kyle@ as an
 * Internal app, and sending through the Gmail API. Never Resend.
 *
 * Scopes: gmail.send to send, gmail.readonly to read the threads Draper
 * started (replies, Stage 6) and to check whether a send that errored went
 * after all. The building of a message is pure and tested in schedule.test.ts;
 * the rest is plain fetch. Reading the stored token is gmail-access.ts.
 */
import { randomUUID } from "node:crypto";

export const SENDER_EMAIL = "kyle@hartwelldigital.com";
export const SENDER_NAME = "Kyle Hartwell";
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export function oauthClient(env = process.env): { clientId: string; clientSecret: string } | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Where Kyle is sent to approve Draper's access to kyle@. */
export function authUrl(o: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    // Always ask, so Google always returns a refresh token.
    prompt: "consent",
    login_hint: SENDER_EMAIL,
    include_granted_scopes: "false",
    state: o.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Google refused: ${String(j.error_description ?? j.error ?? res.status)}`);
  return j;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<{ refreshToken: string; accessToken: string; scope: string }> {
  const c = oauthClient();
  if (!c) throw new Error("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET aren't set");
  const j = await postForm(TOKEN_URL, {
    code,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (typeof j.refresh_token !== "string") throw new Error("Google gave no refresh token. Disconnect Pulse in your Google account and connect again.");
  return { refreshToken: j.refresh_token, accessToken: String(j.access_token), scope: String(j.scope ?? "") };
}

export async function refreshAccess(refreshToken: string): Promise<string> {
  const c = oauthClient();
  if (!c) throw new Error("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET aren't set");
  const j = await postForm(TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: "refresh_token",
  });
  return String(j.access_token);
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

async function api<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Gmail refused: ${j.error?.message ?? res.status}`);
  return j;
}

export async function profileEmail(accessToken: string): Promise<string> {
  const j = await api<{ emailAddress?: string }>(accessToken, "/profile");
  return (j.emailAddress ?? "").toLowerCase();
}

/** Send a built message. Pass the first email's thread id to keep a follow-up in its thread. */
export async function sendRaw(accessToken: string, raw: string, threadId?: string | null): Promise<{ id: string; threadId: string }> {
  return api(accessToken, "/messages/send", {
    method: "POST",
    body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
  });
}

/** Whether a message with this Message-ID is already in the mailbox: a send that errored but went. */
export async function findByMessageId(accessToken: string, rfcMessageId: string): Promise<{ id: string; threadId: string } | null> {
  const q = encodeURIComponent(`rfc822msgid:${rfcMessageId.replace(/^<|>$/g, "")}`);
  const j = await api<{ messages?: { id: string; threadId: string }[] }>(accessToken, `/messages?q=${q}&includeSpamTrash=true&maxResults=1`);
  return j.messages?.[0] ?? null;
}

// ---------- building a message (pure) ----------

/** A Message-ID on our own domain. */
export function newMessageId(): string {
  return `<${randomUUID()}@hartwelldigital.com>`;
}

/** A header value, RFC 2047 encoded only when it has characters beyond ASCII. */
export function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

/** An address header: a display name and an address, never anything else. */
function address(name: string | null, email: string): string {
  const e = email.replace(/[\r\n<>,;"]/g, "").trim();
  if (!name) return e;
  const n = encodeHeader(name);
  return /^[A-Za-z0-9 .'-]+$/.test(n) ? `"${n}" <${e}>` : `${n} <${e}>`;
}

export interface Outgoing {
  to: string;
  subject: string;
  body: string;
  messageId: string;
  /** The first email's Message-ID, for a follow-up. */
  inReplyTo?: string | null;
  date?: Date;
  /** Fixed only in tests; random otherwise. */
  boundary?: string;
}

const hexByte = (b: number) => `=${b.toString(16).toUpperCase().padStart(2, "0")}`;

/**
 * Quoted-printable (RFC 2045). A long line is cut with soft breaks ("=" at
 * the end), which every mail app removes when it shows the email. No encoded
 * line runs over 76 characters, an =XX is never split, and trailing spaces
 * are encoded. On its own this did NOT stop Gmail's API re-wrapping a
 * text/plain body (second test pair, 20 Nov 2026); the HTML part does that.
 */
export function quotedPrintable(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const bytes = Buffer.from(line, "utf8");
      const out: string[] = [];
      let cur = "";
      bytes.forEach((b, i) => {
        const space = b === 0x20 || b === 0x09;
        const plain = (b >= 33 && b <= 126 && b !== 61) || (space && i < bytes.length - 1);
        const t = plain ? String.fromCharCode(b) : hexByte(b);
        if (cur.length + t.length > 75) {
          out.push(`${cur}=`);
          cur = "";
        }
        cur += t;
      });
      out.push(cur);
      return out.join("\r\n");
    })
    .join("\r\n");
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The same words as bare HTML, the way Gmail's own composer writes a typed
 * email: a div a line, an empty line as <div><br></div>. No links, images,
 * styles, fonts or tracking. It exists only so paragraphs reflow to the
 * screen: Gmail's API re-wraps any text/plain body near 70 to 78 characters
 * whatever encoding it's sent in (tried 8bit, then quoted-printable, 20 Nov
 * 2026), and a phone then wraps those lines again. Kyle chose this over
 * plain text only, 20 Nov 2026.
 */
export function bodyHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return `<div dir="ltr">\n${lines.map((l) => (l.trim() ? `<div>${escapeHtml(l)}</div>` : "<div><br></div>")).join("\n")}\n</div>`;
}

/**
 * An email as Gmail's API wants it: RFC 5322, CRLF line ends, UTF-8,
 * base64url. multipart/alternative: the words as plain text, then the same
 * words as bare HTML (see bodyHtml), both quoted-printable. No links, no
 * attachments, no tracking: just the words.
 */
export function buildMessage(m: Outgoing): string {
  const boundary = m.boundary ?? `=_${randomUUID().replace(/-/g, "")}`;
  const headers = [
    `From: ${address(SENDER_NAME, SENDER_EMAIL)}`,
    `To: ${address(null, m.to)}`,
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${(m.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${m.messageId}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`, `References: ${m.inReplyTo}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type: string, content: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: quoted-printable", "", quotedPrintable(content)].join("\r\n");
  const body = [part("text/plain", m.body), part("text/html", bodyHtml(m.body)), `--${boundary}--`].join("\r\n");
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}\r\n`, "utf8").toString("base64url");
}
