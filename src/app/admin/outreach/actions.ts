"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { outreachEnabled } from "@/lib/outreach/flag";
import { checkBusiness } from "@/lib/outreach/check";
import { publicVerdict, type Block } from "@/lib/outreach/match";
import { postcodePlace } from "@/lib/outreach/geo";

async function guard() {
  if (!outreachEnabled()) throw new Error("Not found");
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  return session;
}

type Result = { ok: true } | { ok: false; message: string };

export interface CheckResult {
  allowed: boolean;
  problem?: string;
  /** What matched, by name: for Kyle only. */
  blocks: Block[];
  /** The keys the check was made on, so a surprising answer can be read. */
  keys: string[];
  /** Exactly what the morning run's connector would be told. */
  connector: { allowed: boolean; reasons: string[] };
}

/** Kyle's "Check a business" on the Draper page: the same check the morning run gets, with the names shown. */
export async function checkBusinessAction(input: {
  website?: string;
  name?: string;
  email?: string;
  abn?: string;
  phone?: string;
  postcode?: string;
  services?: string;
}): Promise<CheckResult> {
  await guard();
  const v = await checkBusiness(createAdminSupabase(), {
    ...input,
    postcode: input.postcode?.trim() || null,
    services: input.services ? [input.services] : [],
  });
  return {
    allowed: v.allowed,
    problem: v.problem,
    blocks: v.blocks,
    keys: v.keys.map((k) => `${k.kind}: ${k.value}`),
    connector: publicVerdict(v),
  };
}

/** A client's location and services: prospects offering an overlapping service within the radius are skipped. */
export async function addClientArea(input: {
  clientId: string;
  place: string;
  postcode: string;
  services: string;
  radiusKm: string;
}): Promise<Result> {
  await guard();
  const place = input.place.trim();
  const postcode = input.postcode.trim();
  const radius = Number(input.radiusKm || 15);
  if (!input.clientId) return { ok: false, message: "Choose a client." };
  if (!place) return { ok: false, message: "Name the place, a suburb or town." };
  if (!postcodePlace(postcode)) return { ok: false, message: "That postcode isn't on file. Check the four digits." };
  if (!Number.isFinite(radius) || radius <= 0 || radius > 200) return { ok: false, message: "The radius is 1 to 200 km." };
  const services = input.services
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const { error } = await (await createServerSupabase()).from("outreach_client_areas").insert({
    client_id: input.clientId,
    place,
    postcode,
    services,
    radius_km: radius,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/outreach");
  return { ok: true };
}

export async function removeClientArea(id: string): Promise<Result> {
  await guard();
  const { error } = await (await createServerSupabase()).from("outreach_client_areas").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/outreach");
  return { ok: true };
}
