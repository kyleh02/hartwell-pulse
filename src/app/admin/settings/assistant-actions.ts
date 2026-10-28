"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { isMissingColumn } from "@/lib/db-errors";

type Result = { ok: true } | { ok: false; message: string };

/** The assistant's switch and Kyle's notes for it. Its own update (0059). */
export async function saveAssistantSettings(input: { enabled: boolean; knowledge: string }): Promise<Result> {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  const { error } = await (await createServerSupabase())
    .from("business_settings")
    .update({ assistant_enabled: input.enabled === true, assistant_knowledge: input.knowledge.trim().slice(0, 12000) || null })
    .eq("id", 1);
  if (error) return { ok: false, message: isMissingColumn(error) ? "Run migration 0059 in the Supabase SQL Editor first." : error.message };
  revalidatePath("/admin/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}
