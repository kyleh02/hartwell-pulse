"use server";

import { revalidatePath } from "next/cache";
import { clerkClient } from "@clerk/nextjs/server";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { checkAbn } from "@/lib/billing";
import { isMissingColumn } from "@/lib/db-errors";
import { provisionClient, tempPassword } from "@/lib/provision";

export interface NewClientInput {
  businessName: string;
  contactName: string;
  email: string;
  serviceTier: string;
}

/**
 * Reissue a temporary password for someone on a client account.
 *
 * Deepayan was provisioned, given a password, and still replied "no way to
 * login" — the details were lost somewhere between being generated and being
 * read. There was no way to help him from inside the portal, which meant the
 * Clerk dashboard, which is not a thing to be doing at 9pm.
 *
 * Deliberately NOT a "send a reset email". A reset link is one more email to
 * be missed by the person who has already missed one, and it cannot be read
 * out over the phone. This hands Kyle a password to pass on however he likes.
 *
 * Every other session is revoked at the same time. If somebody is locked out
 * because a shared device is still signed in as them, leaving that session
 * alive leaves the confusion in place.
 */
export async function resetClientUserPassword(
  clerkUserId: string,
): Promise<{ email: string; password: string; name: string }> {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");

  // Service role, matching the rest of this file: provisioning reads and
  // writes rows across every client, which is exactly what RLS forbids. The
  // admin check above is the gate.
  const supabase = createAdminSupabase();
  const { data: row } = await supabase
    .from("client_users")
    .select("email, full_name, role")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  const person = row as {
    email: string | null;
    full_name: string | null;
    role: string;
  } | null;
  if (!person) throw new Error("That user doesn't exist.");
  // Admins reset their own password through Clerk's own account UI, where it
  // needs the current password. An admin who could silently rewrite another
  // admin's credentials from a button is a different security model.
  if (person.role !== "client") {
    throw new Error("Only client logins can be reset from here.");
  }

  const password = tempPassword();
  const clerk = await clerkClient();
  await clerk.users.updateUser(clerkUserId, {
    password,
    skipPasswordChecks: true,
    // Clerk's own prompt to change it at next sign-in. It is their password
    // from then on, not one Kyle has a copy of.
    signOutOfOtherSessions: true,
  });

  return {
    email: person.email ?? "",
    password,
    name: person.full_name ?? "this person",
  };
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
  const made = await provisionClient(input);
  revalidatePath("/admin/clients");
  return { email: made.email, password: made.password as string };
}

async function requireAdmin() {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
}

/**
 * Add another user to an EXISTING client (e.g. a business partner). They get
 * their own login and their own private thread with Kyle (created by a DB
 * trigger), and share everything client-scoped: assets, invoices, reports.
 * Returns one-time login details for Kyle to hand over. Admin only.
 */
