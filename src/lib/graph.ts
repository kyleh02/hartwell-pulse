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
 * Send one plain-text email and save it to Sent Items.
 *
 * Plain text, not HTML, and that is the whole point. A cold 1:1 email that
 * arrives as a styled HTML document reads as marketing no matter how good the
 * words are. This is the same shape as something typed in Outlook, because
 * that is what it is meant to be.
 */
export async function graphSendMail(args: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<void> {
  if (!graphConfigured()) {
    throw new Error(
      "Outlook sending is not configured. Set MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET and IRONPEAK_SEND_FROM.",
    );
  }
  const from = process.env.IRONPEAK_SEND_FROM!;
  const token = await accessToken();

  const res = await fetch(
    `${GRAPH}/users/${encodeURIComponent(from)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: args.subject,
          body: { contentType: "Text", content: args.text },
          toRecipients: [{ emailAddress: { address: args.to } }],
          ...(args.replyTo
            ? { replyTo: [{ emailAddress: { address: args.replyTo } }] }
            : {}),
        },
        // It has to be in Sent Items. Kyle needs to see what went out from his
        // own mailbox, and a reply threads against the original.
        saveToSentItems: true,
      }),
    },
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Graph sendMail ${res.status}: ${detail.slice(0, 400)}`);
  }
}
