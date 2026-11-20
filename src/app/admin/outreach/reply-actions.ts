"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { outreachEnabled } from "@/lib/outreach/flag";
import { applyLabel, closeLater, faultBackOn } from "@/lib/outreach/replies";
import { FAULTS, type Fault } from "@/lib/outreach/rules";

/**
 * Kyle's reply controls (Stage 6). Each checks the flag and an admin, then
 * works with the service role: a label can touch the pipeline, do-not-contact
 * and the fingerprints in one go, as the tick does.
 */
async function guard() {
  if (!outreachEnabled()) throw new Error("Not found");
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  return session;
}

type Result = { ok: true; leadId?: string | null } | { ok: false; message: string };

export async function labelReply(replyId: string, label: string, laterOn: string | null): Promise<Result> {
  const session = await guard();
  const r = await applyLabel(createAdminSupabase(), replyId, label, laterOn, "kyle", session.clerkUserId);
  revalidatePath("/admin/outreach");
  if (r.ok) revalidatePath("/admin/pipeline");
  return r;
}

export async function laterDone(prospectId: string): Promise<Result> {
  await guard();
  const ok = await closeLater(createAdminSupabase(), prospectId);
  revalidatePath("/admin/outreach");
  return ok ? { ok: true } : { ok: false, message: "That card isn't waiting any more." };
}

export async function faultOn(fault: string): Promise<Result> {
  await guard();
  if (!(FAULTS as readonly string[]).includes(fault)) return { ok: false, message: "That isn't a fault Draper knows." };
  await faultBackOn(createAdminSupabase(), fault as Fault);
  revalidatePath("/admin/outreach");
  return { ok: true };
}
