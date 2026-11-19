"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { isMissingColumn } from "@/lib/db-errors";
import { businessKeys, normaliseAbn, normaliseEmail, normaliseHost, normalisePhone } from "@/lib/outreach/normalise";
import { recordFingerprints } from "@/lib/outreach/check";

type Result = { ok: true; note?: string } | { ok: false; message: string };

/**
 * Someone said no. The entry blocks their whole business for outreach, not
 * just the address (Draper's no-repeat rule, src/lib/outreach/match.ts), and
 * it is also written as fingerprints, which are kept for good.
 */
export async function addDoNotContact(input: {
  email: string;
  name: string;
  business: string;
  website?: string;
  abn?: string;
  phone?: string;
}): Promise<Result> {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");

  const email = input.email.trim();
  const business = input.business.trim();
  const website = (input.website ?? "").trim();
  const abnTyped = (input.abn ?? "").trim();
  const phone = (input.phone ?? "").trim();

  if (!email && !website && !business) return { ok: false, message: "Add an email, a website or a business name." };
  if (email && !normaliseEmail(email)) return { ok: false, message: "That doesn't look like an email address." };
  if (website && !normaliseHost(website)) return { ok: false, message: "That website doesn't look right." };
  const abn = abnTyped ? normaliseAbn(abnTyped) : null;
  if (abnTyped && !abn) return { ok: false, message: "That ABN doesn't pass the ATO's check. Check the digits." };
  if (phone && !normalisePhone(phone)) return { ok: false, message: "Give the phone number with its area code." };

  const db = await createServerSupabase();
  const { data, error } = await db
    .from("do_not_contact")
    .insert({
      email: email || null,
      name: input.name.trim() || null,
      business: business || null,
      website: website || null,
      reason: "Asked not to be contacted",
      source: "Added by Kyle",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, message: "They're already on the list." };
    return { ok: false, message: error.message };
  }

  const notes: string[] = [];
  // 0063's columns, in their own update, so a database without them still
  // saves the entry.
  if (abn || phone) {
    const { error: e2 } = await db
      .from("do_not_contact")
      .update({ abn, phone: phone || null })
      .eq("id", (data as { id: string }).id);
    if (e2) {
      notes.push(
        isMissingColumn(e2)
          ? "Saved without the ABN and phone: run migration 0063 to keep those."
          : `Saved, but not the ABN and phone: ${e2.message}`,
      );
    }
  }
  try {
    await recordFingerprints(
      db,
      businessKeys({ email, website, name: business, abn, phone }),
      "do_not_contact",
      "Do-not-contact list",
    );
  } catch (e) {
    console.error("[dnc] fingerprints", e);
    notes.push("The permanent fingerprint couldn't be saved yet. The entry still blocks them.");
  }

  revalidatePath("/admin/pipeline/do-not-contact");
  return { ok: true, note: notes.join(" ") || undefined };
}
