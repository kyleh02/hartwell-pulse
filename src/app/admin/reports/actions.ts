"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { getReportMetricData } from "@/lib/reports";
import { sendReportWith, type SendReportResult } from "@/lib/reports-send";
import type { Brand } from "@/lib/types/database";
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

  // Checked, like the invoice save. An unchecked write here means the summary,
  // the recipients and the covering note silently keep their old values while
  // the page says "saved".
  const { error: repErr } = await supabase
    .from("reports")
    .update({
      title: input.title,
      summary: input.summary || null,
      recipient_user_ids: input.recipient_user_ids,
      email_message: input.email_message || null,
    })
    .eq("id", reportId);
  if (repErr) throw new Error(`Could not save the report: ${repErr.message}`);

  await supabase.from("report_sections").delete().eq("report_id", reportId);

  if (input.sections.length) {
    const rows = input.sections.map((s, i) => ({
      report_id: reportId,
      client_id: clientId,
      kind: s.kind,
      title: s.title,
      body: s.body || null,
      content: { blocks: s.blocks ?? [], pageBreak: s.pageBreak === true },
      position: i,
    }));
    const { error } = await supabase.from("report_sections").insert(rows);
    if (error) throw new Error(error.message);
  }

  revalidatePath(`/admin/reports/${reportId}`);
}

/**
 * Switch which letterhead a report is dressed in.
 *
 * The write is checked. Brand lives on a column added in migration 0030, and
 * an unchecked write is exactly how a client once received an invoice for
 * $0.00: the code shipped before the migration was run, PostgREST rejected the
 * update, and nothing said so. Fail loudly instead.
 */
export async function setReportBrand(
  reportId: string,
  brand: Brand,
): Promise<ImportResult> {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("reports")
    .update({ brand })
    .eq("id", reportId);
  if (error) {
    return {
      ok: false,
      message: `Could not change the brand: ${error.message}. If this mentions the brand column, migration 0030 has not been run yet.`,
    };
  }
  revalidatePath(`/admin/reports/${reportId}`);
  revalidatePath("/admin/reports");
  return { ok: true, id: reportId };
}

/** Email a published report to the people chosen on it. */
export async function sendReport(reportId: string): Promise<SendReportResult> {
  const { supabase } = await adminSupabase();
  const res = await sendReportWith(supabase, reportId);
  revalidatePath(`/admin/reports/${reportId}`);
  revalidatePath("/admin/reports");
  return res;
}

/**
 * The same email to Kyle, and nothing else. Reads the SAVED row rather than
 * anything on screen, so what arrives is what a client would get.
 */
