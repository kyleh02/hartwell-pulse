import "server-only";
import { Resend } from "resend";

const FROM =
  process.env.EMAIL_FROM ||
  "Hartwell Digital <noreply@hartwelldigital.com>";

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c,
  );
}

/**
 * What this email was about, so a delivery result can be shown next to the
 * thing it belongs to rather than in a log nobody reads.
 */
export interface EmailRef {
  kind: "invoice" | "report" | "message" | "other";
  id?: string | null;
}

/** Send an email via Resend. No-ops (logs) when RESEND_API_KEY isn't set yet. */
export async function sendEmail({
  to,
  subject,
  html,
  ref,
}: {
  to: string;
  subject: string;
  html: string;
  ref?: EmailRef;
}): Promise<{ ok?: boolean; skipped?: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[email] RESEND_API_KEY not set, skipping email to ${to}: ${subject}`);
    return { skipped: true };
  }
  try {
    const resend = new Resend(key);
    const { data, error } = await resend.emails.send({ from: FROM, to, subject, html });
    if (error) {
      console.error("[email] send failed:", error);
      await recordEmail({ to, subject, ref, status: "failed", detail: String(error) });
      return { error: String(error) };
    }
    await recordEmail({
      to,
      subject,
      ref,
      status: "sent",
      providerId: (data as { id?: string } | null)?.id ?? null,
    });
    return { ok: true };
  } catch (e) {
    console.error("[email] exception:", e);
    await recordEmail({
      to,
      subject,
      ref,
      status: "failed",
      detail: e instanceof Error ? e.message : "send failed",
    });
    return { error: e instanceof Error ? e.message : "send failed" };
  }
}

/**
 * The opening row for a message, which the Resend webhook later moves along to
 * delivered, bounced or complained.
 *
 * Never allowed to break a send. Telemetry that can stop an invoice reaching a
 * client is worse than no telemetry, so every failure here is swallowed after
 * a log line.
 */
async function recordEmail(args: {
  to: string;
  subject: string;
  ref?: EmailRef;
  status: "sent" | "failed";
  providerId?: string | null;
  detail?: string;
}): Promise<void> {
  try {
    const { createAdminSupabase } = await import("@/lib/supabase/admin");
    await createAdminSupabase()
      .from("email_events")
      .insert({
        provider_id: args.providerId ?? null,
        recipient: args.to,
        subject: args.subject,
        ref_kind: args.ref?.kind ?? "other",
        ref_id: args.ref?.id ?? null,
        status: args.status,
        detail: args.detail ?? null,
      });
  } catch (e) {
    console.error("[email] could not record the send:", e);
  }
}

/** A simple, on-brand email shell in Kyle's plain voice. */
export function emailLayout(
  title: string,
  bodyHtml: string,
  ctaLabel?: string,
  ctaPath?: string,
): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const cta =
    ctaLabel && ctaPath
      ? `<p style="margin:24px 0"><a href="${appUrl}${ctaPath}" style="background:#B5A675;color:#0a0908;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${ctaLabel}</a></p>`
      : "";
  return `<div style="max-width:520px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1a1714">
    <p style="font-size:12px;letter-spacing:2px;color:#8a8270;margin:0 0 4px">HARTWELL PULSE</p>
    <h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
    <div style="font-size:15px;line-height:1.6;color:#444">${bodyHtml}</div>
    ${cta}
    <p style="font-size:12px;color:#999;margin-top:28px">Hartwell Digital</p>
  </div>`;
}

/**
 * Turn a plain-text message (with {placeholders}) into safe HTML paragraphs.
 * The template and every value are HTML-escaped, so a client name with an "&"
 * or a stray "<" can never break the email or inject markup.
 */
export function renderMessage(
  template: string,
  vars: Record<string, string>,
): string {
  let s = escapeHtml(template);
  for (const [k, v] of Object.entries(vars)) {
    s = s.split(`{${k}}`).join(escapeHtml(v));
  }
  return s
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}
