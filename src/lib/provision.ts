import "server-only";
import { randomBytes } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "client"
  );
}

export function tempPassword(): string {
  // Strong random password. createUser runs with skipPasswordChecks so policy is
  // moot, but keep it genuinely random and mixed (no ambiguous chars).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(18);
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `${s.slice(0, 8)}-${s.slice(8, 14)}-${s.slice(14)}!9`;
}

export interface Provisioned {
  clientId: string;
  userId: string;
  email: string;
  /** Null when the login was made without one (they sign in from a link). */
  password: string | null;
}

/**
 * A client company, its first person, and their login, in one go.
 *
 * `passwordless` is the onboarding route: the person signs in once from a
 * link in their welcome email and chooses a password from inside the portal,
 * so nobody ever emails or reads out a password. If Clerk refuses a user with
 * no password, it falls back to a temporary one rather than failing, and the
 * caller shows it to Kyle as before.
 *
 * Any failure after the login exists removes the login again, so a retry starts
 * clean rather than leaving an account nobody can be given.
 */
export async function provisionClient(input: {
  businessName: string;
  contactName: string;
  email: string;
  serviceTier: string;
  passwordless?: boolean;
}): Promise<Provisioned> {
  const businessName = input.businessName.trim();
  const contactName = input.contactName.trim();
  const email = input.email.trim().toLowerCase();
  const serviceTier = input.serviceTier.trim() || "growth";
  if (!businessName) throw new Error("Business name is required.");
  if (!email || !email.includes("@")) throw new Error("A valid contact email is required.");

  const supabase = createAdminSupabase();
  const base = slugify(businessName);
  let slug = base;
  for (let n = 2; n < 100; n++) {
    const { data: clash } = await supabase.from("clients").select("id").eq("slug", slug).maybeSingle();
    if (!clash) break;
    slug = `${base}-${n}`;
  }

  // Email addresses created through the Backend API are verified already, so
  // there is no confirmation email for the client to chase.
  const clerk = await clerkClient();
  const parts = contactName.split(/\s+/).filter(Boolean);
  const names = {
    firstName: parts[0] || undefined,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
  };
  let userId: string;
  let password: string | null = null;
  try {
    if (input.passwordless) {
      try {
        const created = await clerk.users.createUser({
          emailAddress: [email],
          skipPasswordRequirement: true,
          ...names,
        });
        userId = created.id;
      } catch (e) {
        // An account for this address is a real problem, not a settings one.
        if (/taken|exists/i.test(e instanceof Error ? e.message : String(e))) throw e;
        password = tempPassword();
        const created = await clerk.users.createUser({
          emailAddress: [email],
          password,
          skipPasswordChecks: true,
          ...names,
        });
        userId = created.id;
      }
    } else {
      password = tempPassword();
      const created = await clerk.users.createUser({
        emailAddress: [email],
        password,
        skipPasswordChecks: true,
        ...names,
      });
      userId = created.id;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Couldn't create a login for ${email}. This usually means that email already has an account. (${msg})`,
    );
  }

  try {
    const { data: client, error: cErr } = await supabase
      .from("clients")
      .insert({ business_name: businessName, slug, service_tier: serviceTier, status: "onboarding" })
      .select("id")
      .single();
    if (cErr || !client) throw new Error(cErr?.message ?? "Could not create the client record.");
    const clientId = (client as { id: string }).id;

    const { error: uErr } = await supabase.from("client_users").insert({
      clerk_user_id: userId,
      client_id: clientId,
      role: "client",
      full_name: contactName || null,
      email,
    });
    if (uErr) throw new Error(uErr.message);
    return { clientId, userId, email, password };
  } catch (e) {
    try {
      await clerk.users.deleteUser(userId);
    } catch {
      // best-effort cleanup; surface the original failure below
    }
    throw e instanceof Error ? e : new Error("Could not finish setting up the client.");
  }
}

/**
 * A one-time link that signs this person straight in, for seven days. The
 * `/welcome-in` page exchanges it for a session (Clerk's ticket strategy) and
 * sends them to onboarding.
 */
export async function signInLink(userId: string, origin: string): Promise<string | null> {
  try {
    const clerk = await clerkClient();
    const t = await clerk.signInTokens.createSignInToken({ userId, expiresInSeconds: 7 * 24 * 60 * 60 });
    return `${origin}/welcome-in?t=${encodeURIComponent(t.token)}`;
  } catch (e) {
    console.error("[provision] sign-in token failed", e);
    return null;
  }
}
