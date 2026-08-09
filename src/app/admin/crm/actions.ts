"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { FOLLOW_UP_DAYS } from "@/lib/crm-shared";
import { SEED_ORGS, SEED_GRANTS } from "@/lib/crm-seed-data";
import { PIPELINE_MASTER } from "@/lib/crm-pipeline-master";
import { PIPELINE_V2 } from "@/lib/crm-pipeline-v2";

/**
 * CRM actions. The crm_* tables carry an admin-only RLS policy, so these use
 * the caller's own Supabase client and let the database do the authorising as
 * well. The service role is deliberately not used: nothing here needs to cross
 * a tenancy boundary.
 */
async function adminSupabase() {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  return { supabase: await createServerSupabase(), session };
}

/** Local ISO date, N days from today. Never toISOString, which would be UTC. */
function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface SaveContactInput {
  firstName: string;
  surname: string;
  roleTitle: string;
  roleSource: string;
  roleConfirmed: boolean;
  emailAsPublished: string;
  emailSourceUrl: string;
  emailVerifiedAt: string; // ISO date
  directEmail: string;
  phone: string;
  linkedinUrl: string;
  screenshotPath: string;
  noOptOutNotice: boolean;
  consentBasis: string;
  relevanceNote: string;
}

/**
 * Create a source list. Where a prospect came from is what makes a first email
 * specific, so a new batch of names gets its own list rather than being poured
 * into the grant recipients.
 */
