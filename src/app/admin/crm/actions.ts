"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { FOLLOW_UP_DAYS } from "@/lib/crm-shared";
import { SEED_ORGS, SEED_GRANTS } from "@/lib/crm-seed-data";

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
