import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Measurement } from "./measure.ts";
import type { MeasurementPurpose } from "./rules.ts";

/** Private bucket for measurement screenshots (0064). Service role only. */
export const OUTREACH_BUCKET = "outreach";

/**
 * Store a measurement as the proof behind a prospect's claims, with
 * PageSpeed's phone screenshot in Storage. A screenshot that fails to upload
 * doesn't lose the measurement; the error says so.
 */
export async function storeMeasurement(
  db: SupabaseClient,
  prospectId: string,
  m: Measurement,
  purpose: MeasurementPurpose,
): Promise<{ id: string; screenshotError?: string }> {
  const first = await insertMeasurement(db, prospectId, m, purpose, m.faults);
  // A database without 0071 yet refuses the two tracking gaps: keep the
  // measurement with the faults it knows (the gaps stay in raw.tracking).
  const { data, error } =
    first.error && /faults_check/.test(first.error.message)
      ? await insertMeasurement(db, prospectId, m, purpose, m.faults.filter((f) => f !== "no_meta_pixel" && f !== "no_google_tag"))
      : first;
  if (error) throw new Error(`Couldn't store the measurement: ${error.message}`);
  const id = (data as { id: string }).id;
  return finishMeasurement(db, prospectId, id, m);
}

function insertMeasurement(db: SupabaseClient, prospectId: string, m: Measurement, purpose: MeasurementPurpose, faults: Measurement["faults"]) {
  return db
    .from("outreach_measurements")
    .insert({
      prospect_id: prospectId,
      url: m.url,
      final_url: m.finalUrl,
      purpose,
      status: m.status,
      measured_at: m.measuredAt,
      psi_fcp_ms: m.psi.fcpMs,
      psi_lcp_ms: m.psi.lcpMs,
      http_status: m.httpStatus,
      https_status: m.httpsStatus,
      https_ok: m.https === "ok",
      cert_valid: m.https === "bad_certificate" ? false : m.https === "ok" ? true : null,
      menu_links: m.menu,
      tags: { aw: m.tags.aw, meta_pixel: m.tags.metaPixel, ga4: m.tags.ga4, ua: m.tags.ua },
      pixel_pageviews: m.pixelPageViews,
      phone_in_html: !!m.phone,
      tel_link: m.telLink,
      script_built: m.scriptBuilt,
      ad_signal: m.adSignal,
      faults,
      error: m.error,
      raw: { ...m.raw, phone: m.phone, httpsOutcome: m.https, httpLoads: m.httpLoads },
    })
    .select("id")
    .single();
}

async function finishMeasurement(db: SupabaseClient, prospectId: string, id: string, m: Measurement): Promise<{ id: string; screenshotError?: string }> {
  // 0067's readings, in their own write so a database without the columns
  // still keeps the measurement (the faults themselves are in `faults`).
  await db
    .from("outreach_measurements")
    .update({ psi_cls: m.psi.cls, psi_tbt_ms: m.psi.tbtMs, mobile_viewport: m.mobileViewport })
    .eq("id", id);

  if (!m.screenshot) return { id };
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(m.screenshot);
  if (!match) return { id, screenshotError: "The screenshot wasn't an image" };
  const ext = match[1] === "image/png" ? "png" : "jpg";
  const path = `screenshots/${prospectId}/${id}.${ext}`;
  const up = await db.storage
    .from(OUTREACH_BUCKET)
    .upload(path, Buffer.from(match[2], "base64"), { contentType: match[1], upsert: false });
  if (up.error) return { id, screenshotError: up.error.message };
  await db.from("outreach_measurements").update({ screenshot_path: path }).eq("id", id);
  return { id };
}
