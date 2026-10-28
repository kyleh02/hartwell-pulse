import "server-only";
import { escapeHtml } from "@/lib/email";
import { HARTWELL } from "@/lib/brand";
import { NEXT_STEPS } from "@/lib/onboarding-shared";

/**
 * The emails a won client receives: the welcome, and two check-ins after it.
 *
 * Written in Kyle's voice, first person, short. Each one has one button and
 * says plainly what it is for. HTML is built by hand with inline styles and a
 * JPG avatar, because email clients ignore stylesheets and Outlook does not
 * show WebP.
 */

function shell(
  origin: string,
  inner: string,
  cta?: { label: string; href: string },
  footnote?: string,
): string {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${cta.href}" style="background:#B5A675;color:#0e0d0b;padding:13px 24px;border-radius:2px;text-decoration:none;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;font-size:13px">${escapeHtml(cta.label)}</a></p>`
    : "";
  return `<div style="max-width:560px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1a1714">
  <p style="font-size:13px;font-weight:700;letter-spacing:2px;color:#0e0d0b;margin:0 0 24px">HARTWELL <span style="color:#8a7645">DIGITAL</span></p>
  ${inner}
  ${button}
  ${footnote ?? ""}
  <table role="presentation" style="margin-top:28px;border-top:1px solid #e8e2d4;padding-top:18px"><tr>
    <td style="padding-right:12px"><img src="${origin}/images/kyle-avatar.jpg" width="48" height="48" alt="" style="border-radius:24px;display:block"></td>
    <td style="font-size:14px;color:#444;line-height:1.5"><strong style="color:#1a1714">${escapeHtml(HARTWELL.personFirst)}</strong><br>${escapeHtml(HARTWELL.name)} &middot; ${escapeHtml(HARTWELL.email)}</td>
  </tr></table>
</div>`;
}

const p = (t: string) => `<p style="font-size:15px;line-height:1.65;color:#444;margin:0 0 14px">${t}</p>`;

export function welcomeEmail(opts: {
  origin: string;
  first: string;
  business: string;
  link: string | null;
}): { subject: string; html: string } {
  const steps = NEXT_STEPS.map(
    (s, i) =>
      `<tr><td style="vertical-align:top;padding:0 12px 12px 0;font-weight:800;color:#8a7645;font-size:15px">${String(i + 1).padStart(2, "0")}</td><td style="padding:0 0 12px;font-size:14px;line-height:1.55;color:#444"><strong style="color:#1a1714">${escapeHtml(s.title)}</strong><br>${escapeHtml(s.detail)}</td></tr>`,
  ).join("");
  const inner = `
  <h1 style="font-size:24px;font-weight:800;letter-spacing:-0.3px;text-transform:uppercase;margin:0 0 16px;color:#0e0d0b">Welcome aboard, <span style="color:#8a7645">${escapeHtml(opts.first)}</span></h1>
  ${p(`I'm really glad ${escapeHtml(opts.business)} is working with Hartwell Digital. Everything we do together lives in your portal: your files, the work I send for your OK, your reports and invoices, and a direct line to me.`)}
  ${p("Here's what happens from here:")}
  <table role="presentation" style="margin:4px 0 6px">${steps}</table>
  ${p(opts.link ? "The button below signs you straight in, no password needed. Your first stop is a short page about your business, which saves as you go." : "Sign in at portal.hartwelldigital.com with this email address. Your first stop is a short page about your business.")}`;
  const after = opts.link
    ? `<p style="font-size:12px;line-height:1.5;color:#888;margin:0">The button works once and lasts seven days. Once you're in, you can choose a password for next time. After that, sign in at portal.hartwelldigital.com with this email address.</p>`
    : "";
  return {
    subject: `Welcome to Hartwell Digital, ${opts.first}`,
    html: shell(
      opts.origin,
      inner,
      { label: "Open your portal", href: opts.link ?? `${opts.origin}/welcome` },
      after,
    ),
  };
}

/** Three days in: a nudge if onboarding is unfinished, a thank you if it is done. */
export function dayThreeEmail(opts: { origin: string; first: string; onboardingDone: boolean }): {
  subject: string;
  html: string;
} {
  if (opts.onboardingDone) {
    return {
      subject: "Thanks, I've got everything I need to start",
      html: shell(
        opts.origin,
        `${p(`Hi ${escapeHtml(opts.first)},`)}${p("Thanks for filling in your onboarding. I've read through it, and the first pieces of work will land in your portal for your OK as they're ready. You'll get an email each time.")}${p("If anything comes to mind in the meantime, the chat in your portal comes straight to me.")}`,
        { label: "Open your portal", href: `${opts.origin}/dashboard` },
      ),
    };
  }
  return {
    subject: "A few quick questions before we start",
    html: shell(
      opts.origin,
      `${p(`Hi ${escapeHtml(opts.first)},`)}${p("Before I get going I need a little from you: what you do, who your best customers are, and what a good six months looks like. It takes about ten minutes and saves as you go, so you can do it in two goes.")}${p("If it's easier to talk it through, reply to this email and we'll do it on a call.")}`,
      { label: "Answer the questions", href: `${opts.origin}/welcome` },
    ),
  };
}

/** A week in: a plain check-in. */
export function daySevenEmail(opts: { origin: string; first: string }): { subject: string; html: string } {
  return {
    subject: "How's your first week going?",
    html: shell(
      opts.origin,
      `${p(`Hi ${escapeHtml(opts.first)},`)}${p("A week in, so a quick check: is the portal making sense, and is there anything you're waiting on from me?")}${p("Anything at all, just reply to this email or message me from the portal. That's what it's there for.")}`,
      { label: "Open your portal", href: `${opts.origin}/dashboard` },
    ),
  };
}
