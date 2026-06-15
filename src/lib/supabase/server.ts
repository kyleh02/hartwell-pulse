import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 *
 * It forwards the signed-in user's Clerk session token to Supabase, so every
 * query runs under that user's identity and Row Level Security applies. The
 * Clerk user id (the JWT `sub` claim) is what the RLS policies key off.
 *
 * This relies on the Supabase <-> Clerk native third-party auth integration
 * (Supabase dashboard -> Authentication -> Third Party Auth -> Clerk). With
 * that set up, the default session token works and no JWT template is needed.
 */
export async function createServerSupabase() {
  const { getToken } = await auth();

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      async accessToken() {
        return (await getToken()) ?? null;
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
