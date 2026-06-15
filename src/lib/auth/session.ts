import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { ClientUser, Role } from "@/lib/types/database";

export interface PulseSession {
  clerkUserId: string;
  role: Role | null; // null when the Clerk user has no client_users mapping yet
  clientId: string | null; // null for admins
  profile: ClientUser | null;
}

/**
 * Resolve the current Clerk user into a Pulse identity: their role and, for
 * clients, their client_id. Returns null when nobody is signed in.
 *
 * We look the mapping up with the service-role client because deciding "who is
 * this and what may they see" is a trusted server decision that must work even
 * before any per-user RLS context exists. The RLS policies remain the real data
 * boundary for every actual data query elsewhere.
 */
export async function getPulseSession(): Promise<PulseSession | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("client_users")
    .select("*")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (error) {
    // A genuine lookup failure (bad service key, DB outage, grant/RLS misconfig)
    // must fail loud, not silently degrade everyone to "unprovisioned" — that
    // would mask a security-relevant fault. A missing row is a different thing:
    // data === null with no error, handled below as "not provisioned yet".
    throw new Error(`client_users lookup failed: ${error.message}`);
  }

  const profile = (data as ClientUser | null) ?? null;

  return {
    clerkUserId: userId,
    role: profile?.role ?? null,
    clientId: profile?.client_id ?? null,
    profile,
  };
}

export function isAdmin(session: PulseSession | null): boolean {
  return session?.role === "admin";
}

export function isClient(session: PulseSession | null): boolean {
  return session?.role === "client";
}
