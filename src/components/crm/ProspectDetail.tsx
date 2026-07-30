"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Lock, Send, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  logReply,
  logTouch,
  markOptOutActioned,
  saveContact,
  saveResearch,
} from "@/app/admin/crm/actions";
import {
  OUTCOME_LABEL,
  SEQUENCE_LABEL,
  complianceGaps,
  formatAud,
  isStale,
  stageLabel,
} from "@/lib/crm-shared";
import type { ProspectDetail as Detail } from "@/lib/crm";
import { cn } from "@/lib/utils/cn";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none";

/** The nine checks, run per send rather than ticked once and reused. */
const PRESEND = [
  ["c1", "The name is a real one from the page you screenshotted, not a bracket"],
  ["c2", "Every dollar figure, stream and project description copied verbatim"],
  ["c3", "Every 'not findable' line actually searched today"],
  ["c4", "At least one finding specific to their technical domain, not their marketing"],
  ["c5", "At least one positive finding, with the reason it is good"],
  ["c6", "Opt-out line present, worded exactly as in the template"],
  ["c7", "Address is the one published verbatim on their page, not constructed"],
  ["c8", "Screenshot of their contact page saved and dated"],
  ["c9", "One sentence here could not have been sent to any other company"],
] as const;

export function ProspectDetail({ detail }: { detail: Detail }) {
  const { organisation: o, grants, contact, research, touches, tasks } = detail;
  const router = useRouter();
  const [tab, setTab] = useState<"note" | "contact" | "history">("note");

  const gaps = complianceGaps(contact);
  const noteReady =
    !!research?.technical_domain_finding?.trim() && !!research?.positive_finding?.trim();
  const emailsSent = touches.filter(
    (t) => t.direction === "out" && t.channel === "email",
  ).length;
  const hasReply = touches.some((t) => t.direction === "in");
  const blocked =
    gaps.length > 0 ||
    !noteReady ||
    (emailsSent >= 2 && !hasReply) ||
    o.stage === "do_not_contact";

  const nextStep =
    emailsSent === 0 ? "email_1" : emailsSent === 1 ? "email_2" : "ad_hoc";

  return (
    <div className="space-y-5">
      {/* facts */}
      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="mono-label">// {o.tier ? `Tier ${o.tier}` : "Untiered"} · {o.state}</p>
              <h2 className="mt-1 text-lg font-medium text-pulse-text">
                {o.legal_name}
              </h2>
              {o.trading_name && (
                <p className="text-sm text-pulse-text-dim">
                  Trading as {o.trading_name}
                </p>
              )}
            </div>
            <Badge tone={o.stage === "do_not_contact" ? "danger" : "neutral"}>
              {stageLabel(o.stage)}
            </Badge>
          </div>

          <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Fact label="Funding" value={formatAud(Number(o.grant_total_aud))} mono />
            <Fact label="Grants" value={String(o.grant_count)} mono />
            {o.website_url && <Fact label="Site" value={o.domain ?? o.website_url} />}
            {o.platform !== "unknown" && <Fact label="Platform" value={o.platform} />}
            {o.abn && <Fact label="ABN" value={o.abn} mono />}
            {o.established_year && (
              <Fact label="Established" value={String(o.established_year)} mono />
            )}
          </dl>

          {isStale(o.last_verified_at) && o.stage !== "do_not_contact" && (
            <p className="mt-3 flex items-start gap-2 text-xs text-pulse-warn">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              The evidence here is more than 14 days old. Re-check before writing:
              a fault you cite that has since been fixed destroys credibility.
            </p>
          )}
        </Card>

        <Card className="p-4">
          <p className="mono-label">// Funded to build</p>
          <ul className="mt-2 space-y-2.5">
            {grants.map((g) => (
              <li key={g.id}>
                <p className="data-mono text-xs text-pulse-steel">
                  {formatAud(Number(g.amount))} · {g.stream}
                </p>
                <p className="mt-0.5 text-xs text-pulse-text-dim">{g.purpose}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* the send gate */}
      <SendPanel
        blocked={blocked}
        gaps={gaps}
        noteReady={noteReady}
        emailsSent={emailsSent}
        hasReply={hasReply}
        stage={o.stage}
        nextStep={nextStep}
        organisationId={o.id}
        contactId={contact?.id ?? null}
        onDone={() => router.refresh()}
      />

      {/* open tasks */}
      {tasks.length > 0 && (
        <Card className="p-4">
          <p className="mono-label">// Outstanding</p>
          <ul className="mt-2 space-y-1">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-baseline gap-2 text-sm">
                <span className="data-mono text-[11px] text-pulse-text-mute">
                  {t.due_on}
                </span>
                <span className="text-pulse-text-dim">{t.title}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* tabs */}
      <div className="inline-flex rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface p-1">
        {(
          [
            ["note", "The note"],
            ["contact", "Contact and consent"],
            ["history", `History (${touches.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "rounded-[6px] px-3 py-1.5 text-sm transition-colors",
              tab === key
                ? "bg-pulse-surface-2 text-pulse-text"
                : "text-pulse-text-dim hover:text-pulse-text",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "note" && <ResearchForm organisationId={o.id} research={research} />}
      {tab === "contact" && (
        <ContactForm organisationId={o.id} contact={contact} />
      )}
      {tab === "history" && (
        <History
          touches={touches}
          contactId={contact?.id ?? null}
          organisationId={o.id}
          optedOutNotActioned={!!contact?.opt_out_at && !contact?.opt_out_actioned_at}
          contactRowId={contact?.id ?? null}
        />
      )}
    </div>
  );
}

function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-pulse-border pb-1.5">
      <dt className="mono-label">{label}</dt>
      <dd className={cn("text-sm text-pulse-text", mono && "data-mono")}>{value}</dd>
    </div>
  );
}

function SendPanel({
  blocked,
  gaps,
  noteReady,
  emailsSent,
  hasReply,
  stage,
  nextStep,
  organisationId,
  contactId,
  onDone,
}: {
  blocked: boolean;
  gaps: string[];
  noteReady: boolean;
  emailsSent: number;
  hasReply: boolean;
  stage: string;
  nextStep: string;
  organisationId: string;
  contactId: string | null;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const allTicked = PRESEND.every(([k]) => checks[k]);
  const isSequenceEmail = nextStep === "email_1" || nextStep === "email_2";

  function submit() {
    if (!contactId) return;
    setError(null);
    startTransition(async () => {
      try {
        await logTouch({
          organisationId,
          contactId,
          channel: "email",
          sequenceStep: nextStep,
          subject,
          bodySnapshot: body,
          presendChecks: checks,
        });
        setOpen(false);
        setChecks({});
        setSubject("");
        setBody("");
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not log that.");
      }
    });
  }

  if (stage === "do_not_contact") {
    return (
      <Card className="flex items-start gap-2.5 border-pulse-danger/40 bg-pulse-danger/5 p-4">
        <Lock size={15} className="mt-0.5 shrink-0 text-pulse-danger" />
        <p className="text-sm text-pulse-text">
          This organisation is marked do not contact. That is permanent: a
          negative reply, bounce or opt-out closes it for good. Reactivation would
          need a new public fact and counts as a new first touch, never a
          continuation.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mono-label">
            // Next step · {SEQUENCE_LABEL[nextStep] ?? nextStep}
          </p>
          <p className="mt-1 text-sm text-pulse-text-dim">
            {emailsSent >= 2 && !hasReply
              ? "Two emails sent and no reply. The sequence is closed."
              : "Write and send it from Outlook, then log it here. Logging is what counts towards today's goal and books the follow-up."}
          </p>
        </div>
        <Button
          size="sm"
          disabled={blocked || !contactId}
          onClick={() => setOpen(true)}
        >
          <Send size={14} /> Log as sent
        </Button>
      </div>

      {blocked && (
        <div className="mt-3 space-y-1.5 rounded-[var(--radius-input)] border border-pulse-warn/40 bg-pulse-warn/5 px-3 py-2.5">
          <p className="mono-label text-pulse-warn">Blocked until</p>
          <ul className="space-y-0.5">
            {gaps.map((g) => (
              <li key={g} className="text-xs text-pulse-text-dim">
                · {g}
              </li>
            ))}
            {!noteReady && (
              <li className="text-xs text-pulse-text-dim">
                · A finding specific to their technical domain, and one positive
                finding
              </li>
            )}
            {emailsSent >= 2 && !hasReply && (
              <li className="text-xs text-pulse-text-dim">
                · Nothing. Two emails is the cap, and the sequence has closed.
              </li>
            )}
          </ul>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            aria-label="Close"
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div className="relative max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
            <div className="flex items-center justify-between border-b border-pulse-border px-4 py-3">
              <p className="text-sm font-medium text-pulse-text">
                Log {SEQUENCE_LABEL[nextStep] ?? "send"}
              </p>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 p-4">
              <label className="block">
                <span className="mono-label">Subject, as sent</span>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className={cn(field, "mt-1.5")}
                  placeholder="Company's public material and the land vehicle grant"
                />
              </label>
              <label className="block">
                <span className="mono-label">Body, pasted from Outlook</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={5}
                  className={cn(field, "mt-1.5")}
                  placeholder="Paste what you actually sent. If a complaint ever arrives, this is the defence."
                />
              </label>

              {isSequenceEmail && (
                <div>
                  <p className="mono-label mb-1.5">
                    Pre-send checks · {PRESEND.filter(([k]) => checks[k]).length} of 9
                  </p>
                  <ul className="space-y-1">
                    {PRESEND.map(([key, text]) => (
                      <li key={key}>
                        <label className="flex cursor-pointer items-start gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={!!checks[key]}
                            onChange={(e) =>
                              setChecks((p) => ({ ...p, [key]: e.target.checked }))
                            }
                            className="mt-0.5 accent-[var(--pulse-steel)]"
                          />
                          <span
                            className={cn(
                              checks[key]
                                ? "text-pulse-text-mute line-through"
                                : "text-pulse-text-dim",
                            )}
                          >
                            {text}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {error && (
                <p className="rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
                  {error}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-pulse-border px-4 py-3">
              <span className="text-xs text-pulse-text-mute">
                {isSequenceEmail && !allTicked
                  ? "All nine checks are required"
                  : "Ready"}
              </span>
              <Button
                size="sm"
                disabled={pending || (isSequenceEmail && !allTicked)}
                onClick={submit}
              >
                {pending ? "Logging…" : "Log it"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function ResearchForm({
  organisationId,
  research,
}: {
  organisationId: string;
  research: Detail["research"];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    verifiedOn: research?.verified_on ?? "",
    leadFinding: research?.lead_finding ?? "",
    leadFindingMethod: research?.lead_finding_method ?? "",
    technicalDomainFinding: research?.technical_domain_finding ?? "",
    positiveFinding: research?.positive_finding ?? "",
    keepOutOfFirstEmail: research?.keep_out_of_first_email ?? "",
    blocker: research?.blocker ?? "",
  });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
    setSaved(false);
  }

  function save() {
    startTransition(async () => {
      await saveResearch(organisationId, form);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Card className="space-y-3 p-4">
      <p className="text-xs text-pulse-text-mute">
        Every line is what you could not find, never what they lack. Findings are
        answered from public material only.
      </p>
      <label className="block">
        <span className="mono-label">Verified on</span>
        <input
          type="date"
          value={form.verifiedOn}
          onChange={(e) => set("verifiedOn", e.target.value)}
          className={cn(field, "mt-1.5 max-w-[12rem]")}
        />
      </label>
      <Area
        label="Lead finding"
        hint="The specific, checkable observation that opens the email"
        value={form.leadFinding}
        onChange={(v) => set("leadFinding", v)}
      />
      <Area
        label="How it was checked"
        hint="Method matters: naive keyword searching has produced false positives before"
        value={form.leadFindingMethod}
        onChange={(v) => set("leadFindingMethod", v)}
      />
      <Area
        label="Technical domain finding"
        hint="Required. Specific to their engineering, not their marketing. No finding, no send."
        value={form.technicalDomainFinding}
        onChange={(v) => set("technicalDomainFinding", v)}
        required
      />
      <Area
        label="Positive finding"
        hint="Required. Something genuinely good, with the reason it is good."
        value={form.positiveFinding}
        onChange={(v) => set("positiveFinding", v)}
        required
      />
      <Area
        label="Keep out of the first email"
        hint="Anything that would read as a scare tactic or stray outside your remit"
        value={form.keepOutOfFirstEmail}
        onChange={(v) => set("keepOutOfFirstEmail", v)}
      />
      <Area
        label="Blocker"
        hint="A failed qualification filter and how it could be cleared"
        value={form.blocker}
        onChange={(v) => set("blocker", v)}
      />
      <div className="flex items-center justify-end gap-2">
        {saved && (
          <span className="flex items-center gap-1 text-xs text-pulse-success">
            <Check size={12} /> Saved
          </span>
        )}
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save the note"}
        </Button>
      </div>
    </Card>
  );
}

function Area({
  label,
  hint,
  value,
  onChange,
  required,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mono-label">
        {label}
        {required && <span className="ml-1 text-pulse-steel">required</span>}
      </span>
      <span className="mt-0.5 block text-[11px] text-pulse-text-mute">{hint}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className={cn(field, "mt-1.5")}
      />
    </label>
  );
}

function ContactForm({
  organisationId,
  contact,
}: {
  organisationId: string;
  contact: Detail["contact"];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    firstName: contact?.first_name ?? "",
    surname: contact?.surname ?? "",
    roleTitle: contact?.role_title ?? "",
    roleSource: contact?.role_source ?? "own_site",
    roleConfirmed: contact?.role_confirmed ?? false,
    emailAsPublished: contact?.email_as_published ?? "",
    emailSourceUrl: contact?.email_source_url ?? "",
    emailVerifiedAt: contact?.email_verified_at?.slice(0, 10) ?? "",
    linkedinUrl: contact?.linkedin_url ?? "",
    screenshotPath: contact?.screenshot_path ?? "",
    noOptOutNotice: contact?.no_opt_out_notice ?? false,
    consentBasis: contact?.consent_basis ?? "inferred_published",
    relevanceNote: contact?.relevance_note ?? "",
  });

  function set<K extends keyof typeof form>(k: K, v: string | boolean) {
    setForm((p) => ({ ...p, [k]: v }));
    setSaved(false);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await saveContact(organisationId, form);
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save.");
      }
    });
  }

  return (
    <Card className="space-y-3 p-4">
      <p className="text-xs text-pulse-text-mute">
        One contact per company, ever. Inferred consent only attaches to an
        address the business itself published, so the exact string, the page it
        appeared on and the date you checked are the legal defence. The address is
        stored exactly as typed: no trimming, no lowercasing.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Text label="First name" value={form.firstName} onChange={(v) => set("firstName", v)} />
        <Text label="Surname" value={form.surname} onChange={(v) => set("surname", v)} />
        <Text label="Role title" value={form.roleTitle} onChange={(v) => set("roleTitle", v)} />
        <label className="block">
          <span className="mono-label">Where the role came from</span>
          <select
            value={form.roleSource}
            onChange={(e) => set("roleSource", e.target.value)}
            className={cn(field, "mt-1.5")}
          >
            <option value="own_site">Their own site</option>
            <option value="trade_press">Trade press</option>
            <option value="linkedin">LinkedIn</option>
            <option value="referral">Referral</option>
          </select>
        </label>
      </div>

      <Text
        label="Email exactly as published"
        value={form.emailAsPublished}
        onChange={(v) => set("emailAsPublished", v)}
        mono
      />
      <Text
        label="Source URL it was published at"
        value={form.emailSourceUrl}
        onChange={(v) => set("emailSourceUrl", v)}
        mono
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mono-label">Date verified</span>
          <input
            type="date"
            value={form.emailVerifiedAt}
            onChange={(e) => set("emailVerifiedAt", e.target.value)}
            className={cn(field, "mt-1.5")}
          />
        </label>
        <label className="block">
          <span className="mono-label">Consent basis</span>
          <select
            value={form.consentBasis}
            onChange={(e) => set("consentBasis", e.target.value)}
            className={cn(field, "mt-1.5")}
          >
            <option value="inferred_published">Inferred, published address</option>
            <option value="express">Express, they contacted you</option>
            <option value="referral">Referral</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>
      <Text
        label="Screenshot of the contact page"
        value={form.screenshotPath}
        onChange={(v) => set("screenshotPath", v)}
      />
      <Text label="LinkedIn URL" value={form.linkedinUrl} onChange={(v) => set("linkedinUrl", v)} />

      <label className="block">
        <span className="mono-label">Why this is relevant to their role</span>
        <textarea
          value={form.relevanceNote}
          onChange={(e) => set("relevanceNote", e.target.value)}
          rows={2}
          className={cn(field, "mt-1.5")}
        />
      </label>

      <div className="space-y-1.5">
        <Tick
          checked={form.roleConfirmed}
          onChange={(v) => set("roleConfirmed", v)}
          label="Role confirmed, not assumed"
        />
        <Tick
          checked={form.noOptOutNotice}
          onChange={(v) => set("noOptOutNotice", v)}
          label="Their contact page carries no notice refusing unsolicited approaches"
        />
      </div>

      {contact?.opt_out_at && (
        <OptOutRow
          contactId={contact.id}
          organisationId={organisationId}
          optOutAt={contact.opt_out_at}
          actionedAt={contact.opt_out_actioned_at}
        />
      )}

      {error && (
        <p className="rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        {saved && (
          <span className="flex items-center gap-1 text-xs text-pulse-success">
            <Check size={12} /> Saved
          </span>
        )}
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save contact"}
        </Button>
      </div>
    </Card>
  );
}

function OptOutRow({
  contactId,
  organisationId,
  optOutAt,
  actionedAt,
}: {
  contactId: string;
  organisationId: string;
  optOutAt: string;
  actionedAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/5 px-3 py-2.5">
      <p className="mono-label text-pulse-danger">Opted out</p>
      <p className="mt-1 text-xs text-pulse-text-dim">
        Recorded {optOutAt.slice(0, 10)}. The Spam Act gives five working days to
        action it, and the date actioned has to be logged.
      </p>
      {actionedAt ? (
        <p className="data-mono mt-1 text-[11px] text-pulse-success">
          Actioned {actionedAt.slice(0, 10)}
        </p>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await markOptOutActioned(contactId, organisationId);
              router.refresh();
            })
          }
          className="mt-2 rounded-[var(--radius-input)] border border-pulse-border px-2.5 py-1 text-xs text-pulse-text-dim transition-colors hover:border-pulse-border-strong hover:text-pulse-text disabled:opacity-50"
        >
          Mark actioned today
        </button>
      )}
    </div>
  );
}

function History({
  touches,
  contactId,
  organisationId,
  optedOutNotActioned,
}: {
  touches: Detail["touches"];
  contactId: string | null;
  organisationId: string;
  optedOutNotActioned: boolean;
  contactRowId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("reply_neutral");
  const [substantive, setSubstantive] = useState(false);
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="mono-label">// Every touch, in and out</p>
        {contactId && !optedOutNotActioned && (
          <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
            Log a reply
          </Button>
        )}
      </div>

      {open && contactId && (
        <div className="mt-3 space-y-2 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2/40 p-3">
          <label className="block">
            <span className="mono-label">Outcome</span>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className={cn(field, "mt-1.5")}
            >
              {Object.entries(OUTCOME_LABEL)
                .filter(([k]) => k !== "none")
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex items-start gap-2 text-xs text-pulse-text-dim">
            <input
              type="checkbox"
              checked={substantive}
              onChange={(e) => setSubstantive(e.target.checked)}
              className="mt-0.5 accent-[var(--pulse-steel)]"
            />
            Substantive: a correction, a question, or talk to me next quarter
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="What they said"
            className={field}
          />
          <p className="text-[11px] text-pulse-text-mute">
            A negative reply, bounce or opt-out closes this company permanently
            and clears its tasks.
          </p>
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await logReply(organisationId, contactId, outcome, substantive, body);
                  setOpen(false);
                  setBody("");
                  router.refresh();
                })
              }
            >
              {pending ? "Saving…" : "Save reply"}
            </Button>
          </div>
        </div>
      )}

      {touches.length === 0 ? (
        <p className="mt-2 text-sm text-pulse-text-dim">Nothing logged yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {touches.map((t) => (
            <li key={t.id} className="border-b border-pulse-border pb-3 last:border-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={cn(
                    "data-mono text-[10px] uppercase tracking-wider",
                    t.direction === "in" ? "text-pulse-success" : "text-pulse-steel",
                  )}
                >
                  {t.direction === "in" ? "in" : "out"}
                </span>
                <span className="text-sm text-pulse-text">
                  {SEQUENCE_LABEL[t.sequence_step] ?? t.sequence_step}
                </span>
                <span className="data-mono text-[11px] text-pulse-text-mute">
                  {t.sent_at.slice(0, 10)}
                </span>
                {t.outcome !== "none" && (
                  <Badge
                    tone={
                      ["reply_negative", "bounce", "opt_out"].includes(t.outcome)
                        ? "danger"
                        : "success"
                    }
                  >
                    {OUTCOME_LABEL[t.outcome as keyof typeof OUTCOME_LABEL] ?? t.outcome}
                  </Badge>
                )}
                {t.substantive && <Badge tone="gold">substantive</Badge>}
              </div>
              {t.subject && (
                <p className="mt-1 text-sm text-pulse-text-dim">{t.subject}</p>
              )}
              {t.body_snapshot && (
                <p className="mt-1 whitespace-pre-wrap text-xs text-pulse-text-mute">
                  {t.body_snapshot}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Text({
  label,
  value,
  onChange,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="mono-label">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(field, "mt-1.5", mono && "data-mono")}
      />
    </label>
  );
}

function Tick({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-xs text-pulse-text-dim">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-[var(--pulse-steel)]"
      />
      {label}
    </label>
  );
}
