"use server";

import { revalidatePath } from "next/cache";
import { HARTWELL } from "@/lib/brand";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  KINDS,
  approvalFolder,
  checkFile,
  displayFileName,
  isApprovalPathFor,
  type Approval,
  type ApprovalKind,
} from "@/lib/approvals-shared";
import { notifyClientPeople } from "@/lib/notify";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const BUCKET = "pulse-reports";

async function admin() {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  return { session, supabase: await createServerSupabase() };
}

function missing(err: { code?: string; message: string }): string {
  return err.code === "PGRST205" || err.code === "42P01"
    ? "Run migration 0054 in the Supabase SQL Editor first."
    : err.message;
}

export interface ApprovalInput {
  kind: ApprovalKind;
  title: string;
  body: string;
  note: string;
  channel: string;
  due_on: string;
}

function clean(input: ApprovalInput) {
  return {
    kind: (Object.keys(KINDS) as ApprovalKind[]).includes(input.kind) ? input.kind : "copy",
    title: input.title.trim().slice(0, 140),
    body: input.body.trim() || null,
    note: input.note.trim().slice(0, 1000) || null,
    channel: input.channel.trim().slice(0, 80) || null,
    due_on: /^\d{4}-\d{2}-\d{2}$/.test(input.due_on) ? input.due_on : null,
  };
}

/** A new piece of work, as a draft the client cannot see yet. */
export async function createApproval(clientId: string, input: ApprovalInput): Promise<Result<{ id: string }>> {
  const { session, supabase } = await admin();
  const fields = clean(input);
  if (!fields.title) return { ok: false, message: "Give it a title the client will recognise." };
  const { data, error } = await supabase
    .from("approvals")
    .insert({ client_id: clientId, ...fields, created_by: session.clerkUserId })
    .select("id")
    .single();
  if (error) return { ok: false, message: missing(error) };
  revalidatePath("/admin/approvals");
  return { ok: true, id: (data as { id: string }).id };
}

export async function saveApproval(id: string, input: ApprovalInput): Promise<Result> {
  const { supabase } = await admin();
  const fields = clean(input);
  if (!fields.title) return { ok: false, message: "Give it a title the client will recognise." };
  const { error } = await supabase.from("approvals").update(fields).eq("id", id);
  if (error) return { ok: false, message: missing(error) };
  revalidatePath(`/admin/approvals/${id}`);
  return { ok: true };
}

/**
 * Record a file the browser has just put in storage. The path is checked to be
 * inside this approval's own folder, and the size is read back from storage
 * rather than trusted.
 */
export async function addApprovalFile(id: string, file: { path: string; name: string }): Promise<Result> {
  const { supabase } = await admin();
  const { data: a } = await supabase.from("approvals").select("id, client_id").eq("id", id).maybeSingle();
  const approval = a as { id: string; client_id: string } | null;
  if (!approval) return { ok: false, message: "That piece of work no longer exists." };
  if (!isApprovalPathFor(file.path, approval.client_id, id)) {
    return { ok: false, message: "That file was not uploaded for this piece of work." };
  }
  const discard = () => supabase.storage.from(BUCKET).remove([file.path]);

  const folder = approvalFolder(approval.client_id, id);
  const objectName = file.path.slice(folder.length + 1);
  const { data: listed } = await supabase.storage.from(BUCKET).list(folder, { search: objectName, limit: 100 });
  const stored = (listed ?? []).find((o) => o.name === objectName);
  if (!stored) return { ok: false, message: "The upload did not arrive. Try again." };
  const meta = (stored.metadata ?? {}) as { size?: number; mimetype?: string };

  const { count } = await supabase
    .from("approval_files")
    .select("id", { count: "exact", head: true })
    .eq("approval_id", id);
  const name = displayFileName(file.name);
  const problem = checkFile({ name, size: Number(meta.size ?? 0) }, count ?? 0);
  if (problem) {
    await discard();
    return { ok: false, message: problem };
  }
  const { error } = await supabase.from("approval_files").insert({
    approval_id: id,
    client_id: approval.client_id,
    storage_path: file.path,
    file_name: name,
    mime_type: meta.mimetype ?? null,
    size_bytes: Number(meta.size ?? 0),
    position: count ?? 0,
  });
  if (error) {
    await discard();
    return { ok: false, message: missing(error) };
  }
  revalidatePath(`/admin/approvals/${id}`);
  return { ok: true };
}

