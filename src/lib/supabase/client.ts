"use client";

import { useSession } from "@clerk/nextjs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useMemo } from "react";

/**
 * Supabase client for Client Components.
 *
 * Returns a memoised client that attaches the live Clerk session token to every
 * request, so RLS runs under the signed-in user. Re-created only when the Clerk
 * session changes.
 *
 * Usage:
 *   const supabase = useSupabaseClient();
 *   const { data } = await supabase.from("assets").select("*");
 */
export function useSupabaseClient(): SupabaseClient {
  const { session } = useSession();

  return useMemo(() => {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        async accessToken() {
          return (await session?.getToken()) ?? null;
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
    // session identity is stable for a given signed-in user; token is fetched fresh per request
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}
