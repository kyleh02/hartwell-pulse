import "server-only";

/**
 * Microsoft Graph, used for one thing: sending Ironpeak outreach as an
 * ordinary email from Kyle's own mailbox.
 *
 * Not Resend, deliberately. Resend sends as hartwelldigital.com, the domain
 * carrying every invoice and client notification, and cold outreach on that
 * domain would put the reputation of the mail that pays the bills at risk. It
 * would also arrive with ESP headers and a tracking pixel, which is exactly
 * what a hand-written 1:1 email must not look like.
 *
 * Client credentials, not delegated. There is no user at the keyboard when a
 * scheduled send fires at 8:47am, so there is nobody to refresh a token. The
 * app authenticates as itself with an application permission.
 *
 * IMPORTANT when setting this up: application Mail.Send grants access to EVERY
 * mailbox in the tenant. Scope it to the one mailbox with an Exchange
 * ApplicationAccessPolicy, or this app can send as anyone in the business.
 */

const TOKEN_HOST = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";

export function graphConfigured(): boolean {
  return Boolean(
    process.env.MS_GRAPH_TENANT_ID &&
      process.env.MS_GRAPH_CLIENT_ID &&
      process.env.MS_GRAPH_CLIENT_SECRET &&
      process.env.IRONPEAK_SEND_FROM,
  );
}

/**
 * Cached in module scope, which on a serverless function means "for the life
 * of this warm instance". Tokens last an hour; re-fetching one per send would
 * be a wasted round trip, and holding it any longer than the process lives
 * would need somewhere to put it that is worse than just asking again.
 */
let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const tenant = process.env.MS_GRAPH_TENANT_ID!;
  const body = new URLSearchParams({
    client_id: process.env.MS_GRAPH_CLIENT_ID!,
    client_secret: process.env.MS_GRAPH_CLIENT_SECRET!,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(`${TOKEN_HOST}/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Graph token failed: ${json.error_description ?? res.statusText}`,
    );
  }
  cached = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

/**
 * There is no send function here any more, and that is deliberate.
 *
 * `graphSendMail` put four messages into the high-risk delivery pool and none
 * arrived. Version 4 of the handoff then found the likelier cause: the tenant
 * itself is blocked for outbound reputation, so programmatic submission was
 * throttled first and the whole tenant escalated a week later. Sending from
 * here is not a thing to restore until that is resolved and the sending
 * arrangement has changed.
 */

/**
 * Put a finished draft in the mailbox rather than sending it.
 *
 * This is the whole point of the change. Sending through Graph put four
 * messages into the high-risk delivery pool and none of them arrived; the same
 * words typed in Outlook go out fine. A draft leaves the sending to Outlook,
 * on the interactive path that works, and keeps everything else the portal
 * does for it.
 *
 * Returns the id and the deep link, so the portal can hand Kyle straight to
 * the draft rather than telling him to go and find it.
 */
export async function graphCreateDraft(args: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ id: string; webLink: string }> {
  if (!graphConfigured()) {
    throw new Error(
      "Outlook is not configured. Set MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET and IRONPEAK_SEND_FROM.",
    );
  }
  const from = process.env.IRONPEAK_SEND_FROM!;
  const token = await accessToken();

  const res = await fetch(`${GRAPH}/users/${encodeURIComponent(from)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      subject: args.subject,
      // Plain text, same as before. A cold 1:1 email that arrives as a styled
      // HTML document reads as marketing however good the words are.
      body: { contentType: "Text", content: args.text },
      toRecipients: [{ emailAddress: { address: args.to } }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Graph createDraft ${res.status}: ${detail.slice(0, 400)}`);
  }
  const json = (await res.json()) as { id?: string; webLink?: string };
  if (!json.id) throw new Error("Graph created no draft id");
  return { id: json.id, webLink: json.webLink ?? "" };
}
