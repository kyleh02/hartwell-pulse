"use server";

import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { pushToUsers, pushConfigured } from "@/lib/push";

interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}

/** Register this device for push. Upserts on endpoint so re-subscribing is safe. */
export async function savePushSubscription(sub: SubscriptionInput) {
  const session = await getPulseSession();
  if (!session) throw new Error("Not signed in");
  if (!sub.endpoint || !sub.p256dh || !sub.auth) {
    throw new Error("Incomplete subscription");
  }

  const supabase = createAdminSupabase();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      clerk_user_id: session.clerkUserId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      user_agent: sub.userAgent?.slice(0, 300) ?? null,
      failure_count: 0,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw new Error(error.message);
}

/** Turn push off for this device. Scoped to the caller's own subscriptions. */
export async function removePushSubscription(endpoint: string) {
  const session = await getPulseSession();
  if (!session) throw new Error("Not signed in");
  const supabase = createAdminSupabase();
  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("clerk_user_id", session.clerkUserId);
}

/**
 * Fire a test push to the caller's own devices. Reports precisely which step
 * failed — "no devices" and "server not configured" look identical from the
 * browser otherwise, and they need opposite fixes.
 */
export async function sendTestPush(): Promise<{
  status: "sent" | "none-delivered" | "no-devices" | "not-configured";
  devices: number;
  sent: number;
  failed: number;
}> {
  const session = await getPulseSession();
  if (!session) throw new Error("Not signed in");

  if (!pushConfigured()) {
    return { status: "not-configured", devices: 0, sent: 0, failed: 0 };
  }

  const supabase = createAdminSupabase();
  const { count } = await supabase
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("clerk_user_id", session.clerkUserId);
  const devices = count ?? 0;
  if (devices === 0) {
    return { status: "no-devices", devices: 0, sent: 0, failed: 0 };
  }

  const { sent, failed } = await pushToUsers([session.clerkUserId], {
    title: "Hartwell Pulse",
    body: "Notifications are working. This is what a new message looks like.",
    url: session.role === "admin" ? "/admin/messages" : "/messages",
    tag: "pulse-test",
  });
  return {
    status: sent > 0 ? "sent" : "none-delivered",
    devices,
    sent,
    failed,
  };
}

/**
 * Push a just-sent message to the thread's other members. Called by the sender
 * right after the insert, so it lands whether or not the recipient has the
 * portal open. Everything shown is read back from the database — the caller
 * supplies only the message id, so a preview can't be spoofed.
 */
export async function notifyNewMessage(messageId: string) {
  const session = await getPulseSession();
  if (!session) return;

  const supabase = createAdminSupabase();
  const { data: msg } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_user_id, sender_role, body, attachments")
    .eq("id", messageId)
    .maybeSingle();
  const message = msg as {
    conversation_id: string;
    sender_user_id: string;
    sender_role: string;
    body: string | null;
    attachments: unknown[] | null;
  } | null;
  // Only the sender can trigger their own message's push.
  if (!message || message.sender_user_id !== session.clerkUserId) return;

  const { data: convRow } = await supabase
    .from("conversations")
    .select("kind, title")
    .eq("id", message.conversation_id)
    .maybeSingle();
  const conv = convRow as { kind: string; title: string | null } | null;
  if (!conv) return;

  const { data: memberRows } = await supabase
    .from("conversation_members")
    .select("clerk_user_id")
    .eq("conversation_id", message.conversation_id);
  const recipients = ((memberRows as { clerk_user_id: string }[] | null) ?? [])
    .map((m) => m.clerk_user_id)
    .filter((id) => id !== session.clerkUserId);
  if (recipients.length === 0) return;

  // Sender's display name, and each recipient's role (their link differs).
  const { data: userRows } = await supabase
    .from("client_users")
    .select("clerk_user_id, full_name, role")
    .in("clerk_user_id", [...recipients, session.clerkUserId]);
  const users =
    (userRows as
      | { clerk_user_id: string; full_name: string | null; role: string }[]
      | null) ?? [];
  const senderRow = users.find((u) => u.clerk_user_id === session.clerkUserId);
  const senderName =
    message.sender_role === "admin"
      ? "Kyle"
      : (senderRow?.full_name ?? "Your client");

  const title =
    conv.kind === "group"
      ? `${senderName} · ${conv.title ?? "Team chat"}`
      : senderName;
  const body =
    message.body && message.body.trim()
      ? message.body.slice(0, 140)
      : "Sent an attachment";
  const tag = `conv-${message.conversation_id}`;

  const admins = recipients.filter(
    (id) => users.find((u) => u.clerk_user_id === id)?.role === "admin",
  );
  const clients = recipients.filter((id) => !admins.includes(id));

  await Promise.all([
    admins.length > 0 &&
      pushToUsers(admins, { title, body, url: "/admin/messages", tag }),
    clients.length > 0 &&
      pushToUsers(clients, { title, body, url: "/messages", tag }),
  ]);
}
