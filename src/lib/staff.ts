import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { HARTWELL } from "@/lib/brand";

/**
 * The Hartwell Digital team as clients see it: each team account (role
 * `admin`) by first name, keyed by Clerk user id. A client sees "Kyle" or
 * "Sam" on a message, never a surname, and the chat itself is "our team"
 * rather than one person, since the team is growing.
 *
 * Read with the service role because a client's RLS cannot see team rows,
 * and only first names ever leave here.
 */
export async function staffNames(): Promise<Record<string, string>> {
  const { data } = await createAdminSupabase().from("client_users").select("clerk_user_id, full_name").eq("role", "admin");
  return Object.fromEntries(
    ((data as { clerk_user_id: string; full_name: string | null }[] | null) ?? []).map((u) => [u.clerk_user_id, firstName(u.full_name)]),
  );
}

export function firstName(full: string | null | undefined): string {
  return full?.trim().split(/\s+/)[0] || HARTWELL.name;
}
