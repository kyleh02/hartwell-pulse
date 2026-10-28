"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { isMissingColumn } from "@/lib/db-errors";

type Result = { ok: true } | { ok: false; message: string };

/**
 * Kyle's booking link and welcome note. Their own update, separate from the
 * rest of the business settings, so a database without migration 0055 refuses
 * this and nothing else (the lesson of the $0.00 invoice).
 */
export async function saveOnboardingSettings(input: { kickoffUrl: string; welcome: string }): Promise<Result> {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  const url = input.kickoffUrl.trim();
  if (url && !/^https:\/\/\S+$/i.test(url)) {
    return { ok: false, message: "The booking link needs to start with https://" };
  }
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("business_settings")
    .update({ kickoff_url: url || null, welcome_message: input.welcome.trim().slice(0, 2000) || null })
    .eq("id", 1);
  if (error) {
    return {
      ok: false,
      message: isMissingColumn(error) ? "Run migration 0055 in the Supabase SQL Editor first." : error.message,
    };
  }
  revalidatePath("/admin/settings");
  revalidatePath("/welcome");
  return { ok: true };
}