export async function addClientUser(
  clientId: string,
  input: { contactName: string; email: string },
): Promise<{ email: string; password: string }> {
  await requireAdmin();

  const contactName = input.contactName.trim();
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("A valid email is required.");
  }

  const supabase = createAdminSupabase();
  const { data: client, error: cErr } = await supabase
    .from("clients")
    .select("id, deleted_at")
    .eq("id", clientId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!client || (client as { deleted_at: string | null }).deleted_at) {
    throw new Error("That client doesn't exist (or is deleted).");
  }

  const password = tempPassword();

  // Same pattern as createClient: Backend-API emails are auto-verified, so the
  // new user can sign in immediately with email + password.
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

  try {
    const { error: uErr } = await supabase.from("client_users").insert({
      clerk_user_id: userId,
      client_id: clientId,
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
      : new Error("Could not finish adding the user.");
  }

  revalidatePath("/admin/clients");
  revalidatePath("/admin/messages");
  return { email, password };
}

/**
 * Change a client user's login email. Updates Clerk (new address, verified and
 * primary; old ones removed) and the client_users row, so their login, invoice
 * emails and the portal display all follow. Password and sessions are
 * untouched — they just sign in with the new address next time. Admin only.
 */
export async function updateClientUserEmail(
  clerkUserId: string,
  newEmail: string,
): Promise<void> {
  await requireAdmin();

  const email = newEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("A valid email is required.");
  }

  const supabase = createAdminSupabase();
  const { data: row, error: rErr } = await supabase
    .from("client_users")
    .select("id, email")
    .eq("clerk_user_id", clerkUserId)
    .eq("role", "client")
    .maybeSingle();
  if (rErr) throw new Error(rErr.message);
  if (!row) throw new Error("That user doesn't exist.");
  if ((row as { email: string | null }).email === email) return;

  const clerk = await clerkClient();
  const user = await clerk.users.getUser(clerkUserId);
  const oldIds = user.emailAddresses.map((e) => e.id);

  // Add the new address first (verified + primary), then drop the old ones —
  // this order can never leave the account without a login email.
  try {
    await clerk.emailAddresses.createEmailAddress({
      userId: clerkUserId,
      emailAddress: email,
      verified: true,
      primary: true,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Couldn't switch to ${email}. This usually means that email already has an account. (${msg})`,
    );
  }
  for (const id of oldIds) {
    try {
      await clerk.emailAddresses.deleteEmailAddress(id);
    } catch {
      // An old address lingering as a secondary is harmless: the new one is
      // primary, and the client_users row below is what the portal reads.
    }
  }

  const { error: uErr } = await supabase
    .from("client_users")
    .update({ email })
    .eq("clerk_user_id", clerkUserId);
  if (uErr) throw new Error(uErr.message);

  revalidatePath("/admin/clients");
}

/**
 * Move a client between the Active list (status 'active') and the Inactive list
 * (status 'paused'). Purely organisational — no data is deleted and their login
 * is unchanged, so a parked client can be brought back at any time.
 */
export async function setClientStatus(
  clientId: string,
  status: "active" | "paused",
) {
  await requireAdmin();
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("clients")
    .update({ status })
    .eq("id", clientId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/clients");
}

/**
 * Soft-delete: hides the client and cuts their portal access immediately, but
 * keeps every byte of their data. Reversible for 30 days via restoreClient,
 * after which /api/cron/purge-clients removes their portal data — never their
 * invoices.
 */
export async function deleteClient(clientId: string) {
  await requireAdmin();
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("clients")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", clientId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/clients");
}

/** Undo a soft-delete within the 30-day grace window. */
export async function restoreClient(clientId: string) {
  await requireAdmin();
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("clients")
    .update({ deleted_at: null })
    .eq("id", clientId)
    .is("purged_at", null);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/clients");
}

/**
 * Edit a client's company details. The business name is read live everywhere
 * (invoices, assets, dashboards), so changing it here renames the client across
 * the whole portal. The slug stays fixed — it's a stable internal identifier, not
 * a display name. Admin only.
 */
export async function updateClient(
  clientId: string,
  input: {
    businessName: string;
    serviceTier: string;
    status: string;
    legalName?: string;
    abn?: string;
    billingAddress?: string;
    billingAttention?: string;
  },
): Promise<void> {
  await requireAdmin();
  const businessName = input.businessName.trim();
  const serviceTier = input.serviceTier.trim() || "growth";
  const status = input.status;
  if (!businessName) throw new Error("Business name is required.");
  if (!["onboarding", "active", "paused"].includes(status)) {
    throw new Error("Invalid status.");
  }

  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("clients")
    .update({ business_name: businessName, service_tier: serviceTier, status })
    .eq("id", clientId);
  if (error) throw new Error(error.message);

  // Billing details, checked again here because the form is only a convenience.
  // A wrong ABN on a tax invoice names a different business.
  const { abn, problem } = checkAbn(input.abn ?? "");
  if (problem) throw new Error(problem);
  const blank = (v?: string) => (v ?? "").trim() || null;
  const { error: billErr } = await supabase
    .from("clients")
    .update({
      legal_name: blank(input.legalName),
      abn,
      billing_address: blank(input.billingAddress),
      billing_attention: blank(input.billingAttention),
    })
    .eq("id", clientId);
  if (billErr) {
    throw new Error(
      isMissingColumn(billErr)
        ? "The name, tier and status saved, but billing details need migration 0052 run in Supabase first."
        : `The name, tier and status saved, but the billing details did not: ${billErr.message}`,
    );
  }

  revalidatePath("/admin/clients");
  revalidatePath("/admin");
}

export interface PreviewInput {
  title: string;
  url: string;
  note: string;
  visible: boolean;
}

/** Add or update one preview link for a client. */
export async function savePreview(
  clientId: string,
  input: PreviewInput,
  previewId?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");

  const url = input.url.trim();
  // A preview is an iframe src and a link the client will click. Anything but
  // http(s) there is either a mistake or an attempt at something, and both are
  // worth refusing rather than rendering.
  if (!/^https?:\/\/\S+$/i.test(url)) {
    return { ok: false, message: "That needs to be a full http or https address." };
  }
  if (!input.title.trim()) {
    return { ok: false, message: "Give it a name, like Home or Services." };
  }

  const supabase = createAdminSupabase();
  const fields = {
    client_id: clientId,
    title: input.title.trim(),
    url,
    note: input.note.trim() || null,
    visible: input.visible,
    created_by: session.clerkUserId,
  };

  const { error } = previewId
    ? await supabase.from("client_previews").update(fields).eq("id", previewId)
    : await supabase.from("client_previews").insert(fields);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/clients");
  revalidatePath("/website");
  return { ok: true };
}

export async function deletePreview(previewId: string): Promise<void> {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  const { error } = await createAdminSupabase()
    .from("client_previews")
    .delete()
    .eq("id", previewId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/clients");
}
