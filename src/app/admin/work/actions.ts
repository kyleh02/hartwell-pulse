"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import type { WorkSourceKind } from "@/lib/work-shared";

async function adminSupabase() {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  return { supabase: await createServerSupabase(), session };
}

type Result = { ok: true } | { ok: false; message: string };

function refresh() {
  revalidatePath("/admin");
}

/**
 * Tick something off.
 *
 * The rule that governs this: a tick may never fabricate a record with legal
 * or financial weight. So a cold email and an invoice are refused here and
 * sent to the screen that owns them, where the real act has its own confirm.
 * Everything else closes, and a CRM task closes at its source too, because a
 * LinkedIn connect being marked done is harmless and reversible.
 */
export async function completeWork(id: string): Promise<Result> {
  const { supabase } = await adminSupabase();

  const { data } = await supabase
    .from("work_items")
    .select("source_kind, source_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { ok: false, message: "That item no longer exists." };
  const item = data as { source_kind: WorkSourceKind; source_id: string | null };

  if (item.source_kind === "crm_send") {
    return {
      ok: false,
      message:
        "Sends are logged where they happen. Open the record, send it, then confirm there. The touch log is the Spam Act record and it should only ever say what actually went.",
    };
  }
  if (item.source_kind === "invoice") {
    return {
      ok: false,
      message:
        "Invoices are marked paid on the invoice, not here. Open it and set it there once the money has arrived.",
    };
  }

  const { error } = await supabase
    .from("work_items")
    .update({ state: "done", done_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };

  // Harmless and reversible, so it closes at the source too and stops the
  // reminder cron raising it again tomorrow.
  if (item.source_kind === "crm_task" && item.source_id) {
    await supabase
      .from("crm_tasks")
      .update({ done_at: new Date().toISOString() })
      .eq("id", item.source_id);
  }

  refresh();
  return { ok: true };
}

/** Put it back, for the tick that was a mis-click. */
export async function reopenWork(id: string): Promise<Result> {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("work_items")
    .update({ state: "open", done_at: null, dropped_at: null, drop_reason: null })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true };
}

/**
 * Out of the way until then. Still open, still counted, just not today.
 *
 * Snoozing also clears `asked_at`: answering "still doing this, yes, later" is
 * a fresh decision, and the question is allowed to come back if it lapses
 * again.
 */
export async function snoozeWork(id: string, until: string): Promise<Result> {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("work_items")
    .update({ snoozed_until: until, asked_at: null })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true };
}

/**
 * Not doing it.
 *
 * Dropped rather than deleted, with an optional line. A decision not to do
 * something is worth being able to read back, and "why is this not in the
 * list" six weeks later is a question with no answer if the row is gone.
 *
 * It also frees the source key, so a materially worse state of the same thing
 * can raise a fresh item later. Dropping the seven-day chase does not stop the
 * thirty-day one.
 */
export async function dropWork(id: string, reason?: string): Promise<Result> {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("work_items")
    .update({
      state: "dropped",
      dropped_at: new Date().toISOString(),
      drop_reason: reason?.trim() || null,
    })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true };
}

/** Answering the once-only "still doing this?" without changing anything else. */
export async function acknowledgeWork(id: string): Promise<Result> {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("work_items")
    .update({ asked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true };
}

export interface WorkInput {
  title: string;
  detail?: string | null;
  clientId?: string | null;
  brand?: "hartwell" | "ironpeak" | null;
  dueAt?: string | null;
  hasTime?: boolean;
  steps?: string[];
}

export async function createWork(input: WorkInput): Promise<Result & { id?: string }> {
  const { supabase, session } = await adminSupabase();
  if (!input.title.trim()) return { ok: false, message: "Give it a title." };

  const { data, error } = await supabase
    .from("work_items")
    .insert({
      title: input.title.trim(),
      detail: input.detail?.trim() || null,
      client_id: input.clientId || null,
      brand: input.brand || null,
      due_at: input.dueAt || null,
      has_time: input.hasTime ?? false,
      source_kind: "manual",
      created_by: session.clerkUserId,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, message: error?.message ?? "Could not create it." };
  }
  const id = (data as { id: string }).id;

  const steps = (input.steps ?? []).map((s) => s.trim()).filter(Boolean);
  if (steps.length > 0) {
    await supabase.from("work_item_steps").insert(
      steps.map((label, i) => ({ work_item_id: id, label, position: i })),
    );
  }

  refresh();
  return { ok: true, id };
}

export async function updateWork(
  id: string,
  patch: Partial<WorkInput>,
): Promise<Result> {
  const { supabase } = await adminSupabase();
  const fields: Record<string, unknown> = {};
  if (patch.title !== undefined) fields.title = patch.title.trim();
  if (patch.detail !== undefined) fields.detail = patch.detail?.trim() || null;
  if (patch.clientId !== undefined) fields.client_id = patch.clientId || null;
  if (patch.brand !== undefined) fields.brand = patch.brand || null;
  if (patch.dueAt !== undefined) fields.due_at = patch.dueAt || null;
  if (patch.hasTime !== undefined) fields.has_time = patch.hasTime;
  if (Object.keys(fields).length === 0) return { ok: true };

  const { error } = await supabase.from("work_items").update(fields).eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true };
}

export async function deleteWork(id: string): Promise<Result> {
  const { supabase } = await adminSupabase();
  const { error } = await supabase.from("work_items").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true };
}

/** Tick one step of a checklist. Steps never close the item on their own. */
export async function toggleStep(stepId: string, done: boolean): Promise<Result> {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("work_item_steps")
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq("id", stepId);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true };
}

export async function addStep(workItemId: string, label: string): Promise<Result> {
  const { supabase } = await adminSupabase();
  if (!label.trim()) return { ok: true };
  const { count } = await supabase
    .from("work_item_steps")
    .select("id", { count: "exact", head: true })
    .eq("work_item_id", workItemId);
  const { error } = await supabase
    .from("work_item_steps")
    .insert({ work_item_id: workItemId, label: label.trim(), position: count ?? 0 });
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true };
}

export async function deleteStep(stepId: string): Promise<Result> {
  const { supabase } = await adminSupabase();
  const { error } = await supabase.from("work_item_steps").delete().eq("id", stepId);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true };
}

/**
 * Hours, logged after the fact.
 *
 * No timer, deliberately. A running clock is a thing to forget to stop, and a
 * wrong number is worse than no number once it becomes a line on an invoice
 * at $95.
 */
export async function logHours(
  id: string,
  hours: number | null,
  note?: string,
): Promise<Result> {
  const { supabase } = await adminSupabase();
  if (hours !== null && (!Number.isFinite(hours) || hours < 0)) {
    return { ok: false, message: "Hours must be a positive number." };
  }
  const { error } = await supabase
    .from("work_items")
    .update({ hours, hours_note: note?.trim() || null })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true };
}

/**
 * Drag to reorder within a day.
 *
 * Positions are written for the whole visible group rather than just the moved
 * row: a single position among nulls is ambiguous the moment a second item is
 * dragged, and rewriting a dozen integers is cheap.
 */
export async function reorderWork(ids: string[]): Promise<Result> {
  const { supabase } = await adminSupabase();
  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase
      .from("work_items")
      .update({ position: i })
      .eq("id", ids[i]);
    if (error) return { ok: false, message: error.message };
  }
  refresh();
  return { ok: true };
}
