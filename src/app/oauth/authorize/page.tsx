import { redirect } from "next/navigation";
import { Check, X } from "lucide-react";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { checkAuthorize, readAuthorizeParams } from "@/lib/mcp/oauth";
import { requestOrigin } from "@/lib/mcp/http";
import { Wordmark } from "@/components/brand/Wordmark";
import { ConnectorConsent } from "@/components/admin/ConnectorConsent";

export const metadata = { title: "Connect Claude" };
export const dynamic = "force-dynamic";

/**
 * Where Claude sends Kyle to approve the connector. Not public in middleware,
 * so a signed-out visit goes through sign-in first and comes back here. Only
 * an admin is asked; anyone else is told no, and nothing is sent back.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const params = readAuthorizeParams((k) => (typeof sp[k] === "string" ? (sp[k] as string) : null));
  const session = await getPulseSession();

  let body: React.ReactNode;
  if (session?.role !== "admin") {
    body = <Notice title="Not this account" text="Only Kyle's admin account can connect Claude to the pipeline." />;
  } else {
    const check = await checkAuthorize(createAdminSupabase(), params, await requestOrigin());
    if (check.kind === "redirect") redirect(check.url);
    if (check.kind === "show") {
      body = <Notice title="Connection stopped" text={check.message} />;
    } else {
      const to = new URL(params.redirect_uri).host;
      body = (
        <>
          <h1 className="text-[26px] leading-[1.05] font-extrabold tracking-[-0.01em] text-pulse-text uppercase">
            Connect <span className="text-pulse-gold">Claude</span>
          </h1>
          <div className="gold-rule mt-4 mb-5" aria-hidden="true" />
          <p className="text-[15px] leading-relaxed text-pulse-text-dim">
            <strong className="text-pulse-text">{check.client.name}</strong> is asking to work with your sales pipeline. After you allow
            it, your answer goes back to <strong className="text-pulse-text">{to}</strong>.
          </p>
          <ul className="mt-5 space-y-2 text-sm">
            {["Read your leads, notes and follow-ups", "Add leads and update their details", "Move leads along and log calls, emails and meetings"].map((t) => (
              <li key={t} className="flex gap-2 text-pulse-text">
                <Check size={16} className="mt-0.5 shrink-0 text-pulse-gold" aria-hidden="true" /> {t}
              </li>
            ))}
            {["Mark a lead won, delete one, or email anyone", "See clients, invoices, reports or messages"].map((t) => (
              <li key={t} className="flex gap-2 text-pulse-text-dim">
                <X size={16} className="mt-0.5 shrink-0 text-pulse-text-mute" aria-hidden="true" /> Can&apos;t {t.charAt(0).toLowerCase() + t.slice(1)}
              </li>
            ))}
          </ul>
          <p className="mt-5 mb-6 text-xs leading-relaxed text-pulse-text-mute">
            You can disconnect it any time from Settings in the portal.
          </p>
          <ConnectorConsent params={params} />
        </>
      );
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-pulse-bg px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Wordmark size="lg" />
        </div>
        <div className="rounded-[20px] border border-pulse-border bg-pulse-surface p-6 sm:p-8">{body}</div>
      </div>
    </main>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <>
      <h1 className="text-xl font-extrabold text-pulse-text uppercase">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-pulse-text-dim">{text}</p>
    </>
  );
}
