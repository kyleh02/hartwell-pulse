import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses Row Level Security.
 *
 * Use ONLY in trusted server code: webhook handlers, report generation,
 * scheduled jobs, and admin operations that legitimately need to act across
 * every client. Never import this into a Client Component and never expose the
 * service role key to the browser.
 *
 * Because it bypasses RLS, any code using this client is responsible for its
 * own access checks.
 */
export function createAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