export async function removeApprovalFile(fileId: string): Promise<Result> {
  const { supabase } = await admin();
  const { data } = await supabase.from("approval_files").select("id, approval_id, storage_path").eq("id", fileId).maybeSingle();
  const f = data as { approval_id: string; storage_path: string } | null;
  if (!f) return { ok: true };
  const { error } = await supabase.from("approval_files").delete().eq("id", fileId);
  if (error) return { ok: false, message: error.message };
  await supabase.storage.from(BUCKET).remove([f.storage_path]);
  revalidatePath(`/admin/approvals/${f.approval_id}`);
  return { ok: true };
}

/**
 * Put it in front of the client. Sending again after they asked for changes is
 * the next version, so the round goes up and the history says so.
 */
export async function sendApproval(id: string): Promise<Result> {
  const { session, supabase } = await admin();
  const { data } = await supabase.from("approvals").select("*").eq("id", id).maybeSingle();
  const a = data as Approval | null;
  if (!a) return { ok: false, message: "That piece of work no longer exists." };
  if (!a.title.trim()) return { ok: false, message: "Give it a title first." };

  const { count: fileCount } = await supabase
    .from("approval_files")
    .select("id", { count: "exact", head: true })
    .eq("approval_id", id);
  if (!a.body?.trim() && !(fileCount ?? 0)) {
    return { ok: false, message: "There's nothing to approve yet. Add the words or a file first." };
  }

  const nextRound = a.status === "draft" ? a.round : a.round + 1;
  const { error } = await supabase
    .from("approvals")
    .update({
      status: "waiting",
      round: nextRound,
      sent_at: a.sent_at ?? new Date().toISOString(),
      decided_at: null,
      decided_by: null,
    })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };

  await supabase.from("approval_events").insert({
    approval_id: id,
    client_id: a.client_id,
    kind: "sent",
    round: nextRound,
    author_id: session.clerkUserId,
    author_role: "admin",
    author_name: HARTWELL.personFirst,
  });
  await notifyClientPeople(a.client_id, "approval", {
    title: nextRound > 1 ? `Kyle has updated ${a.title}` : `Kyle needs your approval: ${a.title}`,
    body: a.note ?? (nextRound > 1 ? "Here's the next version. Have a look and approve it, or ask for more changes." : "Have a look and approve it, or ask for changes."),
    link: `/approvals/${id}`,
  });

  revalidatePath("/admin/approvals");
  revalidatePath(`/admin/approvals/${id}`);
  revalidatePath("/approvals");
  return { ok: true };
}

export async function adminComment(id: string, body: string): Promise<Result> {
  const { session, supabase } = await admin();
  const text = body.trim().slice(0, 4000);
  if (!text) return { ok: false, message: "Write something first." };
  const { data } = await supabase.from("approvals").select("id, client_id, title, status, round").eq("id", id).maybeSingle();
  const a = data as Pick<Approval, "id" | "client_id" | "title" | "status" | "round"> | null;
  if (!a) return { ok: false, message: "That piece of work no longer exists." };
  const { error } = await supabase.from("approval_events").insert({
    approval_id: id,
    client_id: a.client_id,
    kind: "comment",
    body: text,
    round: a.round,
    author_id: session.clerkUserId,
    author_role: "admin",
    author_name: HARTWELL.personFirst,
  });
  if (error) return { ok: false, message: error.message };
  // A note on a draft is Kyle talking to himself; the client hears nothing.
  if (a.status !== "draft") {
    await notifyClientPeople(a.client_id, "approval", {
      title: `Kyle commented on ${a.title}`,
      body: text.length > 200 ? `${text.slice(0, 199)}…` : text,
      link: `/approvals/${id}`,
    });
  }
  revalidatePath(`/admin/approvals/${id}`);
  return { ok: true };
}

/** Gone for good, files included. */
export async function deleteApproval(id: string): Promise<Result> {
  const { supabase } = await admin();
  const { data } = await supabase.from("approval_files").select("storage_path").eq("approval_id", id);
  const paths = ((data as { storage_path: string }[] | null) ?? []).map((f) => f.storage_path);
  const { error } = await supabase.from("approvals").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  revalidatePath("/admin/approvals");
  revalidatePath("/approvals");
  return { ok: true };
}
