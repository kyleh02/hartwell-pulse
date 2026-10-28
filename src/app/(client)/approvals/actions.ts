"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { Approval } from "@/lib/approvals-shared";
import { notifyAdmins } from "@/lib/notify";

type Result = { ok: true } | { ok: false; message: string };

/**
 * The client's side of an approval. RLS lets a client read their work and
 * nothing more, so these run with the service role AFTER checking, by hand,
 * that the work is theirs and in a state that allows the step. That keeps the
 * one rule simple: a client can never edit what they are approving.
 */
async function theirs(id: string) {
  const session = await getPulseSession();
  if (session?.role !== "client" || !session.clientId) throw new Error("Not authorised");
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from("approvals")
    .select("id, client_id, title, status, round, clients(business_name)")
    .eq("id", id)
    .maybeSingle();
  const a = data as (Pick<Approval, "id" | "client_id" | "title" | "status" | "round"> & {
    clients: { business_name: string } | { business_name: string }[] | null;
  }) | null;
  if (!a || a.client_id !== session.clientId || a.status === "draft") return null;
  const client = Array.isArray(a.clients) ? a.clients[0] : a.clients;
  return { a, session, supabase, business: client?.business_name ?? "A client" };
}

export async function decideApproval(
  id: string,
  decision: "approved" | "changes",
  comment: string,
): Promise<Result> {
  const found = await theirs(id);
  if (!found) return { ok: false, message: "That piece of work is no longer available." };
  const { a, session, supabase, business } = found;
  if (a.status !== "waiting") {
    return {
      ok: false,
      message: a.status === "approved" ? "This has already been approved." : "Kyle is already working on changes to this.",
    };
  }
  const text = comment.trim().slice(0, 4000);
  if (decision === "changes" && !text) {
    return { ok: false, message: "Tell Kyle what you'd like changed." };
  }

  const now = new Date().toISOString();
  // Only from waiting, checked again in the update itself, so a double press or
  // two people deciding at once records one decision.
  const { data: updated, error } = await supabase
    .from("approvals")
    .update({ status: decision, decided_at: now, decided_by: session.clerkUserId })
    .eq("id", id)
    .eq("status", "waiting")
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!updated || updated.length === 0) return { ok: false, message: "Someone has already answered this." };

  const who = session.profile?.full_name || "The client";
  await supabase.from("approval_events").insert({
    approval_id: id,
    client_id: a.client_id,
    kind: decision,
    body: text || null,
    round: a.round,
    author_id: session.clerkUserId,
    author_role: "client",
    author_name: who,
  });
  await notifyAdmins(a.client_id, "approval", {
    title: decision === "approved" ? `${business} approved ${a.title}` : `${business} asked for changes to ${a.title}`,
    body: text ? `${who}: ${text.length > 200 ? `${text.slice(0, 199)}…` : text}` : `${who} approved it.`,
    link: `/admin/approvals/${id}`,
  });

  revalidatePath("/approvals");
  revalidatePath(`/approvals/${id}`);
  return { ok: true };
}

export async function clientComment(id: string, body: string): Promise<Result> {
  const found = await theirs(id);
  if (!found) return { ok: false, message: "That piece of work is no longer available." };
  const { a, session, supabase, business } = found;
  const text = body.trim().slice(0, 4000);
  if (!text) return { ok: false, message: "Write something first." };
  const who = session.profile?.full_name || "The client";
  const { error } = await supabase.from("approval_events").insert({
    approval_id: id,
    client_id: a.client_id,
    kind: "comment",
    body: text,
    round: a.round,
    author_id: session.clerkUserId,
    author_role: "client",
    author_name: who,
  });
  if (error) return { ok: false, message: error.message };
  await notifyAdmins(a.client_id, "approval", {
    title: `${business} commented on ${a.title}`,
    body: `${who}: ${text.length > 200 ? `${text.slice(0, 199)}…` : text}`,
    link: `/admin/approvals/${id}`,
  });
  revalidatePath(`/approvals/${id}`);
  return { ok: true };
}
