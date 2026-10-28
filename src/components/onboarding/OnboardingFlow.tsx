"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, CalendarCheck, Check, CircleCheck, ExternalLink, FolderOpen } from "lucide-react";
import {
  PLATFORMS,
  SECTIONS,
  answerText,
  progress,
  sectionDone,
  type Answers,
  type Field,
} from "@/lib/onboarding-shared";
import { markKickoffBooked, saveOnboarding, submitOnboarding } from "@/app/(client)/welcome/actions";
import { Button, buttonClasses } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2.5 text-base text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none sm:text-sm";

/**
 * The onboarding form, a section at a time. Answers save themselves a moment
 * after typing stops, so leaving halfway loses nothing, and the rail shows
 * what is done. Sending it to Kyle needs the business, goals and brand
 * sections; access and the kickoff call can follow later.
 */
export function OnboardingFlow({
  initial,
  submitted: initiallySubmitted,
  kickoffBooked: initiallyBooked,
  kickoffUrl,
}: {
  initial: Answers;
  submitted: boolean;
  kickoffBooked: boolean;
  kickoffUrl: string | null;
}) {
  const [answers, setAnswers] = useState<Answers>(initial);
  const [active, setActive] = useState(0);
  const [saved, setSaved] = useState<"saved" | "saving" | "error">("saved");
  const [submitted, setSubmitted] = useState(initiallySubmitted);
  const [booked, setBooked] = useState(initiallyBooked);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(answers);
  latest.current = answers;

  // Jump straight to the kickoff section from Home's link.
  useEffect(() => {
    if (window.location.hash === "#kickoff") setActive(SECTIONS.findIndex((s) => s.key === "kickoff"));
  }, []);

  function change(next: Answers) {
    setAnswers(next);
    setSaved("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const res = await saveOnboarding(latest.current);
      setSaved(res.ok ? "saved" : "error");
      if (!res.ok) setError(res.message);
    }, 700);
  }

  const set = (key: string, value: string) => change({ ...answers, [key]: value });
  const setAccess = (key: string, part: "uses" | "added", value: boolean) => {
    const access = { ...(answers.access ?? {}) };
    access[key] = { ...(access[key] ?? {}), [part]: value };
    if (part === "uses" && !value) access[key].added = false;
    change({ ...answers, access });
  };

  const section = SECTIONS[active];
  const { done, total } = progress(answers, booked);
  const canSend = SECTIONS.filter((s) => ["business", "goals", "brand"].includes(s.key)).every((s) =>
    sectionDone(s, answers, booked),
  );

  function send() {
    setError(null);
    start(async () => {
      if (timer.current) clearTimeout(timer.current);
      const res = await submitOnboarding(answers);
      if (!res.ok) return setError(res.message);
      setSubmitted(true);
      setSaved("saved");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function booking() {
    setError(null);
    start(async () => {
      const res = await markKickoffBooked();
      if (!res.ok) return setError(res.message);
      setBooked(true);
    });
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* ---- the rail ---- */}
      <nav aria-label="Onboarding sections" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <p className="mb-3 text-sm text-pulse-text-dim">
          {done} of {total} done
          <span className="ml-2 text-xs text-pulse-text-mute">
            {saved === "saving" ? "Saving…" : saved === "error" ? "Not saved" : "Saved"}
          </span>
        </p>
        <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {SECTIONS.map((s, i) => {
            const ok = sectionDone(s, answers, booked);
            return (
              <li key={s.key} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-current={i === active ? "step" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-left text-sm transition-colors",
                    i === active
                      ? "border-pulse-gold/50 bg-pulse-gold/10 text-pulse-text"
                      : "border-pulse-border text-pulse-text-dim hover:border-pulse-border-strong hover:text-pulse-text",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      ok ? "bg-pulse-success/20 text-pulse-success" : "bg-pulse-surface-2 text-pulse-text-mute",
                    )}
                  >
                    {ok ? <Check size={13} aria-label="Done" /> : i + 1}
                  </span>
                  <span className="whitespace-nowrap">{s.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* ---- the section ---- */}
      <section id={section.key} className="rounded-[20px] border border-pulse-border bg-pulse-surface p-6 sm:p-8">
        <h2 className="text-[22px] font-extrabold tracking-[-0.01em] text-pulse-text uppercase">{section.title}</h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-pulse-text-dim">{section.intro}</p>

        <div className="mt-6 space-y-5">
          {section.fields.map((f) => (
            <FieldInput key={f.key} f={f} value={answerText(answers, f.key)} onChange={(v) => set(f.key, v)} />
          ))}

          {section.key === "brand" && (
            <Link href="/assets" className={buttonClasses("secondary", "md")}>
              <FolderOpen size={15} aria-hidden="true" /> Upload your logo and photos
            </Link>
          )}

          {section.key === "access" && (
            <ul className="space-y-2">
              {PLATFORMS.map((p) => {
                const a = answers.access?.[p.key] ?? {};
                return (
                  <li key={p.key} className="rounded-[14px] border border-pulse-border bg-pulse-surface-2/50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-semibold text-pulse-text">{p.name}</p>
                      <div className="flex flex-wrap gap-2">
                        <Toggle on={!!a.uses} onClick={() => setAccess(p.key, "uses", !a.uses)}>
                          We use it
                        </Toggle>
                        <Toggle on={!!a.added} disabled={!a.uses} onClick={() => setAccess(p.key, "added", !a.added)}>
                          Kyle&apos;s been added
                        </Toggle>
                      </div>
                    </div>
                    {a.uses && !a.added && <p className="mt-2 text-xs text-pulse-text-dim">How: {p.how}.</p>}
                  </li>
                );
              })}
            </ul>
          )}

          {section.key === "kickoff" && (
            <div className="rounded-[16px] border border-pulse-gold/30 bg-pulse-gold/[0.06] p-5">
              {booked ? (
                <p className="flex items-center gap-2 text-[15px] text-pulse-text">
                  <CalendarCheck size={18} className="text-pulse-success" aria-hidden="true" /> Booked. Kyle will see you then.
                </p>
              ) : kickoffUrl ? (
                <div className="flex flex-wrap items-center gap-3">
                  <a href={kickoffUrl} target="_blank" rel="noreferrer" className={buttonClasses("primary", "md")}>
                    Choose a time <ExternalLink size={14} aria-hidden="true" />
                  </a>
                  <Button variant="secondary" onClick={booking} disabled={pending}>
                    I&apos;ve booked it
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[15px] text-pulse-text">Kyle will be in touch to find a time that suits.</p>
                  <Button variant="secondary" onClick={booking} disabled={pending}>
                    We&apos;ve set a time
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {error && <p className="mt-4 text-sm text-pulse-danger">{error}</p>}

        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-pulse-border pt-5">
          {active < SECTIONS.length - 1 && (
            <Button onClick={() => setActive(active + 1)}>
              Next: {SECTIONS[active + 1].title} <ArrowRight size={15} aria-hidden="true" />
            </Button>
          )}
          {submitted ? (
            <p className="flex items-center gap-2 text-sm text-pulse-success">
              <CircleCheck size={16} aria-hidden="true" /> Kyle has your answers. Changes you make here save straight to him.
            </p>
          ) : (
            <Button variant={active === SECTIONS.length - 1 ? "primary" : "secondary"} onClick={send} disabled={pending || !canSend}>
              {pending ? "Sending…" : "Send to Kyle"}
            </Button>
          )}
          {!submitted && !canSend && (
            <p className="text-xs text-pulse-text-mute">Finish your business, goals and brand to send it.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function FieldInput({ f, value, onChange }: { f: Field; value: string; onChange: (v: string) => void }) {
  const id = `ob-${f.key}`;
  return (
    <div>
      <label id={`${id}-label`} htmlFor={id} className="block text-sm font-semibold text-pulse-text">
        {f.label}
        {f.required && <span className="ml-1 text-pulse-gold" aria-label="required">*</span>}
      </label>
      {f.hint && <p className="mt-0.5 text-xs text-pulse-text-mute">{f.hint}</p>}
      <div className="mt-1.5">
        {f.type === "textarea" ? (
          <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={f.placeholder} className={field} />
        ) : f.type === "choice" ? (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby={`${id}-label`}>
            {f.options?.map((o) => (
              <Toggle key={o} on={value === o} onClick={() => onChange(o)}>
                {o}
              </Toggle>
            ))}
          </div>
        ) : (
          <input
            id={id}
            type={f.type === "url" ? "url" : f.type === "tel" ? "tel" : "text"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={f.placeholder}
            className={field}
          />
        )}
      </div>
    </div>
  );
}

function Toggle({
  on,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors disabled:opacity-40",
        on
          ? "border-pulse-gold/60 bg-pulse-gold/15 text-pulse-text"
          : "border-pulse-border text-pulse-text-dim hover:border-pulse-border-strong hover:text-pulse-text",
      )}
    >
      {on && <Check size={13} aria-hidden="true" />}
      {children}
    </button>
  );
}
