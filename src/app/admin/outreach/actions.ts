"use server";

import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { outreachEnabled } from "@/lib/outreach/flag";
import { checkBusiness, type CheckInput } from "@/lib/outreach/check";
import { publicVerdict, type Block } from "@/lib/outreach/match";

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
export async function checkBusinessAction(input: CheckInput): Promise<CheckResult> {
  if (!outreachEnabled()) throw new Error("Not found");
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  const v = await checkBusiness(createAdminSupabase(), input);
  return {
    allowed: v.allowed,
    problem: v.problem,
    blocks: v.blocks,
    keys: v.keys.map((k) => `${k.kind}: ${k.value}`),
    connector: publicVerdict(v),
  };
}
