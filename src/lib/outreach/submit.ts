import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkBusiness } from "./check.ts";
import { publicVerdict } from "./match.ts";
import { fetchPage } from "./measure.ts";
import { isBlockPage } from "./measure-rules.ts";
import { addressOnPage, onOwnSite } from "./contact.ts";
import { verifySubmission, type MeasurementRow, type SubmitContext, type SubmitInput } from "./verify.ts";
import type { Fault } from "./rules.ts";
import { adsEvidenceFor } from "./ads.ts";
import { ADS_MAX_AGE_HOURS, liveAds } from "./ads-rules.ts";

/**
 * outreach_submit (Stage 4). The connector (Stage 7) calls this with the
 * service-role client after checking its token. A draft queues only when:
 *   1. the business still passes the no-repeat rule (check.ts);
 *   2. its contact address is still on the stated page of its own site, with
 *      no "no marketing" note near it (fetched again now);
 *   3. every check in verify.ts passes.
 * Otherwise nothing is stored but a "refused" event with the reasons, which
 * Claude gets back to fix. Two refusals and verify.ts tells it to drop the
 * prospect. A queued pair waits as awaiting_confirmation until Pulse has
 * measured the fault again an hour or more later (Stage 5).
 */
export async function submitDraft(
  db: SupabaseClient,
  input: SubmitInput,
  actor: "claude" | "kyle",
): Promise<{ ok: true; messageIds: { first: string; followUp: string | null } } | { ok: false; reasons: string[] }> {
  const { data: p, error: pErr } = await db
    .from("outreach_prospects")
    .select("id, status, suburb, postcode, lane_id, business_name, domain, abn, phone, services, gst_registered")
    .eq("id", input.prospect_id)
    .maybeSingle();
  if (pErr) return { ok: false, reasons: [`Couldn't read the prospect: ${pErr.message}`] };
  if (!p) return { ok: false, reasons: ["No prospect with that id."] };
  const prospect = p as {
    id: string; status: string; suburb: string | null; postcode: string | null; lane_id: number | null;
    business_name: string | null; domain: string | null; abn: string | null; phone: string | null; services: string[];
    gst_registered: boolean | null;
  };
  const evidence = await adsEvidenceFor(db, prospect.id).catch(() => []);

  const [contactRes, laneRes, templateRes, settingsRes, stateRes, measuresRes, messagesRes, refusedRes] = await Promise.all([
    db.from("outreach_contacts").select("email, first_name, address_kind, mx_provider, source_url").eq("prospect_id", prospect.id).maybeSingle(),
    prospect.lane_id === null
      ? Promise.resolve({ data: null, error: null })
      : db.from("outreach_lanes").select("id, template_version, approval_required, active").eq("id", prospect.lane_id).maybeSingle(),
    db.from("outreach_templates").select("*").eq("version", input.template_version).maybeSingle(),
    db.from("outreach_settings").select("version, opt_out_line").order("version", { ascending: false }).limit(1).maybeSingle(),
    db.from("outreach_state").select("faults_off").maybeSingle(),
    db
      .from("outreach_measurements")
      .select("id, prospect_id, url, status, measured_at, psi_fcp_ms, psi_lcp_ms, menu_links, pixel_pageviews, ad_signal, faults")
      .eq("prospect_id", prospect.id)
      .order("measured_at"),
    db.from("outreach_messages").select("id", { count: "exact", head: true }).eq("prospect_id", prospect.id),
    db.from("outreach_events").select("id", { count: "exact", head: true }).eq("prospect_id", prospect.id).eq("kind", "refused"),
  ]);
  const readErr = [contactRes, laneRes, templateRes, settingsRes, stateRes, measuresRes, messagesRes, refusedRes].find((r) => r.error)?.error;
  if (readErr) return { ok: false, reasons: [`Couldn't read what's on record: ${readErr.message}`] };
  if (!templateRes.data) return { ok: false, reasons: [`There is no template version ${input.template_version}.`] };
  if (!settingsRes.data) return { ok: false, reasons: ["Draper's settings are missing."] };

  const contact = contactRes.data as
    | { email: string | null; first_name: string | null; address_kind: string | null; mx_provider: string | null; source_url: string | null }
    | null;
  const reasons: string[] = [];

  // 1. The no-repeat rule, again, with everything on record.
  const verdict = await checkBusiness(
    db,
    {
      domain: prospect.domain,
      name: prospect.business_name,
      abn: prospect.abn,
      email: contact?.email,
      phone: prospect.phone,
      postcode: prospect.postcode,
      services: prospect.services ?? [],
    },
    { exceptProspectId: prospect.id },
  );
  if (!verdict.allowed) {
    const pub = publicVerdict(verdict);
    reasons.push(`This business is blocked${pub.reasons.length ? ` (${pub.reasons.join("; ")})` : ""}. Drop it.`);
  }

  // 2. The address, still published on the stated page of its own site.
  if (contact?.email && contact.source_url) {
    if (!prospect.domain || !onOwnSite(contact.source_url, prospect.domain)) {
      reasons.push("The contact page isn't on the business's own site.");
    } else {
      const page = await fetchPage(contact.source_url, { timeoutMs: 15_000 });
      if (page.status === null || page.status >= 400 || isBlockPage(page.status, page.html)) {
        reasons.push("Pulse couldn't read the contact page again to confirm the address, so it can't be used.");
      } else {
        const found = addressOnPage(page.html, contact.email);
        if (!found.found) reasons.push(`${contact.email} isn't on ${contact.source_url} any more.`);
        else if (found.noMarketingNearby) reasons.push("The contact page asks for no marketing near that address. Drop it.");
      }
    }
  } else if (contact) {
    reasons.push("The contact has no address or no source page on file.");
  }

  // 3. The draft itself.
  const ctx: SubmitContext = {
    prospect: { id: prospect.id, status: prospect.status, suburb: prospect.suburb, postcode: prospect.postcode, lane_id: prospect.lane_id },
    contact: contact?.email
      ? { email: contact.email, first_name: contact.first_name, address_kind: contact.address_kind, mx_provider: contact.mx_provider }
      : null,
    lane: laneRes.data as SubmitContext["lane"],
    template: templateRes.data as SubmitContext["template"],
    settings: settingsRes.data as SubmitContext["settings"],
    faultsOff: ((stateRes.data as { faults_off: Fault[] } | null)?.faults_off ?? []) as Fault[],
    measurements: (measuresRes.data as MeasurementRow[] | null) ?? [],
    existingMessages: messagesRes.count ?? 0,
    refusals: refusedRes.count ?? 0,
    ads: liveAds(evidence, new Date(), ADS_MAX_AGE_HOURS.submit),
    gstRegistered: prospect.gst_registered,
  };
  const v = verifySubmission(ctx, input);
  if (!v.ok) reasons.push(...v.reasons);

  if (reasons.length > 0 || !v.ok) {
    await db.from("outreach_events").insert({ prospect_id: prospect.id, kind: "refused", actor, detail: { reasons } });
    return { ok: false, reasons };
  }

  // Store the pair, then the claims. If the claims fail, the unsent pair is
  // removed again so a half-stored draft never waits in the queue.
  const row = (m: typeof v.first) => ({ ...m, prospect_id: prospect.id, created_by: actor });
  const { data: inserted, error: insErr } = await db
    .from("outreach_messages")
    .insert(v.followUp ? [row(v.first), row(v.followUp)] : [row(v.first)])
    .select("id, kind");
  if (insErr || !inserted) return { ok: false, reasons: [`Couldn't store the draft: ${insErr?.message ?? "no rows"}`] };
  const ids = Object.fromEntries((inserted as { id: string; kind: string }[]).map((m) => [m.kind, m.id])) as Partial<Record<"first" | "follow_up", string>> & { first: string };
  const { error: claimErr } = await db.from("outreach_claims").insert(
    v.claims.filter((c) => ids[c.message]).map((c) => ({ message_id: ids[c.message], measurement_id: c.measurement_id, fault: c.fault, slot: c.slot, quote: c.quote })),
  );
  if (claimErr) {
    await db.from("outreach_messages").delete().in("id", Object.values(ids).filter(Boolean) as string[]);
    return { ok: false, reasons: [`Couldn't store the claims: ${claimErr.message}`] };
  }
  await Promise.all([
    db.from("outreach_contacts").update({ verified_at: new Date().toISOString() }).eq("prospect_id", prospect.id),
    db.from("outreach_prospects").update({ status: "measured" }).eq("id", prospect.id).eq("status", "found"),
    db.from("outreach_events").insert({ prospect_id: prospect.id, message_id: ids.first, kind: "submitted", actor }),
  ]);
  return { ok: true, messageIds: { first: ids.first, followUp: ids.follow_up ?? null } };
}
