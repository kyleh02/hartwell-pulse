"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";

async function requireAdmin() {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  return session;
}

/**
 * Start (or revive) the direct thread between one client user and Kyle. Can't
 * upsert: the (client_id, direct_user_id) unique index is partial (direct
 * threads only), which PostgREST's on_conflict can't target.
 */
export async function startDirectConversation(
  clientId: string,
  directUserId: string,
) {
  const session = await requireAdmin();
  const supabase = createAdminSupabase();

  const { data: existing, error: findErr } = await supabase
    .from("conversations")
    .select("id")
    .eq("client_id", clientId)
    .eq("kind", "direct")
    .eq("direct_user_id", directUserId)
    .maybeSingle();
  if (findErr) throw new Error(findErr.message);

  if (existing) {
    const { error } = await supabase
      .from("conversations")
      .update({ deleted_at: null, deleted_by: null })
      .eq("id", (existing as { id: string }).id);
    if (error) throw new Error(error.message);
  } else {
    const { data: conv, error } = await supabase
      .from("conversations")
      .insert({
        client_id: clientId,
        kind: "direct",
        direct_user_id: directUserId,
        created_by: session.clerkUserId,
      })
      .select("id")
      .single();
    if (error || !conv) {
      throw new Error(error?.message ?? "Could not start the conversation.");
    }
    const { error: mErr } = await supabase.from("conversation_members").upsert(
      [
        { conversation_id: (conv as { id: string }).id, clerk_user_id: directUserId },
        { conversation_id: (conv as { id: string }).id, clerk_user_id: session.clerkUserId },
      ],
      { onConflict: "conversation_id,clerk_user_id", ignoreDuplicates: true },
    );
    if (mErr) throw new Error(mErr.message);
  }
  revalidatePath("/admin/messages");
}

/**
 * Create a group thread: a chosen set of the client's users + Kyle. The member
 * list is validated against the client's real users so a stray id can never
 * pull an outsider into the thread.
 */
export async function createGroupConversation(
  clientId: string,
  title: string,
  memberUserIds: string[],
): Promise<string> {
  const session = await requireAdmin();
  const supabase = createAdminSupabase();

  const name = title.trim();
  if (!name) throw new Error("Give the group chat a name.");
  if (memberUserIds.length < 2) {
    throw new Error("Pick at least two members — otherwise start a direct chat.");
  }

  const { data: users, error: uErr } = await supabase
    .from("client_users")
    .select("clerk_user_id")
    .eq("client_id", clientId)
    .eq("role", "client")
    .in("clerk_user_id", memberUserIds);
  if (uErr) throw new Error(uErr.message);
  const valid = ((users as { clerk_user_id: string }[] | null) ?? []).map(
    (u) => u.clerk_user_id,
  );
  if (valid.length !== memberUserIds.length) {
    throw new Error("Every member must be a user of this client.");
  }

  const { data: conv, error } = await supabase
    .from("conversations")
    .insert({
      client_id: clientId,
      kind: "group",
      title: name,
      created_by: session.clerkUserId,
    })
    .select("id")
    .single();
  if (error || !conv) {
    throw new Error(error?.message ?? "Could not create the group chat.");
  }
  const convId = (conv as { id: string }).id;

  const { error: mErr } = await supabase.from("conversation_members").insert(
    [...valid, session.clerkUserId].map((id) => ({
      conversation_id: convId,
      clerk_user_id: id,
    })),
  );
  if (mErr) {
    // Half-made group chats are confusing: clean up and let Kyle retry.
    await supabase.from("conversations").delete().eq("id", convId);
    throw new Error(mErr.message);
  }

  revalidatePath("/admin/messages");
  return convId;
}

/**
 * Soft-delete a conversation: hidden from every member immediately, restorable
 * for 30 days (then the daily purge removes it for good). Clears the members'
 * unread message notifications so reminder emails stop.
 */
export async function deleteConversation(conversationId: string) {
  const session = await requireAdmin();
  const supabase = createAdminSupabase();

  const { data: conv, error: cErr } = await supabase
    .from("conversations")
    .select("client_id")
    .eq("id", conversationId)
    .single();
  if (cErr || !conv) throw new Error(cErr?.message ?? "Conversation not found.");

  const { error } = await supabase
    .from("conversations")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: session.clerkUserId,
    })
    .eq("id", conversationId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);

  // Notification rows don't carry a conversation id, so clear the thread's
  // members' unread message alerts for this client (service role: RLS is
  // recipient-scoped).
  const { data: members } = await supabase
    .from("conversation_members")
    .select("clerk_user_id")
    .eq("conversation_id", conversationId);
  const ids = ((members as { clerk_user_id: string }[] | null) ?? []).map(
    (m) => m.clerk_user_id,
  );
  if (ids.length > 0) {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("client_id", (conv as { client_id: string }).client_id)
      .eq("type", "message")
      .is("read_at", null)
      .in("recipient_user_id", ids);
  }

  revalidatePath("/admin/messages");
}

/** Undo a conversation soft-delete within the 30-day grace window. */
export async function restoreConversation(conversationId: string) {
  await requireAdmin();
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("conversations")
    .update({ deleted_at: null, deleted_by: null })
    .eq("id", conversationId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/messages");
}