export async function sendTestReport(
  reportId: string,
): Promise<SendReportResult> {
  const { supabase, session } = await adminSupabase();
  const { data: me } = await supabase
    .from("client_users")
    .select("email")
    .eq("clerk_user_id", session.clerkUserId)
    .maybeSingle();
  const to = (me as { email: string | null } | null)?.email;
  if (!to) {
    return {
      ok: false,
      message:
        "No email address on your own user record, so there is nowhere to send the test.",
    };
  }
  return sendReportWith(supabase, reportId, { testTo: to });
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

/**
 * Create a report from a Markdown draft.
 *
 * Reports get written as Markdown before they get typed into a form, so this
 * takes the draft as it stands. Level-2 headings become sections in order, and
 * anything above the first one becomes the summary, which is where the title
 * block and the at-a-glance table naturally sit.
 *
 * Tables, bold and subheadings survive: ReportText renders that subset, so what
 * was drafted is what the client reads.
 */
export type ImportResult =
  | { ok: true; id: string }
  | { ok: false; message: string };

export async function importReportMarkdown(
  clientId: string,
  periodMonth: string,
  markdown: string,
  brand: Brand = "hartwell",
): Promise<ImportResult> {
  const { supabase, session } = await adminSupabase();

  const text = markdown.replace(/\r\n/g, "\n").trim();
  if (!text) throw new Error("Paste the report first.");

  const lines = text.split("\n");
  // A leading "# Heading" is the report's own title, not a section.
  let title = `${monthLabel(periodMonth)} report`;
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (lines[i].startsWith("# ")) {
      title = lines[i].slice(2).trim();
      start = i + 1;
    }
    break;
  }

  const preamble: string[] = [];
  const sections: { title: string; body: string[] }[] = [];
  for (const line of lines.slice(start)) {
    if (line.startsWith("## ")) {
      sections.push({ title: line.slice(3).trim(), body: [] });
      continue;
    }
    if (sections.length === 0) preamble.push(line);
    else sections[sections.length - 1].body.push(line);
  }

  const tidy = (arr: string[]) =>
    arr
      .join("\n")
      // Drop the rules that separate sections in the draft: the section cards
      // already provide that separation.
      .replace(/^\s*-{3,}\s*$/gm, "")
      .trim();

  const { data: existing } = await supabase
    .from("reports")
    .select("id")
    .eq("client_id", clientId)
    .eq("period_month", periodMonth)
    .maybeSingle();
  if (existing) {
    return {
      ok: false,
      message:
        "A report already exists for that client and month. Delete it, or pick another month.",
    };
  }

  const { data: created, error } = await supabase
    .from("reports")
    .insert({
      client_id: clientId,
      period_month: periodMonth,
      title,
      status: "draft",
      brand,
      summary: tidy(preamble) || null,
      created_by: session.clerkUserId,
    })
    .select("id")
    .single();
  if (error || !created) {
    return { ok: false, message: error?.message ?? "Could not create the report." };
  }
  const reportId = (created as { id: string }).id;

  const rows = sections
    .map((sec, i) => ({
      report_id: reportId,
      client_id: clientId,
      kind: "custom" as const,
      title: sec.title,
      body: tidy(sec.body),
      content: { blocks: [] },
      position: i,
    }))
    .filter((r) => r.title || r.body);

  if (rows.length > 0) {
    const { error: sErr } = await supabase.from("report_sections").insert(rows);
    if (sErr) {
      // A report with no sections is confusing to find later. Clean up and let
      // Kyle retry rather than leaving a shell behind.
      await supabase.from("reports").delete().eq("id", reportId);
      return { ok: false, message: `Sections: ${sErr.message}` };
    }
  }

  revalidatePath("/admin/reports");
  return { ok: true, id: reportId };
}

/**
 * Permanently delete a DRAFT report.
 *
 * Drafts only, deliberately, and the check is on the stored row rather than
 * whatever the page thinks: a published report has been sent to a client and
 * may already have been read, so it should be unpublished as a considered act
 * before it can be destroyed. That mirrors how invoices work, where a sent one
 * is voided rather than deleted.
 *
 * Sections cascade away with the report. Uploaded images do not, so they are
 * swept here: an orphaned file in a private bucket is invisible and pays rent
 * forever.
 */
export async function deleteReport(reportId: string): Promise<ImportResult> {
  const { supabase } = await adminSupabase();

  const { data: report } = await supabase
    .from("reports")
    .select("id, status, client_id, title")
    .eq("id", reportId)
    .maybeSingle();
  const r = report as
    | { id: string; status: string; client_id: string; title: string }
    | null;
  if (!r) return { ok: false, message: "That report no longer exists." };
  if (r.status !== "draft") {
    return {
      ok: false,
      message:
        "Published reports cannot be deleted. Unpublish it first, which also removes it from the client's portal.",
    };
  }

  // Images live under {client_id}/{report_id}/ in the private bucket.
  const prefix = `${r.client_id}/${reportId}`;
  const { data: files } = await supabase.storage.from("pulse-reports").list(prefix);
  const paths = ((files as { name: string }[] | null) ?? []).map(
    (f) => `${prefix}/${f.name}`,
  );
  if (paths.length > 0) {
    await supabase.storage.from("pulse-reports").remove(paths);
  }

  const { error } = await supabase.from("reports").delete().eq("id", reportId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/reports");
  return { ok: true, id: reportId };
}
