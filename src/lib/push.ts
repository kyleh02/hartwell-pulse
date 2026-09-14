import "server-only";
import webpush from "web-push";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  normaliseVapidKey,
  VAPID_PRIVATE_BYTES,
  VAPID_PUBLIC_BYTES,
} from "@/lib/vapid";

/**
 * Web push delivery. Subscriptions are send-credentials, so every read and
 * write here uses the service role and never leaves the server.
 */

let configured = false;
let reported = false;

/** The VAPID keys, cleaned into the form web-push accepts. See lib/vapid.ts. */
function vapidKeys() {
  return {
    pub: normaliseVapidKey(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      VAPID_PUBLIC_BYTES,
    ),
    priv: normaliseVapidKey(process.env.VAPID_PRIVATE_KEY, VAPID_PRIVATE_BYTES),
  };
}

/** Are usable VAPID keys on the server? Exposed so callers can tell
 *  "nobody has subscribed" apart from "push isn't switched on yet". A key that
 *  is present but unusable counts as not configured, so the test button says
 *  so rather than reporting that nothing was delivered. */
export function pushConfigured(): boolean {
  const { pub, priv } = vapidKeys();
  return !!(pub.key && priv.key);
}

function ready(): boolean {
  if (configured) return true;
  const { pub, priv } = vapidKeys();

  // Say once per server instance what was wrong with the stored keys. They are
  // write-only in Vercel, so this log line is the only place anyone can read it.
  if (!reported) {
    reported = true;
    if (pub.changes.length > 0)
      console.warn(`[push] VAPID public key cleaned: ${pub.changes.join(", ")}`);
    if (priv.changes.length > 0)
      console.warn(`[push] VAPID private key cleaned: ${priv.changes.join(", ")}`);
    if (pub.problem) console.error(`[push] VAPID public key unusable: ${pub.problem}`);
    if (priv.problem) console.error(`[push] VAPID private key unusable: ${priv.problem}`);
  }
  if (!pub.key || !priv.key) return false;

  try {
    webpush.setVapidDetails(
      (process.env.VAPID_SUBJECT || "mailto:admin@hartwelldigital.com").trim(),
      pub.key,
      priv.key,
    );
  } catch (e) {
    // This used to throw straight out of every message send. A notification is
    // never worth failing the action that triggered it.
    console.error(
      `[push] VAPID keys rejected: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

/**
 * Send a payload to every device belonging to these users. Dead subscriptions
 * (410 Gone / 404) are deleted on the spot — a phone that reinstalled or
 * revoked permission should stop costing us a request every message.
 */
export async function pushToUsers(
  clerkUserIds: string[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  if (clerkUserIds.length === 0 || !ready()) return { sent: 0, failed: 0 };

  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("clerk_user_id", clerkUserIds);
  const subs =
    (data as
      | { id: string; endpoint: string; p256dh: string; auth: string }[]
      | null) ?? [];
  if (subs.length === 0) return { sent: 0, failed: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const dead: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          body,
          { TTL: 60 * 60 * 24 },
        );
        sent++;
      } catch (e: unknown) {
        failed++;
        const status = (e as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) dead.push(s.id);
      }
    }),
  );

  if (dead.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", dead);
  }
  // Best-effort bookkeeping; a failure here must never break sending a message.
  const liveIds = subs.filter((s) => !dead.includes(s.id)).map((s) => s.id);
  if (sent > 0 && liveIds.length > 0) {
    await supabase
      .from("push_subscriptions")
      .update({ last_success_at: new Date().toISOString() })
      .in("id", liveIds);
  }

  return { sent, failed };
}
