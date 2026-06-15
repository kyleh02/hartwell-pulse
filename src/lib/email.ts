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

/** Send an email via Resend. No-ops (logs) when RESEND_API_KEY isn't set yet. */
export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok?: boolean; skipped?: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[email] RESEND_API_KEY not set — skipping email to ${to}: ${subject}`);
    return { skipped: true };
  }
  try {
    const resend = new Resend(key);
    const { error } = await resend.emails.send({ from: FROM, to, subject, html });
    if (error) {
      console.error("[email] send failed:", error);
      return { error: String(error) };
    }
    return { ok: true };
  } catch (e) {
    console.error("[email] exception:", e);
    return { error: e instanceof Error ? e.message : "send failed" };
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
