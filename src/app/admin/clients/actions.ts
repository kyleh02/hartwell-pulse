"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { clerkClient } from "@clerk/nextjs/server";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";

export interface NewClientInput {
  businessName: string;
  contactName: string;
  email: string;
  serviceTier: string;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "client"
  );
}

function tempPassword(): string {
  // Strong random password. createUser runs with skipPasswordChecks so policy is
  // moot, but keep it genuinely random and mixed (no ambiguous chars).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(18);
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `${s.slice(0, 8)}-${s.slice(8, 14)}-${s.slice(14)}!9`;
}

/**
 * Provision a brand-new client end to end, without ever touching the Clerk
 * dashboard: create their login (Clerk Backend API), the company record, and the
 * mapping that ties them together as a `client`. Returns one-time login details
 * for Kyle to hand over. Admin only.
 */
export async function createClient(
  input: NewClientInput,
): Promise<{ email: string; password: string }> {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");

  const businessName = input.businessName.trim();
  const contactName = input.contactName.trim();
  const email = input.email.trim().toLowerCase();
  const serviceTier = input.serviceTier.trim() || "growth";

  if (!businessName) throw new Error("Business name is required.");
  if (!email || !email.includes("@")) {
    throw new Error("A valid contact email is required.");
  }

  const supabase = createAdminSupabase();

  // Find a unique slug.
  const base = slugify(businessName);
  let slug = base;
  for (let n = 2; n < 100; n++) {
    const { data: clash } = await supabase
      .from("clients")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!clash) break;
    slug = `${base}-${n}`;
  }

  const password = tempPassword();

  // 1) Create the Clerk login. Email addresses created via the Backend API are
  //    automatically verified, so the client can sign in immediately with their
  //    email + password (no verification email to chase).
  const clerk = await clerkClient();
  let userId: string;
  try {
    const parts = contactName.split(/\s+/).filter(Boolean);
    const created = await clerk.users.createUser({
      emailAddress: [email],
      password,
      skipPasswordChecks: true,
      firstName: parts[0] || undefined,
      lastName: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
    });
    userId = created.id;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Couldn't create a login for ${email}. This usually means that email already has an account. (${msg})`,
    );
  }

  // 2) Create the company + the mapping. If either fails, remove the Clerk user
  //    we just made so a retry starts clean rather than leaving an orphan login.
  try {
    const { data: client, error: cErr } = await supabase
      .from("clients")
      .insert({
        business_name: businessName,
        slug,
        service_tier: serviceTier,
        status: "onboarding",
      })
      .select("id")
      .single();
    if (cErr || !client) {
      throw new Error(cErr?.message ?? "Could not create the client record.");
    }

    const { error: uErr } = await supabase.from("client_users").insert({
      clerk_user_id: userId,
      client_id: (client as { id: string }).id,
      role: "client",
      full_name: contactName || null,
      email,
    });
    if (uErr) throw new Error(uErr.message);
  } catch (e) {
    try {
      await clerk.users.deleteUser(userId);
    } catch {
      // best-effort cleanup; surface the original failure below
    }
    throw e instanceof Error
      ? e
      : new Error("Could not finish setting up the client.");
  }

  revalidatePath("/admin/clients");
  return { email, password };
}
