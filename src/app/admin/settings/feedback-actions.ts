"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { isMissingColumn } from "@/lib/db-errors";

type Result = { ok: true } | { ok: false; message: string };

/** Surveys on or off, and the Google review link shown to a 9 or 10. Its own update (0058). */
export async function saveFeedbackSettings(input: { enabled: boolean; reviewUrl: string }): Promise<Result> {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  const url = input.reviewUrl.trim();
  if (url && !/^https:\/\/\S+$/i.test(url)) return { ok: false, message: "The review link needs to start with https://" };
  const { error } = await (await createServerSupabase())
    .from("business_settings")
    .update({ nps_enabled: input.enabled === true, google_review_url: url || null })
    .eq("id", 1);
  if (error) return { ok: false, message: isMissingColumn(error) ? "Run migration 0058 in the Supabase SQL Editor first." : error.message };
  revalidatePath("/admin/settings");
  revalidatePath("/admin/feedback");
  return { ok: true };
}
