"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { SECTIONS, sectionDone, type Answers } from "@/lib/onboarding-shared";
import { notifyAdmins } from "@/lib/notify";

type Result = { ok: true } | { ok: false; message: string };

function missing(err: { code?: string; message: string }): string {
  return err.code === "PGRST205" || err.code === "42P01"
    ? "Onboarding isn't switched on yet. Kyle will let you know when it is."
    : err.message;
}

async function client() {
  const session = await getPulseSession();
  if (session?.role !== "client" || !session.clientId) throw new Error("Not authorised");
  return { session, clientId: session.clientId, supabase: await createServerSupabase() };
}

/** Keep only answers shaped like answers: short strings and the access ticks. */
function clean(input: Answers): Answers {
  const out: Answers = {};
  const keys = new Set(SECTIONS.flatMap((s) => s.fields.map((f) => f.key)));
  for (const [k, v] of Object.entries(input)) {
    if (keys.has(k) && typeof v === "string") out[k] = v.slice(0, 4000);
  }
  if (input.access && typeof input.access === "object") {
    const access: NonNullable<Answers["access"]> = {};
    for (const [k, v] of Object.entries(input.access)) {
      if (/^[a-z]{2,12}$/.test(k) && v && typeof v === "object") {
        access[k] = { uses: !!v.uses, added: !!v.added };
      }
    }
    out.access = access;
  }
  return out;
}

/** Saved as they type. RLS keeps it to their own row. */
export async function saveOnboarding(answers: Answers): Promise<Result> {
  const { clientId, supabase } = await client();
  const { error } = await supabase
    .from("onboarding")
    .upsert({ client_id: clientId, answers: clean(answers) }, { onConflict: "client_id" });
  if (error) return { ok: false, message: missing(error) };
  return { ok: true };
}

export async function markKickoffBooked(): Promise<Result> {
  const { session, clientId, supabase } = await client();
  const { data } = await supabase.from("onboarding").select("kickoff_booked_at").eq("client_id", clientId).maybeSingle();
  if ((data as { kickoff_booked_at: string | null } | null)?.kickoff_booked_at) return { ok: true };
  const { error } = await supabase
    .from("onboarding")
    .upsert({ client_id: clientId, kickoff_booked_at: new Date().toISOString() }, { onConflict: "client_id" });
  if (error) return { ok: false, message: missing(error) };
  const name = await businessName(clientId);
  await notifyAdmins(clientId, "onboarding", {
    title: `${name} has booked their kickoff call`,
    body: `${session.profile?.full_name || "They"} said they've booked it. Check your calendar.`,
    link: `/admin/clients/${clientId}/onboarding`,
  });
  revalidatePath("/welcome");
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Hand the answers to Kyle: mark it submitted, tell him, and put the review on
 * his dashboard with a checklist. The work item is keyed on the client, so
 * sending it again while the review is still open does not make a second one.
 */
export async function submitOnboarding(answers: Answers): Promise<Result> {
  const { session, clientId, supabase } = await client();
  const cleaned = clean(answers);
  const required = SECTIONS.filter((s) => s.key === "business" || s.key === "goals" || s.key === "brand");
  const notDone = required.filter((s) => !sectionDone(s, cleaned, false));
  if (notDone.length) {
    return { ok: false, message: `Finish ${notDone.map((s) => s.title.toLowerCase()).join(" and ")} first.` };
  }
  const { data: before } = await supabase.from("onboarding").select("status").eq("client_id", clientId).maybeSingle();
  const firstTime = (before as { status: string } | null)?.status !== "submitted";

  const { error } = await supabase.from("onboarding").upsert(
    {
      client_id: clientId,
      answers: cleaned,
      status: "submitted",
      submitted_at: new Date().toISOString(),
      submitted_by: session.clerkUserId,
    },
    { onConflict: "client_id" },
  );
  if (error) return { ok: false, message: missing(error) };

  const name = await businessName(clientId);
  await notifyAdmins(clientId, "onboarding", {
    title: firstTime ? `${name} finished onboarding` : `${name} updated their onboarding answers`,
    body: `${session.profile?.full_name || "They"} sent their answers. Have a read before the kickoff call.`,
    link: `/admin/clients/${clientId}/onboarding`,
  });

  if (firstTime) {
    // On Kyle's dashboard, with the review as a checklist. A duplicate open
    // item is refused by the work_items unique index, which is the point.
    const admin = createAdminSupabase();
    const { data: item, error: itemErr } = await admin
      .from("work_items")
      .insert({
        title: `Review ${name}'s onboarding`,
        client_id: clientId,
        brand: "hartwell",
        due_at: new Date().toISOString(),
        source_kind: "manual",
        source_key: `onboarding:${clientId}`,
      })
      .select("id")
      .single();
    if (!itemErr && item) {
      const steps = [
        "Read their answers",
        "Check the access they've given",
        "Confirm the kickoff call",
        "Ask for any missing files",
      ];
      await admin.from("work_item_steps").insert(
        steps.map((label, position) => ({ work_item_id: (item as { id: string }).id, label, position })),
      );
    } else if (itemErr && itemErr.code !== "23505") {
      console.error("[onboarding] work item failed", itemErr.message);
    }
  }

  revalidatePath("/welcome");
  revalidatePath("/dashboard");
  return { ok: true };
}

async function businessName(clientId: string): Promise<string> {
  const { data } = await createAdminSupabase().from("clients").select("business_name").eq("id", clientId).maybeSingle();
  return (data as { business_name: string } | null)?.business_name ?? "A client";
}
