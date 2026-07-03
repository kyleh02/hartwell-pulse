"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";

async function requireAdmin() {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  return session;
}

/** Start (or revive) the conversation with a client so it appears in the list. */
export async function startConversation(clientId: string) {
  const session = await requireAdmin();
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("conversations")
    .upsert(
      {
        client_id: clientId,
        created_by: session.clerkUserId,
        deleted_at: null,
        deleted_by: null,
      },
      { onConflict: "client_id" },
    );
  if (error) throw new Error(error.message);
  revalidatePath("/admin/messages");
}

/**
 * Soft-delete a conversation: hidden from both sides immediately, restorable for
 * 30 days (then the daily purge removes it for good). Also clears any unread
 * message notifications for this client so reminder emails stop.
 */
export async function deleteConversation(clientId: string) {
  const session = await requireAdmin();
  const supabase = createAdminSupabase();

  const { error } = await supabase
    .from("conversations")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: session.clerkUserId,
    })
    .eq("client_id", clientId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);

  // Notifications are recipient-scoped under RLS, so clearing everyone's unread
  // message alerts for this thread needs the service role.
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("type", "message")
    .is("read_at", null);

  revalidatePath("/admin/messages");
}

/** Undo a conversation soft-delete within the 30-day grace window. */
export async function restoreConversation(clientId: string) {
  await requireAdmin();
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("conversations")
    .update({ deleted_at: null, deleted_by: null })
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/messages");
}
