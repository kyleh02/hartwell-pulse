"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, Mail, MessageSquare, Phone, ShieldOff, Sparkles, Trash2, Users } from "lucide-react";
import {
  SOURCE_LABEL,
  STAGES,
  addDays,
  nextMonday,
  shortDate,
  type Lead,
  type LeadActivity,
  type LeadSource,
  type LeadStage,
} from "@/lib/pipeline-shared";
import {
  deleteLead,
  logLeadActivity,
  moveLead,
  onboardLead,
  updateLead,
  type OnboardResult,
} from "@/app/admin/pipeline/actions";
import { celebrate } from "@/lib/celebrate";
import { BUSINESS_TZ } from "@/lib/business-time";
import { Button, buttonClasses } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2.5 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";

const KIND_ICON = { note: MessageSquare, call: Phone, email: Mail, meeting: Users } as const;

function when(iso: string) {
  return new Date(iso).toLocaleString("en-AU", { timeZone: BUSINESS_TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * One lead: who they are, when to chase them next, what has happened, and the
 * button for when they say yes.
 */
export function LeadEditor({
  lead,
  activity,
  doNotContact,
  today,
}: {
  lead: Lead;
  activity: LeadActivity[];
  doNotContact: { reason: string; recorded_at: string } | null;
  today: string;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    name: lead.name ?? "",
    business: lead.business ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    website: lead.website ?? "",
    service: lead.service ?? "",
    value: lead.value === null ? "" : String(lead.value),
    source: lead.source,
    notes: lead.notes ?? "",
    next_action: lead.next_action ?? "",
  });
  const [dirty, setDirty] = useState(false);
  const [entry, setEntry] = useState<{ kind: "note" | "call" | "email" | "meeting"; body: string }>({ kind: "call", body: "" });
  const [error, setError] = useState<string | null>(null);
  const [won, setWon] = useState(false);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setF({ ...f, [k]: e.target.value });
    setDirty(true);
  };

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.message ?? "That didn't work.");
      router.refresh();
    });
  }

  const save = () => run(async () => {
    const res = await updateLead(lead.id, f);
    if (res.ok) setDirty(false);
    return res;
  });
  const followUp = (date: string | null) => run(() => updateLead(lead.id, { follow_up_on: date }));
  const move = (stage: LeadStage) => {
    if (stage === "won") return setWon(true);
    if (stage === "lost") {
      const reason = window.prompt("Why was it lost? (optional)") ?? null;
      if (reason === null) return;
      return run(() => moveLead(lead.id, "lost", reason));
    }
    run(() => moveLead(lead.id, stage));
  };
  const logIt = () =>
    run(async () => {
      const res = await logLeadActivity(lead.id, entry.kind, entry.body);
      if (res.ok) setEntry({ ...entry, body: "" });
      return res;
    });

  const closed = lead.stage === "won" || lead.stage === "lost";

  return (
    <div className="space-y-5">
      {doNotContact && (
        <p className="flex items-start gap-2 rounded-[16px] border border-pulse-danger/40 bg-pulse-danger/10 px-4 py-3 text-sm text-pulse-text">
          <ShieldOff size={16} className="mt-0.5 shrink-0 text-pulse-danger" aria-hidden="true" />
          This address is on your do-not-contact list ({doNotContact.reason.toLowerCase()}). Don&apos;t write to them unless they
          wrote to you first.
        </p>
      )}

      {/* ---- stage ---- */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Stage">
        {STAGES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => move(s.key)}
            disabled={pending || lead.stage === s.key || (lead.stage === "won" && !!lead.client_id)}
            aria-pressed={lead.stage === s.key}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm transition-colors disabled:cursor-default",
              lead.stage === s.key
                ? s.key === "won"
                  ? "border-pulse-success/60 bg-pulse-success/15 text-pulse-text"
                  : s.key === "lost"
                    ? "border-pulse-danger/50 bg-pulse-danger/10 text-pulse-text"
                    : "border-pulse-gold/60 bg-pulse-gold/15 text-pulse-text"
                : "border-pulse-border text-pulse-text-dim hover:border-pulse-border-strong hover:text-pulse-text disabled:opacity-40",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {!closed && (
        <button
          type="button"
          onClick={() => setWon(true)}
          className="lift flex w-full items-center gap-4 rounded-[20px] border border-pulse-gold/40 bg-pulse-gold/[0.08] p-5 text-left"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-pulse-gold text-pulse-bg">
            <Sparkles size={22} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-[17px] font-extrabold tracking-[0.02em] text-pulse-text uppercase">They said yes</span>
            <span className="block text-sm text-pulse-text-dim">
              Set up their portal, send the welcome and start their onboarding, in one go.
            </span>
          </span>
        </button>
      )}
      {lead.stage === "won" && lead.client_id && (
        <p className="flex items-center gap-2 text-sm text-pulse-success">
          <CircleCheck size={16} aria-hidden="true" /> Won and onboarded.{" "}
          <Link href={`/admin/clients/${lead.client_id}/onboarding`} className="underline-offset-2 hover:underline">
            See their onboarding
          </Link>
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ---- who ---- */}
        <section className="space-y-3 rounded-[20px] border border-pulse-border bg-pulse-surface p-5">
          <h2 className="card-title">Details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className={field} placeholder="Their name" value={f.name} onChange={set("name")} />
            <input className={field} placeholder="Business" value={f.business} onChange={set("business")} />
            <input className={field} type="email" placeholder="Email" value={f.email} onChange={set("email")} />
            <input className={field} type="tel" placeholder="Phone" value={f.phone} onChange={set("phone")} />
            <input className={field} placeholder="Website" value={f.website} onChange={set("website")} />
            <input className={field} inputMode="decimal" placeholder="Worth ($)" value={f.value} onChange={set("value")} />
          </div>
          <input className={field} placeholder="What they're after" value={f.service} onChange={set("service")} />
          <select className={field} value={f.source} onChange={set("source")}>
            {(Object.keys(SOURCE_LABEL) as LeadSource[]).map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
          <textarea className={field} rows={4} placeholder="Notes" value={f.notes} onChange={set("notes")} />
          <Button variant="secondary" onClick={save} disabled={pending || !dirty}>
            {dirty ? "Save details" : "Saved"}
          </Button>
        </section>

        <div className="space-y-5">
          {/* ---- next ---- */}
          {!closed && (
            <section className="space-y-3 rounded-[20px] border border-pulse-border bg-pulse-surface p-5">
              <h2 className="card-title">Next follow-up</h2>
              <p className="text-sm text-pulse-text-dim">
                {lead.follow_up_on
                  ? lead.follow_up_on < today
                    ? `Was due ${shortDate(lead.follow_up_on)}, so it's on your dashboard now. Pick a new date once you've been in touch.`
                    : lead.follow_up_on === today
                      ? "Due today, so it's on your dashboard."
                      : `${shortDate(lead.follow_up_on)}. It lands on your dashboard that morning.`
                  : "None set, so nothing will remind you."}
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  ["Tomorrow", addDays(today, 1)],
                  ["In 3 days", addDays(today, 3)],
                  ["Next week", nextMonday(today)],
                  ["In a month", addDays(today, 30)],
                ].map(([label, date]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => followUp(date)}
                    disabled={pending}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-colors",
                      lead.follow_up_on === date
                        ? "border-pulse-gold/60 bg-pulse-gold/15 text-pulse-text"
                        : "border-pulse-border text-pulse-text-dim hover:border-pulse-border-strong hover:text-pulse-text",
                    )}
                  >
                    {label}
                  </button>
                ))}
                <input
                  type="date"
                  aria-label="Pick a date"
                  value={lead.follow_up_on ?? ""}
                  onChange={(e) => followUp(e.target.value || null)}
                  className="rounded-full border border-pulse-border bg-transparent px-3 py-1 text-sm text-pulse-text-dim"
                />
              </div>
              <input
                className={field}
                placeholder="What's the next step? e.g. send the proposal"
                value={f.next_action}
                onChange={set("next_action")}
                onBlur={() => dirty && save()}
              />
            </section>
          )}

          {/* ---- what happened ---- */}
          <section className="space-y-3 rounded-[20px] border border-pulse-border bg-pulse-surface p-5">
            <h2 className="card-title">What happened</h2>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kind">
              {(["call", "email", "meeting", "note"] as const).map((k) => {
                const Icon = KIND_ICON[k];
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={entry.kind === k}
                    onClick={() => setEntry({ ...entry, kind: k })}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm capitalize transition-colors",
                      entry.kind === k
                        ? "border-pulse-gold/60 bg-pulse-gold/15 text-pulse-text"
                        : "border-pulse-border text-pulse-text-dim hover:text-pulse-text",
                    )}
                  >
                    <Icon size={13} aria-hidden="true" /> {k}
                  </button>
                );
              })}
            </div>
            <textarea
              className={field}
              rows={2}
              placeholder={entry.kind === "note" ? "A note" : `How did the ${entry.kind} go?`}
              value={entry.body}
              onChange={(e) => setEntry({ ...entry, body: e.target.value })}
            />
            <Button size="sm" variant="secondary" onClick={logIt} disabled={pending || !entry.body.trim()}>
              Log it
            </Button>
            <ol className="space-y-3 border-t border-pulse-border pt-3">
              {activity.map((a) => (
                <li key={a.id} className="text-sm">
                  <span className="font-semibold text-pulse-text capitalize">{a.kind === "stage" ? "Moved" : a.kind}</span>{" "}
                  <span className="text-xs text-pulse-text-mute">{when(a.created_at)}</span>
                  {a.body && <p className="mt-0.5 whitespace-pre-wrap text-pulse-text-dim">{a.body}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      {error && <p className="text-sm text-pulse-danger">{error}</p>}

      <button
        type="button"
        onClick={() => {
          if (window.confirm("Delete this lead and its history for good?")) {
            run(async () => {
              const res = await deleteLead(lead.id);
              if (res.ok) router.push("/admin/pipeline");
              return res;
            });
          }
        }}
        className="inline-flex items-center gap-1.5 text-sm text-pulse-text-mute hover:text-pulse-danger"
      >
        <Trash2 size={14} aria-hidden="true" /> Delete lead
      </button>

      {won && <WonDialog lead={lead} onClose={() => setWon(false)} />}
    </div>
  );
}

/** The yes: confirm the details, then everything happens. */
function WonDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({
    businessName: lead.business ?? "",
    contactName: lead.name ?? "",
    email: lead.email ?? "",
    serviceTier: "Growth",
  });
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function go(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await onboardLead(lead.id, f);
      if (!res.ok) return setError(res.message);
      setResult(res);
      celebrate({ title: `${f.businessName} is on board`, message: "Their portal and welcome are on the way." });
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button aria-label="Close" className="absolute inset-0 bg-black/60" onClick={result ? onClose : undefined} />
      <div role="dialog" aria-label="Onboard this client" className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-[20px] border border-pulse-gold/40 bg-pulse-surface p-6">
        {result ? (
          <div className="space-y-4">
            <h2 className="text-[22px] font-extrabold tracking-[-0.01em] text-pulse-text uppercase">
              Welcome, <span className="text-pulse-gold">{f.businessName}</span>
            </h2>
            <ul className="space-y-2">
              {result.steps.map((s) => (
                <li key={s} className="flex items-start gap-2 text-sm text-pulse-text">
                  <CircleCheck size={16} className={cn("mt-0.5 shrink-0", /NOT/.test(s) ? "text-pulse-danger" : "text-pulse-success")} aria-hidden="true" />
                  {s}
                </li>
              ))}
            </ul>
            {result.tempPassword && (
              <p className="rounded-[12px] border border-pulse-warn/40 bg-pulse-warn/10 p-3 text-sm text-pulse-text">
                Their login needed a password. Give them this one, once: <span className="data-mono font-semibold">{result.tempPassword}</span>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Link href={`/admin/clients/${result.clientId}/onboarding`} className={buttonClasses("primary", "md")}>
                See their onboarding
              </Link>
              <Button variant="secondary" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={go} className="space-y-3">
            <h2 className="text-[22px] font-extrabold tracking-[-0.01em] text-pulse-text uppercase">
              They said <span className="text-pulse-gold">yes</span>
            </h2>
            <p className="text-sm text-pulse-text-dim">
              Check their details. Pressing the button creates their portal, emails them a welcome with a one-click sign-in,
              leaves a welcome message from you in their chat, starts their onboarding, and books check-in emails for day 3 and
              day 7.
            </p>
            <input className={field} placeholder="Business name" value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} required />
            <input className={field} placeholder="Contact's full name" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} required />
            <input className={field} type="email" placeholder="Their email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
            <input className={field} placeholder="Service tier" value={f.serviceTier} onChange={(e) => setF({ ...f, serviceTier: e.target.value })} />
            {error && <p className="text-xs text-pulse-danger">{error}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="submit" disabled={pending}>
                <Sparkles size={15} aria-hidden="true" /> {pending ? "Setting them up…" : "Onboard them"}
              </Button>
              <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
                Not yet
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
