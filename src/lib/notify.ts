import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type NoticeType = "approval" | "onboarding" | "nps" | "assistant";

interface Notice {
  title: string;
  body: string | null;
  link: string;
}

/**
 * Bell notifications on the instant channel. The 15-minute email job turns
 * each into an email with a button straight to the link, so a caller gets a
 * bell AND an email from one insert, and never sends mail itself.
 */
export async function notifyClientPeople(clientId: string, type: NoticeType, n: Notice) {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from("client_users")
    .select("clerk_user_id")
    .eq("client_id", clientId)
    .eq("role", "client");
  await insert(
    ((data as { clerk_user_id: string }[] | null) ?? []).map((u) => ({
      recipient_user_id: u.clerk_user_id,
      client_id: clientId,
      type,
      channel: "instant",
      ...n,
    })),
  );
}

export async function notifyAdmins(clientId: string | null, type: NoticeType, n: Notice) {
  const supabase = createAdminSupabase();
  const { data } = await supabase.from("client_users").select("clerk_user_id").eq("role", "admin");
  await insert(
    ((data as { clerk_user_id: string }[] | null) ?? []).map((u) => ({
      recipient_user_id: u.clerk_user_id,
      client_id: clientId,
      type,
      channel: "instant",
      ...n,
    })),
  );
}

async function insert(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const { error } = await createAdminSupabase().from("notifications").insert(rows);
  // A notification that fails must not undo the thing it was announcing.
  if (error) console.error("[notify]", error.message);
}
