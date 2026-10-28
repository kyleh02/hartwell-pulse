"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; message: string };

export async function addDoNotContact(input: { email: string; name: string; business: string }): Promise<Result> {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  const email = input.email.trim();
  if (!email.includes("@")) return { ok: false, message: "That doesn't look like an email address." };
  const { error } = await (await createServerSupabase()).from("do_not_contact").insert({
    email,
    name: input.name.trim() || null,
    business: input.business.trim() || null,
    reason: "Asked not to be contacted",
    source: "Added by Kyle",
  });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "They're already on the list." };
    return { ok: false, message: error.message };
  }
  revalidatePath("/admin/pipeline/do-not-contact");
  return { ok: true };
}
