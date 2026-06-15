"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { getReportMetricData } from "@/lib/reports";
import type { ReportBlock, SaveReportInput } from "@/lib/reports-shared";
import { metaFor, monthLabel } from "@/lib/metrics";

async function adminSupabase() {
  const session = await getPulseSession();
  if (session?.role !== "admin") {
    throw new Error("Not authorised");
  }
  return { supabase: await createServerSupabase(), session };
}

/**
 * Create a draft report for a client + month, pre-filled from a template: a
 * metrics section per service, then Insights and Recommendations. Redirects to
 * the editor. If a report already exists for that month, opens it instead.
 */
export async function createReportForClient(
  clientId: string,
  periodMonth: string,
) {
  const { supabase, session } = await adminSupabase();

  const { data: existing } = await supabase
    .from("reports")
    .select("id")
    .eq("client_id", clientId)
    .eq("period_month", periodMonth)
    .maybeSingle();
  if (existing) redirect(`/admin/reports/${(existing as { id: string }).id}`);

  const title = `${monthLabel(periodMonth)} report`;
  const { data: created, error } = await supabase
    .from("reports")
    .insert({
      client_id: clientId,
      period_month: periodMonth,
      title,
      status: "draft",
      created_by: session.clerkUserId,
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Could not create report");
  const reportId = (created as { id: string }).id;

  // Template: one metrics section per service, then insights + recommendations.
  const [{ data: serviceRows }, metrics] = await Promise.all([
    supabase
      .from("services")
      .select("*")
      .eq("client_id", clientId)
      .eq("enabled", true),
    getReportMetricData(supabase, clientId, periodMonth),
  ]);
  const services =
    (serviceRows as { service_key: string; display_name: string }[] | null) ??
    [];

  const sections: {
    report_id: string;
    client_id: string;
    kind: string;
    title: string;
    body: string | null;
    content: { blocks: ReportBlock[] };
    position: number;
  }[] = [];
  let position = 0;

  for (const svc of services) {
    const svcMetrics = Object.values(metrics)
      .filter((m) => m.serviceKey === svc.service_key)
      .sort((a, b) => metaFor(a.metricKey).order - metaFor(b.metricKey).order);
    if (svcMetrics.length === 0) continue;
    const blocks: ReportBlock[] = svcMetrics.map((m, i) => ({
      id: randomUUID(),
      type: "metric",
      serviceKey: m.serviceKey,
      metricKey: m.metricKey,
      chart: i === 0, // chart the lead metric
    }));
    sections.push({
      report_id: reportId,
      client_id: clientId,
      kind: "metrics",
      title: svc.display_name,
      body: null,
      content: { blocks },
      position: position++,
    });
  }

  sections.push({
    report_id: reportId,
    client_id: clientId,
    kind: "insights",
    title: "Insights",
    body: "",
    content: { blocks: [] },
    position: position++,
  });
  sections.push({
    report_id: reportId,
    client_id: clientId,
    kind: "recommendations",
    title: "Recommendations",
    body: "",
    content: { blocks: [] },
    position: position++,
  });

  if (sections.length) {
    await supabase.from("report_sections").insert(sections);
  }

  redirect(`/admin/reports/${reportId}`);
}

/** Replace the whole report body in one shot (delete sections, insert fresh). */
export async function saveReport(reportId: string, input: SaveReportInput) {
  const { supabase } = await adminSupabase();

  const { data: report } = await supabase
    .from("reports")
    .select("client_id")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) throw new Error("Report not found");
  const clientId = (report as { client_id: string }).client_id;

  await supabase.from("reports").update({ title: input.title }).eq("id", reportId);
  await supabase.from("report_sections").delete().eq("report_id", reportId);

  if (input.sections.length) {
    const rows = input.sections.map((s, i) => ({
      report_id: reportId,
      client_id: clientId,
      kind: s.kind,
      title: s.title,
      body: s.body || null,
      content: { blocks: s.blocks ?? [] },
      position: i,
    }));
    const { error } = await supabase.from("report_sections").insert(rows);
    if (error) throw new Error(error.message);
  }

  revalidatePath(`/admin/reports/${reportId}`);
}

export async function setReportStatus(
  reportId: string,
  status: "draft" | "published",
) {
  const { supabase } = await adminSupabase();
  await supabase
    .from("reports")
    .update({
      status,
      published_at: status === "published" ? new Date().toISOString() : null,
    })
    .eq("id", reportId);
  revalidatePath(`/admin/reports/${reportId}`);
  revalidatePath("/admin/reports");
}

export async function createSnippet(formData: FormData) {
  const { supabase, session } = await adminSupabase();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim() || null;
  if (!title || !body) return;
  await supabase.from("insight_snippets").insert({
    owner_user_id: session.clerkUserId,
    title,
    body,
    category,
  });
  revalidatePath("/admin/reports", "layout");
}

export async function deleteSnippet(id: string) {
  const { supabase } = await adminSupabase();
  await supabase.from("insight_snippets").delete().eq("id", id);
  revalidatePath("/admin/reports", "layout");
}

/** Upload an image to the private pulse-reports bucket; returns path + a signed URL. */
export async function uploadReportImage(
  formData: FormData,
): Promise<{ path: string; url: string }> {
  const { supabase } = await adminSupabase();
  const reportId = String(formData.get("reportId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || !reportId) {
    throw new Error("Missing file or report id");
  }

  const { data: report } = await supabase
    .from("reports")
    .select("client_id")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) throw new Error("Report not found");
  const clientId = (report as { client_id: string }).client_id;

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${clientId}/${reportId}/${randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from("pulse-reports")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);

  const { data: signed } = await supabase.storage
    .from("pulse-reports")
    .createSignedUrl(path, 60 * 60);

  return { path, url: signed?.signedUrl ?? "" };
}
