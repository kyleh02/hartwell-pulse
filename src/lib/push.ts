import "server-only";
import webpush from "web-push";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * Web push delivery. Subscriptions are send-credentials, so every read and
 * write here uses the service role and never leaves the server.
 */

let configured = false;

function ready(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  if (!configured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:admin@hartwelldigital.com",
      publicKey,
      privateKey,
    );
    configured = true;
  }
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