export async function createList(input: {
  name: string;
  description: string;
  sourceNote: string;
  capturedOn: string;
  brand: string;
}): Promise<string> {
  const { supabase } = await adminSupabase();
  const name = input.name.trim();
  if (!name) throw new Error("Give the list a name.");

  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "list";
  let slug = base;
  for (let n = 2; n < 100; n++) {
    const { data: clash } = await supabase
      .from("crm_lists")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!clash) break;
    slug = `${base}-${n}`;
  }

  const { data, error } = await supabase
    .from("crm_lists")
    .insert({
      brand: input.brand,
      slug,
      name,
      description: input.description.trim() || null,
      source_note: input.sourceNote.trim() || null,
      captured_on: input.capturedOn || null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create the list.");
  revalidatePath("/admin/crm");
  return (data as { id: string }).id;
}

/**
 * Add a company to a list by hand, for prospects that did not arrive in a
 * batch. It starts at researched like everything else: nothing has been
 * verified against their site yet.
 */
export async function addProspect(input: {
  listId: string;
  legalName: string;
  state: string;
  websiteUrl: string;
  headlinePurpose: string;
  brand: string;
}): Promise<string> {
  const { supabase } = await adminSupabase();
  const legalName = input.legalName.trim();
  if (!legalName) throw new Error("Give the company a name.");

  const { data: clash } = await supabase
    .from("crm_organisations")
    .select("id")
    .eq("brand", input.brand)
    .ilike("legal_name", legalName)
    .maybeSingle();
  if (clash) throw new Error(`${legalName} is already in the pipeline.`);

  const { data, error } = await supabase
    .from("crm_organisations")
    .insert({
      brand: input.brand,
      list_id: input.listId,
      legal_name: legalName,
      state: input.state.trim() || null,
      website_url: input.websiteUrl.trim() || null,
      headline_purpose: input.headlinePurpose.trim() || null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not add the company.");
  revalidatePath("/admin/crm");
  return (data as { id: string }).id;
}

/**
 * Create or update the single contact for an organisation. The published email
 * is written through untouched: no trim, no lowercasing. The exact string as
 * published is the evidence that inferred consent attaches to it, so
 * normalising it would quietly destroy the only thing that makes it useful.
 */
export async function saveContact(
  organisationId: string,
  input: SaveContactInput,
) {
  const { supabase } = await adminSupabase();

  const row = {
    organisation_id: organisationId,
    first_name: input.firstName.trim() || null,
    surname: input.surname.trim() || null,
    role_title: input.roleTitle.trim() || null,
    role_source: input.roleSource || null,
    role_confirmed: input.roleConfirmed,
    email_as_published: input.emailAsPublished || null,
    email_source_url: input.emailSourceUrl.trim() || null,
    email_verified_at: input.emailVerifiedAt || null,
    direct_email: input.directEmail.trim() || null,
    phone: input.phone.trim() || null,
    linkedin_url: input.linkedinUrl.trim() || null,
    screenshot_path: input.screenshotPath.trim() || null,
    no_opt_out_notice: input.noOptOutNotice,
    consent_basis: input.consentBasis,
    relevance_note: input.relevanceNote.trim() || null,
  };

  const { data: existing } = await supabase
    .from("crm_contacts")
    .select("id")
    .eq("organisation_id", organisationId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("crm_contacts")
      .update(row)
      .eq("id", (existing as { id: string }).id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("crm_contacts").insert(row);
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/admin/crm/${organisationId}`);
}

export interface SaveResearchInput {
  verifiedOn: string;
  leadFinding: string;
  leadFindingMethod: string;
  technicalDomainFinding: string;
  positiveFinding: string;
  keepOutOfFirstEmail: string;
  blocker: string;
}

/**
 * Save the note. The technical domain finding and the positive finding are the
 * two that gate a first email, so the form marks them as required and the
 * database refuses the send without them.
 */
export async function saveResearch(
  organisationId: string,
  input: SaveResearchInput,
) {
  const { supabase } = await adminSupabase();
  const row = {
    organisation_id: organisationId,
    verified_on: input.verifiedOn || null,
    lead_finding: input.leadFinding.trim() || null,
    lead_finding_method: input.leadFindingMethod.trim() || null,
    technical_domain_finding: input.technicalDomainFinding.trim() || null,
    positive_finding: input.positiveFinding.trim() || null,
    keep_out_of_first_email: input.keepOutOfFirstEmail.trim() || null,
    blocker: input.blocker.trim() || null,
  };

  const { data: existing } = await supabase
    .from("crm_research")
    .select("id")
    .eq("organisation_id", organisationId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("crm_research")
      .update(row)
      .eq("id", (existing as { id: string }).id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("crm_research").insert(row);
    if (error) throw new Error(error.message);
  }

  // Research done and evidenced moves it out of the raw grant list.
  await supabase
    .from("crm_organisations")
    .update({ last_verified_at: new Date().toISOString() })
    .eq("id", organisationId)
    .eq("stage", "researched");

  revalidatePath(`/admin/crm/${organisationId}`);
}

export interface LogTouchInput {
  organisationId: string;
  contactId: string;
  channel: string;
  sequenceStep: string;
  subject: string;
  bodySnapshot: string;
  presendChecks: Record<string, boolean>;
}

/**
 * Record something that was actually sent. Kyle sends from Outlook, so this is
 * the log rather than the send, but every guard still applies: the database
 * refuses an outbound email when the consent trail is incomplete, when the
 * contact has opted out, when the note has no technical finding, or when the
 * nine pre-send checks are not all ticked.
 *
 * Logging email 1 also books the two things that otherwise get forgotten: the
 * LinkedIn request a day later, and email 2 at day 8 to 10.
 */
export async function logTouch(input: LogTouchInput) {
  const { supabase } = await adminSupabase();

  const { error } = await supabase.from("crm_touches").insert({
    contact_id: input.contactId,
    organisation_id: input.organisationId,
    channel: input.channel,
    sequence_step: input.sequenceStep,
    direction: "out",
    subject: input.subject.trim() || null,
    body_snapshot: input.bodySnapshot.trim() || null,
    presend_checks: input.presendChecks,
  });
  if (error) throw new Error(error.message);

  const stageFor: Record<string, string> = {
    email_1: "contacted",
    linkedin_connect: "connected",
    email_2: "followed_up",
  };
  const nextStage = stageFor[input.sequenceStep];
  if (nextStage) {
    await supabase
      .from("crm_organisations")
      .update({ stage: nextStage })
      .eq("id", input.organisationId);
  }

  if (input.sequenceStep === "email_1") {
    await supabase.from("crm_tasks").insert([
      {
        organisation_id: input.organisationId,
        contact_id: input.contactId,
        kind: "linkedin_connect",
        title: "Send the LinkedIn connection request, no pitch",
        due_on: isoDaysFromNow(1),
      },
      {
        organisation_id: input.organisationId,
        contact_id: input.contactId,
        kind: "follow_up",
        title: "Email 2, then stop",
        due_on: isoDaysFromNow(FOLLOW_UP_DAYS),
      },
    ]);
  }

  // Close whatever task this send was satisfying.
  if (input.sequenceStep === "linkedin_connect" || input.sequenceStep === "email_2") {
    const kind = input.sequenceStep === "email_2" ? "follow_up" : "linkedin_connect";
    await supabase
      .from("crm_tasks")
      .update({ done_at: new Date().toISOString() })
      .eq("organisation_id", input.organisationId)
      .eq("kind", kind)
      .is("done_at", null);
  }

  revalidatePath(`/admin/crm/${input.organisationId}`);
  revalidatePath("/admin/crm");
}

/**
 * Record a reply. A negative reply, bounce or opt-out trips a database trigger
 * that sets the organisation to do not contact, stamps the opt-out and closes
 * every outstanding task, permanently.
 */
export async function logReply(
  organisationId: string,
  contactId: string,
  outcome: string,
  substantive: boolean,
  bodySnapshot: string,
) {
  const { supabase } = await adminSupabase();
  const { error } = await supabase.from("crm_touches").insert({
    contact_id: contactId,
    organisation_id: organisationId,
    channel: "reply",
    sequence_step: "inbound",
    direction: "in",
    outcome,
    substantive,
    body_snapshot: bodySnapshot.trim() || null,
  });
  if (error) throw new Error(error.message);

  const stopping = ["reply_negative", "bounce", "opt_out"].includes(outcome);
  if (!stopping) {
    await supabase
      .from("crm_organisations")
      .update({ stage: "replied" })
      .eq("id", organisationId)
      .in("stage", ["contacted", "connected", "followed_up"]);
  }
  if (outcome === "opt_out") {
    // The Spam Act gives five working days to action an opt-out, and the date
    // actioned has to be logged.
    await supabase.from("crm_tasks").insert({
      organisation_id: organisationId,
      contact_id: contactId,
      kind: "manual",
      title: "Action the opt-out and record the date, within five working days",
      due_on: isoDaysFromNow(3),
    });
  }

  revalidatePath(`/admin/crm/${organisationId}`);
  revalidatePath("/admin/crm");
}

/** Confirm an opt-out has been actioned, which is the part that must be logged. */
export async function markOptOutActioned(contactId: string, organisationId: string) {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("crm_contacts")
    .update({ opt_out_actioned_at: new Date().toISOString() })
    .eq("id", contactId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/crm/${organisationId}`);
}

export async function setStage(organisationId: string, stage: string) {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("crm_organisations")
    .update({ stage })
    .eq("id", organisationId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/crm");
  revalidatePath(`/admin/crm/${organisationId}`);
}

export async function completeTask(taskId: string) {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("crm_tasks")
    .update({ done_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/crm");
}

export async function addNote(organisationId: string, body: string) {
  const { supabase, session } = await adminSupabase();
  const text = body.trim();
  if (!text) return;
  const { error } = await supabase.from("crm_notes").insert({
    organisation_id: organisationId,
    body: text,
    author_user_id: session.clerkUserId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/crm/${organisationId}`);
}

/**
 * Import the grant recipients. Doing this through the app rather than a SQL
 * migration is deliberate: the purpose strings are long prose carrying commas,
 * semicolons and full stops, and pasting them as SQL literals into the Supabase
 * editor proved unreliable. Here the values are parameterised, so no escaping
 * is involved at all.
 *
 * Idempotent by company name and by (company, purpose), so running it twice
 * adds nothing and it is safe to press again after a partial failure.
 */
export async function importGrantRecipients(): Promise<{
  organisations: number;
  grants: number;
}> {
  const { supabase } = await adminSupabase();

  const { data: existingData, error: exErr } = await supabase
    .from("crm_organisations")
    .select("id, legal_name")
    .eq("brand", "ironpeak");
  if (exErr) throw new Error(exErr.message);
  const existing =
    (existingData as { id: string; legal_name: string }[] | null) ?? [];
  const have = new Set(existing.map((o) => o.legal_name.toLowerCase()));

  const newOrgs = SEED_ORGS.filter((o) => !have.has(o.legal_name.toLowerCase()));
  if (newOrgs.length > 0) {
    const { error } = await supabase.from("crm_organisations").insert(
      newOrgs.map((o) => ({
        brand: "ironpeak",
        legal_name: o.legal_name,
        state: o.state,
        tier: o.tier,
        grant_total_aud: o.grant_total_aud,
        grant_count: o.grant_count,
        grant_streams: o.grant_streams,
        new_capability: o.new_capability,
        headline_purpose: o.headline_purpose,
      })),
    );
    if (error) throw new Error(`Companies: ${error.message}`);
  }

  // Re-read so the id map covers rows that already existed as well as the new ones.
  const { data: allData } = await supabase
    .from("crm_organisations")
    .select("id, legal_name")
    .eq("brand", "ironpeak");
  const idByName = new Map(
    ((allData as { id: string; legal_name: string }[] | null) ?? []).map((o) => [
      o.legal_name.toLowerCase(),
      o.id,
    ]),
  );

  const { data: haveGrantsData } = await supabase
    .from("crm_grants")
    .select("organisation_id, purpose");
  const haveGrants = new Set(
    ((haveGrantsData as { organisation_id: string; purpose: string | null }[] | null) ??
      []).map((g) => `${g.organisation_id}|${g.purpose ?? ""}`),
  );

  const newGrants = SEED_GRANTS.flatMap((g) => {
    const orgId = idByName.get(g.company.toLowerCase());
    if (!orgId) return [];
    if (haveGrants.has(`${orgId}|${g.purpose}`)) return [];
    return [
      {
        organisation_id: orgId,
        amount: g.amount,
        stream: g.stream,
        purpose: g.purpose,
      },
    ];
  });
  if (newGrants.length > 0) {
    const { error } = await supabase.from("crm_grants").insert(newGrants);
    if (error) throw new Error(`Grants: ${error.message}`);
  }

  revalidatePath("/admin/crm");
  return { organisations: newOrgs.length, grants: newGrants.length };
}

/**
 * Bring Copamate and NH Micro up to where they actually are: researched, with a
 * named contact, a consent trail, and email 1 already sent on 30 July 2026. The
 * old tracker had nowhere to record any of that.
 *
 * Order matters. The touch guard checks the contact's consent fields and the
 * research findings before it will accept an outbound email, so the contact and
 * the note have to land first. That is the guard doing its job, not an
 * inconvenience.
 */
export async function importContactedTargets(): Promise<{ updated: number }> {
  const { supabase } = await adminSupabase();

  const targets = [
    {
      legalName: "Cop-A-Mate Products Pty Ltd",
      org: {
        trading_name: "Copamate",
        website_url: "https://copamate.com",
        domain: "copamate.com",
        platform: "wordpress",
        established_year: 1993,
        research_file_path:
          "H:\\My Drive\\Ironpeak Consulting Build\\target-01-copamate.md",
        last_verified_at: "2026-07-29T00:00:00+10:00",
        stage: "contacted",
      },
      research: {
        verified_on: "2026-07-29",
        lead_finding:
          "The About Us page returns HTTP 200 with Content-Length 0, so it renders as a blank white screen.",
        lead_finding_method:
          "Confirmed four ways: plain request, compressed request, and with a browser Accept header, against a control page (/rail/) that returns 102,576 bytes. Server is nginx with PHP 8.3.32.",
        technical_domain_finding:
          "Defence is named second in the homepage headline and in the intro, but it is absent from the Industries menu (Rail, Pipeline, Valves, Steel Framing, Infrastructure, Automotive) and copamate.com/defence/ returns 404, as do /defense/ and /military/. The only defence-adjacent content is Military Coatings, three levels down under Our Services.",
        positive_finding:
          "The certification list is genuinely deep for a business this size: AS9100, ISO 22163 (IRIS), ISO 9001, ISO 14001 and a long list of welding and pressure standards. That is real evidence of process maturity, and it is why the funded armour and exhaust work is credible.",
        signals: {
          platform: "WordPress",
          homepage_weight: "1,011 KB",
          copyright_year: "2026",
          capability_statement: "none published",
          note_on_cert_list:
            "AUKUS and DISP (waiting for approval) appear in the same list as standards, but neither is a standard",
        },
      },
      contact: {
        first_name: "David",
        surname: "Likar",
        role_title: "Role unconfirmed",
        role_source: "linkedin",
        role_confirmed: false,
        email_as_published: "sales@copamate.com",
        email_source_url: "https://copamate.com/contact",
        email_verified_at: "2026-07-27T00:00:00+10:00",
        no_opt_out_notice: true,
        consent_basis: "inferred_published",
        relevance_note:
          "Only a generic published address is available, so the note is addressed to a named person at sales@. No individual is named anywhere on the site.",
      },
      subject: "Copamate's public material and the land vehicle grant",
      sentAt: "2026-07-30T10:00:00+10:00",
    },
    {
      legalName: "NH Micro Pty Ltd",
      org: {
        website_url: "https://www.nhmicro.com",
        domain: "www.nhmicro.com",
        platform: "wix",
        abn: "38 647 568 250",
        established_year: 2020,
        research_file_path:
          "H:\\My Drive\\Ironpeak Consulting Build\\target-02-nhmicro.md",
        last_verified_at: "2026-07-30T00:00:00+10:00",
        stage: "contacted",
      },
      research: {
        verified_on: "2026-07-30",
        lead_finding:
          'There are zero occurrences of "defence" or "defense" in visible text on any page. The published sector list runs Scientific Instruments, Micro-mechanics, Photonics and Optics, Semi-conductor, Medical components, High frequency communication, Microfluidics and Space Industry.',
        lead_finding_method:
          "A naive source search falsely returned DISP, ITAR, AS9100 and ISO 9001 matches, all of which were Wix bundle artefacts (disp matching inside display). Stripping scripts and tags first gives zero visible occurrences. Never keyword-match Wix source.",
        technical_domain_finding:
          "The live capabilities page is /capabilties, missing the second i, and their own menu points at the misspelling. The correctly spelled /capabilities returns 404. It is a five minute Wix redirect fix.",
        positive_finding:
          "They publish specific tolerance figures rather than adjectives, sub-micron and plus or minus 2 micron form accuracy, and name machines by model: Kern Micro HD, Pyramid Nano, Makino U32j, Citizen R04. The /examples page shows real parts. That is exactly the evidence a technical buyer wants.",
        keep_out_of_first_email:
          "Do not raise, cold, that published photographs of guided weapons or in-space propulsion parts might be an export control concern. It reads as a scare tactic and their obligations cannot be known from outside. No legal, export control or classification advice, ever.",
        signals: {
          platform: "Wix",
          site_page_count: "4 (home, /capabilties, /examples, /contact)",
          about_page: "404, no about page",
          copyright_year: "2025, a year stale",
          quality_certifications:
            "none published, /quality and /certifications both 404",
        },
      },
      contact: {
        first_name: "Josh",
        surname: "Hacko",
        role_title: "Technical Director",
        role_source: "trade_press",
        role_confirmed: false,
        email_as_published: "mail@nhmicro.com",
        email_source_url: "https://www.nhmicro.com/contact",
        email_verified_at: "2026-07-30T00:00:00+10:00",
        no_opt_out_notice: true,
        consent_basis: "inferred_published",
        relevance_note:
          "He is the co-owner and operator, and the person trade press quotes on the move into defence, so the funded ballscrew and control actuation work sits directly with him.",
      },
      subject: "NH Micro's public material and the guided weapons grant",
      sentAt: "2026-07-30T11:00:00+10:00",
    },
  ];

  const ticked = {
    c1: true, c2: true, c3: true, c4: true, c5: true,
    c6: true, c7: true, c8: true, c9: true,
  };

  let updated = 0;
  for (const t of targets) {
    const { data: orgRow } = await supabase
      .from("crm_organisations")
      .select("id")
      .eq("brand", "ironpeak")
      .ilike("legal_name", t.legalName)
      .maybeSingle();
    const orgId = (orgRow as { id: string } | null)?.id;
    if (!orgId) continue; // import the grant list first

    await supabase.from("crm_organisations").update(t.org).eq("id", orgId);

    const { data: haveResearch } = await supabase
      .from("crm_research")
      .select("id")
      .eq("organisation_id", orgId)
      .maybeSingle();
    if (!haveResearch) {
      const { error } = await supabase
        .from("crm_research")
        .insert({ organisation_id: orgId, ...t.research });
      if (error) throw new Error(`${t.legalName} note: ${error.message}`);
    }

    const { data: haveContact } = await supabase
      .from("crm_contacts")
      .select("id")
      .eq("organisation_id", orgId)
      .maybeSingle();
    let contactId = (haveContact as { id: string } | null)?.id;
    if (!contactId) {
      const { data, error } = await supabase
        .from("crm_contacts")
        .insert({ organisation_id: orgId, ...t.contact })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`${t.legalName} contact: ${error?.message ?? "failed"}`);
      }
      contactId = (data as { id: string }).id;
    }

    const { count } = await supabase
      .from("crm_touches")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", orgId)
      .eq("sequence_step", "email_1");
    if ((count ?? 0) === 0) {
      const { error } = await supabase.from("crm_touches").insert({
        contact_id: contactId,
        organisation_id: orgId,
        channel: "email",
        sequence_step: "email_1",
        direction: "out",
        sent_at: t.sentAt,
        subject: t.subject,
        presend_checks: ticked,
      });
      if (error) throw new Error(`${t.legalName} email 1: ${error.message}`);

      await supabase.from("crm_tasks").insert({
        organisation_id: orgId,
        contact_id: contactId,
        kind: "follow_up",
        title: `Email 2 for ${t.legalName}, then stop`,
        due_on: "2026-08-08",
      });
    }
    updated++;
  }

  // NH Micro's LinkedIn request was still outstanding when the emails went out.
  const { data: nh } = await supabase
    .from("crm_organisations")
    .select("id")
    .eq("brand", "ironpeak")
    .ilike("legal_name", "NH Micro Pty Ltd")
    .maybeSingle();
  const nhId = (nh as { id: string } | null)?.id;
  if (nhId) {
    const { count } = await supabase
      .from("crm_tasks")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", nhId)
      .eq("kind", "linkedin_connect");
    if ((count ?? 0) === 0) {
      await supabase.from("crm_tasks").insert({
        organisation_id: nhId,
        kind: "linkedin_connect",
        title: "LinkedIn connection request for Josh Hacko, NH Micro",
        due_on: "2026-07-31",
      });
    }
  }

  revalidatePath("/admin/crm");
  return { updated };
}

/**
 * Apply the researched pipeline master over the existing prospects.
 *
 * Deliberately an update, not a wipe and reload. The company list is identical,
 * so clearing first would delete and immediately recreate the same 59 rows,
 * taking with them the things the CSV does not carry: the research notes, and
 * the logged sends with their dates. That touch log is the Spam Act defence, so
 * it is the one thing that must survive a refresh of the list.
 *
 * Qualification maps onto stage like this:
 *   skip      -> lost, carrying the reason it was ruled out
 *   contacted -> contacted, but only if nothing further has happened already
 *   others    -> verified when a named contact and published address exist,
 *                researched when they do not
 *
 * A company already further along than the CSV says is left where it is: the
 * portal knows about replies the spreadsheet does not.
 */
export async function syncPipelineMaster(): Promise<{
  updated: number;
  contacts: number;
  needSourceUrl: number;
  skipped: number;
}> {
  const { supabase } = await adminSupabase();

  const { data: orgData, error: oErr } = await supabase
    .from("crm_organisations")
    .select("id, legal_name, stage")
    .eq("brand", "ironpeak");
  if (oErr) throw new Error(oErr.message);
  const orgs = (orgData as { id: string; legal_name: string; stage: string }[] | null) ?? [];
  const byName = new Map(orgs.map((o) => [o.legal_name.toLowerCase(), o]));

  // Stages that mean real contact has happened. Never walk one of these back
  // to match a spreadsheet.
  const AHEAD = [
    "connected", "followed_up", "replied", "conversation",
    "proposal", "won", "delivered", "do_not_contact",
  ];

  let updated = 0;
  let contacts = 0;
  let needSourceUrl = 0;
  let skipped = 0;

  for (const row of PIPELINE_MASTER) {
    const org = byName.get(row.company.toLowerCase());
    if (!org) continue;

    const hasContact = !!row.published_email && !!row.contact_name;
    let stage: string;
    if (row.status === "skip") stage = "lost";
    else if (row.status === "contacted") stage = "contacted";
    else stage = hasContact ? "verified" : "researched";

    // The portal may know more than the sheet does.
    if (AHEAD.includes(org.stage)) stage = org.stage;
    if (row.status === "skip") skipped++;

    const { error } = await supabase
      .from("crm_organisations")
      .update({
        state: row.state || null,
        tier: row.tier || null,
        grant_total_aud: row.grant_total_aud,
        grant_streams: row.streams,
        new_capability: row.new_capability,
        headline_purpose: row.headline_purpose || null,
        domain: row.domain || null,
        website_url: row.domain ? `https://${row.domain}` : null,
        research_file_path: row.research_file || null,
        source_status: row.status || null,
        next_action: row.next_action || null,
        stage,
        lost_reason: row.status === "skip" ? row.next_action || "Outside the filter" : null,
      })
      .eq("id", org.id);
    if (error) throw new Error(`${row.company}: ${error.message}`);
    updated++;

    if (!hasContact) continue;

    const parts = row.contact_name.trim().split(/\s+/);
    const first = parts[0] ?? null;
    const surname = parts.length > 1 ? parts.slice(1).join(" ") : null;

    const { data: existing } = await supabase
      .from("crm_contacts")
      .select("id, email_source_url")
      .eq("organisation_id", org.id)
      .maybeSingle();

    // The CSV carries no source URL, and that field is the evidence inferred
    // consent rests on. Guessing it from the domain would be fabricating the
    // one thing that has to be checkable, so it is left for Kyle to fill and
    // an existing one is never overwritten.
    const base = {
      first_name: first,
      surname,
      role_title: row.contact_title || null,
      email_as_published: row.published_email,
      email_verified_at: row.status_date ? `${row.status_date}T00:00:00+10:00` : null,
      consent_basis: "inferred_published",
      relevance_note:
        row.next_action ||
        `Funded to ${row.headline_purpose || "build new capability"}.`,
    };

    if (existing) {
      const e = existing as { id: string; email_source_url: string | null };
      const { error: cErr } = await supabase
        .from("crm_contacts")
        .update(base)
        .eq("id", e.id);
      if (cErr) throw new Error(`${row.company} contact: ${cErr.message}`);
      if (!e.email_source_url) needSourceUrl++;
    } else {
      const { error: cErr } = await supabase
        .from("crm_contacts")
        .insert({ organisation_id: org.id, ...base });
      if (cErr) throw new Error(`${row.company} contact: ${cErr.message}`);
      needSourceUrl++;
    }
    contacts++;
  }

  revalidatePath("/admin/crm");
  return { updated, contacts, needSourceUrl, skipped };
}

/**
 * Delete the companies that were ruled out, leaving only those verified or
 * already contacted.
 *
 * Two guards, because this is not reversible from inside the portal. Only
 * organisations at stage 'lost' are eligible, and any with a logged touch is
 * kept regardless: something that was written to has a compliance record, and
 * that record outranks a tidy list. Everything else cascades away with the
 * company, which is what makes it a real removal rather than a hidden row.
 *
 * The list itself is not lost. src/lib/crm-pipeline-master.ts still holds all
 * 59 with their skip reasons, so a company can be brought back deliberately.
 */
export async function removeRuledOut(
  brand = "ironpeak",
): Promise<{ removed: number; keptWithHistory: number }> {
  const { supabase } = await adminSupabase();

  const { data: lostData, error: lErr } = await supabase
    .from("crm_organisations")
    .select("id")
    .eq("brand", brand)
    .eq("stage", "lost");
  if (lErr) throw new Error(lErr.message);
  const lost = ((lostData as { id: string }[] | null) ?? []).map((o) => o.id);
  if (lost.length === 0) return { removed: 0, keptWithHistory: 0 };

  // Anything ever written to keeps its record, whatever the list says.
  const { data: touched } = await supabase
    .from("crm_touches")
    .select("organisation_id")
    .in("organisation_id", lost);
  const hasHistory = new Set(
    ((touched as { organisation_id: string }[] | null) ?? []).map(
      (t) => t.organisation_id,
    ),
  );

  const deletable = lost.filter((id) => !hasHistory.has(id));
  if (deletable.length > 0) {
    const { error } = await supabase
      .from("crm_organisations")
      .delete()
      .in("id", deletable);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/admin/crm");
  return { removed: deletable.length, keptWithHistory: hasHistory.size };
}

export async function saveCrmGoals(daily: number, weekly: number) {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("crm_settings")
    .update({
      daily_contact_goal: Math.max(0, Math.floor(daily)),
      weekly_contact_goal: Math.max(0, Math.floor(weekly)),
    })
    .eq("id", true);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/crm");
}

/**
 * Replace the whole Ironpeak pipeline with the 7 August 2026 handoff.
 *
 * REPLACE, not merge. The earlier datasets held 76 records of which 51 were
 * triaged out, and the offer was repositioned from capability statements to
 * websites, so almost every hook changed. Merging would leave ruled-out
 * companies sitting alongside live ones and old capability-statement hooks
 * attached to records whose email now leads with a website fault.
 *
 * The one thing not thrown away is the touch log. Fourteen of these companies
 * have already been emailed, and those sends are the Spam Act record. So a
 * company that already exists is UPDATED in place, keeping its id and
 * therefore its touches, and only companies absent from the new list are
 * deleted. A deleted company with a logged send is kept regardless: a
 * compliance record outranks a tidy list.
 */
export async function replacePipeline(): Promise<{
  updated: number;
  created: number;
  removed: number;
  keptWithHistory: number;
}> {
  const { supabase } = await adminSupabase();

  const { data: orgData, error: oErr } = await supabase
    .from("crm_organisations")
    .select("id, legal_name, stage")
    .eq("brand", "ironpeak");
  if (oErr) throw new Error(oErr.message);
  const existing =
    (orgData as { id: string; legal_name: string; stage: string }[] | null) ?? [];

  // Stages that mean contact has actually happened. The file is a plan and the
  // portal is the record of what was done, so the portal wins on these. Without
  // this, re-syncing after a send would reset that company to "queued" with its
  // email body restored, and the same email could go to the same person twice.
  const AHEAD = new Set([
    "contacted", "connected", "followed_up", "replied", "conversation",
    "proposal", "won", "delivered",
    "declined", "bounced", "stopped", "do_not_contact",
  ]);
  const byName = new Map(existing.map((o) => [o.legal_name.toLowerCase(), o]));

  const keepNames = new Set(PIPELINE_V2.map((r) => r.company.toLowerCase()));

  let updated = 0;
  let created = 0;

  for (const row of PIPELINE_V2) {
    const org = byName.get(row.company.toLowerCase());
    const orgFields = {
      brand: "ironpeak",
      legal_name: row.company,
      state: row.state,
      domain: row.domain === "NO WEBSITE" ? null : row.domain,
      website_url:
        row.domain === "NO WEBSITE" ? null : `https://${row.domain}`,
      rank: row.rank,
      priority_tier: row.tier,
      channel: row.channel,
      stage: org && AHEAD.has(org.stage) ? org.stage : row.stage,
      // sendImmediately means "on receipt, override the window", which is a
      // time already past rather than a special case for the sender to know
      // about. Coastal Aviation's compromised site is the only one.
      scheduled_send_at:
        org && AHEAD.has(org.stage)
          ? null
          : (row.scheduledSendAt ??
            (row.sendImmediately ? new Date().toISOString() : null)),
      followup_due: row.followupDue ?? null,
      hook: row.hook,
      hook_verified_at: row.hookVerified,
      pipeline_notes: row.notes,
      hard_warning: row.hardWarning ?? null,
      source_status: row.stage,
      email_subject: row.emailSubject,
      // Only a "ready" email is loaded into the outbox. "held" and
      // "not-written" records carry their blocker instead, so there is nothing
      // sitting there that could be approved by accident.
      email_body:
        org && AHEAD.has(org.stage)
          ? null
          : row.emailStatus === "ready"
            ? row.emailBody
            : null,
      // Replacing the data always clears approval. An email that changed is
      // not the email that was read and approved.
      send_approved_at: null,
      send_error: row.emailBlocker,
      next_action:
        row.emailStatus === "ready"
          ? "Approve the email so it sends at its scheduled time"
          : row.emailBlocker ?? null,
    };

    let orgId: string;
    if (org) {
      const { error } = await supabase
        .from("crm_organisations")
        .update(orgFields)
        .eq("id", org.id);
      if (error) throw new Error(`${row.company}: ${error.message}`);
      orgId = org.id;
      updated++;
    } else {
      const { data: made, error } = await supabase
        .from("crm_organisations")
        .insert(orgFields)
        .select("id")
        .single();
      if (error || !made) {
        throw new Error(`${row.company}: ${error?.message ?? "insert failed"}`);
      }
      orgId = (made as { id: string }).id;
      created++;
    }

    // ---- the single contact ----
    const parts = row.contactName.trim().split(/\s+/);
    const contactFields = {
      first_name: parts[0] ?? null,
      surname: parts.length > 1 ? parts.slice(1).join(" ") : null,
      name_verified: row.nameVerified,
      fallback_greeting: row.fallbackGreeting ?? null,
      // Verbatim. Never trimmed or lowercased: the exact string as published
      // is the evidence.
      email_as_published: row.email,
      email_source_note: row.emailSourceNote,
      // Everything in this file was confirmed published on the company's own
      // site on 7 August 2026, with Tynbell the one exception, and Tynbell is
      // blocked so it cannot send anyway.
      email_verified_at: "2026-08-07T00:00:00+10:00",
      consent_basis: "inferred_published",
      relevance_note:
        row.channel === "DIDG"
          ? "Received a Defence Industry Development Grant."
          : "Named as a subcontractor in a public Australian Industry Capability plan on defence.gov.au.",
      is_sole_contact_for_org: true,
    };

    const { data: had } = await supabase
      .from("crm_contacts")
      .select("id")
      .eq("organisation_id", orgId)
      .maybeSingle();

    if (had) {
      const { error } = await supabase
        .from("crm_contacts")
        .update(contactFields)
        .eq("id", (had as { id: string }).id);
      if (error) throw new Error(`${row.company} contact: ${error.message}`);
    } else {
      const { error } = await supabase
        .from("crm_contacts")
        .insert({ organisation_id: orgId, ...contactFields });
      if (error) throw new Error(`${row.company} contact: ${error.message}`);
    }
  }

  // ---- remove everything the new list does not carry ----
  let removed = 0;
  let keptWithHistory = 0;

  for (const o of existing) {
    if (keepNames.has(o.legal_name.toLowerCase())) continue;
    const { count } = await supabase
      .from("crm_touches")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", o.id);
    if ((count ?? 0) > 0) {
      keptWithHistory++;
      await supabase
        .from("crm_organisations")
        .update({
          stage: "lost",
          lost_reason: "Not in the 7 August 2026 pipeline. Kept: has a logged send.",
        })
        .eq("id", o.id);
      continue;
    }
    const { error } = await supabase
      .from("crm_organisations")
      .delete()
      .eq("id", o.id);
    if (error) throw new Error(`Removing ${o.legal_name}: ${error.message}`);
    removed++;
  }

  revalidatePath("/admin/crm");
  return { updated, created, removed, keptWithHistory };
}

/**
 * Mark a queued record as drafted or scheduled in Outlook.
 *
 * Separate from logging the send, deliberately. Kyle writes and schedules
 * ahead of time and Outlook sends later, so one flag could only ever be a lie
 * in one direction: either claiming an email went out while it sits in a
 * drafts folder, or losing the work of having written it. Logging the actual
 * send stays the thing that advances the stage, counts toward the daily goal
 * and stands as the Spam Act record.
 */
export async function setScheduled(
  organisationId: string,
  scheduled: boolean,
): Promise<void> {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("crm_organisations")
    .update({ scheduled_at: scheduled ? new Date().toISOString() : null })
    .eq("id", organisationId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/plan");
}

/** The email that will go out, saved on the record. */
export async function saveOutreachEmail(
  organisationId: string,
  subject: string,
  body: string,
): Promise<void> {
  const { supabase } = await adminSupabase();
  // Editing the email un-approves it. Approval means "I read this and it may
  // go"; a body that changed afterwards was never the thing that was read.
  const { error } = await supabase
    .from("crm_organisations")
    .update({
      email_subject: subject.trim() || null,
      email_body: body.trim() || null,
      send_approved_at: null,
      send_error: null,
    })
    .eq("id", organisationId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/crm/${organisationId}`);
  revalidatePath("/admin/crm/plan");
}

export type ApproveResult =
  | { ok: true; scheduledFor: string | null }
  | { ok: false; message: string };

/**
 * Approve an email to be sent automatically at its scheduled time.
 *
 * The nine pre-send checks are ticked HERE, not at send time, because nobody
 * is at the keyboard at 8:47 in the morning. That is the honest place for them:
 * a checklist confirmed by a machine on a human's behalf is not a check.
 *
 * It runs the guard as a dry run before accepting, so a record that would be
 * refused at send time is refused now, while there is someone to read why.
 */
export async function approveForSending(
  organisationId: string,
  checks: Record<string, boolean>,
): Promise<ApproveResult> {
  const { supabase } = await adminSupabase();

  const ticked = Object.values(checks).filter(Boolean).length;
  if (ticked < 9) {
    return {
      ok: false,
      message: `All nine pre-send checks have to be ticked. ${ticked} of 9 are.`,
    };
  }

  const { data: row } = await supabase
    .from("crm_organisations")
    .select("email_subject, email_body, scheduled_send_at, stage, crm_contacts(id)")
    .eq("id", organisationId)
    .maybeSingle();
  const org = row as {
    email_subject: string | null;
    email_body: string | null;
    scheduled_send_at: string | null;
    stage: string;
    crm_contacts: { id: string }[] | null;
  } | null;
  if (!org) return { ok: false, message: "That record no longer exists." };
  if (!org.email_subject || !org.email_body) {
    return { ok: false, message: "Write the subject and the email first." };
  }
  if (!org.scheduled_send_at) {
    return { ok: false, message: "Give it a send time first." };
  }
  const contactId = org.crm_contacts?.[0]?.id;
  if (!contactId) return { ok: false, message: "No contact on this record." };

  // Ask the guard now, while there is somebody here to read the answer.
  const { error: dryErr } = await supabase.rpc("crm_dry_run_touch", {
    p_contact_id: contactId,
    p_checks: checks,
  });
  if (dryErr) return { ok: false, message: dryErr.message };

  const { error } = await supabase
    .from("crm_organisations")
    .update({
      send_approved_at: new Date().toISOString(),
      send_approved_checks: checks,
      send_error: null,
    })
    .eq("id", organisationId);
  if (error) return { ok: false, message: error.message };

  revalidatePath(`/admin/crm/${organisationId}`);
  revalidatePath("/admin/crm/plan");
  return { ok: true, scheduledFor: org.scheduled_send_at };
}

/** Take an approved email back out of the outbox. */
export async function unapproveSending(organisationId: string): Promise<void> {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("crm_organisations")
    .update({ send_approved_at: null })
    .eq("id", organisationId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/crm/${organisationId}`);
  revalidatePath("/admin/crm/plan");
}

/** Move a send to a different minute. Never on the hour or the half hour. */
export async function setScheduledSendAt(
  organisationId: string,
  iso: string | null,
): Promise<void> {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("crm_organisations")
    .update({ scheduled_send_at: iso, send_approved_at: null })
    .eq("id", organisationId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/crm/plan");
}
