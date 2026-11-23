import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { AddCalendarEvent } from "@/components/admin/AddCalendarEvent";
import { buttonClasses } from "@/components/ui/Button";
import { calendarEvents, type CalEvent } from "@/lib/gcal/view";
import { addDays, melbourneDate } from "@/lib/gcal/rules";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday on or before a date. */
function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sunday
  return addDays(date, -((dow + 6) % 7));
}

function label(date: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", ...opts }).format(new Date(`${date}T00:00:00Z`));
}

/** Where a portal item's event leads in the portal. */
function pulseHref(e: CalEvent): string | null {
  if (!e.pulse) return null;
  if (e.pulse.kind === "invoice") return `/admin/invoices/${e.pulse.id}`;
  if (e.pulse.kind === "lead") return `/admin/pipeline/${e.pulse.id}`;
  return "/admin";
}

function EventLine({ e, compact = false }: { e: CalEvent; compact?: boolean }) {
  const href = pulseHref(e) ?? e.link;
  const inner = (
    <>
      {e.time && <span className="mr-1.5 font-mono text-[11px] text-pulse-text-mute">{e.time}</span>}
      <span className={cn(e.pulse && "text-pulse-gold")}>{e.title}</span>
    </>
  );
  const cls = cn(
    "block truncate rounded-[2px] px-1.5 py-0.5 hover:bg-pulse-surface-2",
    compact ? "text-[11px] leading-snug" : "text-sm leading-relaxed",
    e.allDay && "bg-pulse-surface-2",
  );
  if (!href) return <span className={cls}>{inner}</span>;
  return pulseHref(e) ? (
    <Link href={href} className={cls} title={e.title}>
      {inner}
    </Link>
  ) : (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls} title={e.title}>
      {inner}
    </a>
  );
}

const byStart = (a: CalEvent, b: CalEvent) => Number(b.allDay) - Number(a.allDay) || (a.time ?? "").localeCompare(b.time ?? "");

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; d?: string }> }) {
  const sp = await searchParams;
  const view = sp.view === "month" ? "month" : "week";
  const today = melbourneDate(new Date());
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? "") ? sp.d! : today;

  let from: string, to: string, prev: string, next: string, heading: string;
  if (view === "week") {
    from = mondayOf(anchor);
    to = addDays(from, 6);
    prev = addDays(from, -7);
    next = addDays(from, 7);
    heading = `${label(from, { day: "numeric", month: "short" })} to ${label(to, { day: "numeric", month: "short", year: "numeric" })}`;
  } else {
    const first = `${anchor.slice(0, 8)}01`;
    const nextMonth = addDays(first, 32).slice(0, 8) + "01";
    from = mondayOf(first);
    to = addDays(mondayOf(addDays(nextMonth, -1)), 6);
    prev = addDays(first, -1).slice(0, 8) + "01";
    next = nextMonth;
    heading = label(first, { month: "long", year: "numeric" });
  }

  const data = await calendarEvents(from, to);
  const days = Array.from({ length: 1 + Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) }, (_, i) => addDays(from, i));
  const eventsOn = (day: string) => (data.state === "ok" ? data.events.filter((e) => e.day <= day && e.lastDay >= day).sort(byStart) : []);
  const q = (d: string, v = view) => `/admin/calendar?view=${v}&d=${d}`;

  return (
    <div>
      <PageHeader
        label={["Calendar"]}
        title="Calendar"
        description="Your Google Calendar, with the portal's invoices, follow-ups and dated to-dos on it (in gold). Add an event here and it lands in Google."
      />

      {data.state !== "ok" ? (
        <div className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-5 text-sm leading-relaxed text-pulse-text-dim">
          {data.state === "no-table" && "Run migration 0070 in the Supabase SQL Editor, then connect your calendar in Settings."}
          {data.state === "not-connected" && (
            <>
              Your Google Calendar isn&apos;t connected yet.{" "}
              <Link href="/admin/settings" className="text-pulse-gold underline underline-offset-2">
                Connect it in Settings
              </Link>
              .
            </>
          )}
          {data.state === "error" && <>Google Calendar couldn&apos;t be read: {data.message}</>}
        </div>
      ) : (
        <>
          <div className="mb-4">
            <AddCalendarEvent today={today} />
          </div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <Link href={q(prev)} className={buttonClasses("ghost", "sm")} aria-label="Earlier">
                <ChevronLeft size={16} aria-hidden="true" />
              </Link>
              <Link href={q(today)} className={buttonClasses("secondary", "sm")}>
                Today
              </Link>
              <Link href={q(next)} className={buttonClasses("ghost", "sm")} aria-label="Later">
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
              <h2 className="ml-2 text-sm font-semibold text-pulse-text">{heading}</h2>
            </div>
            <div className="flex gap-1">
              <Link href={q(anchor, "week")} className={buttonClasses(view === "week" ? "secondary" : "ghost", "sm")}>
                Week
              </Link>
              <Link href={q(anchor, "month")} className={buttonClasses(view === "month" ? "secondary" : "ghost", "sm")}>
                Month
              </Link>
            </div>
          </div>

          {view === "week" ? (
            <div className="grid gap-2 lg:grid-cols-7">
              {days.map((day) => {
                const list = eventsOn(day);
                return (
                  <section
                    key={day}
                    className={cn(
                      "min-h-24 rounded-[var(--radius-card)] border bg-pulse-surface p-2",
                      day === today ? "border-pulse-gold/60" : "border-pulse-border",
                    )}
                  >
                    <h3 className={cn("mb-1.5 px-1.5 text-xs font-semibold", day === today ? "text-pulse-gold" : "text-pulse-text-dim")}>
                      {label(day, { weekday: "short", day: "numeric", month: "short" })}
                    </h3>
                    {list.length ? list.map((e) => <EventLine key={`${e.id}-${day}`} e={e} />) : <p className="px-1.5 text-xs text-pulse-text-mute">Nothing on</p>}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[var(--radius-card)] border border-pulse-border bg-pulse-border">
              {DAY_NAMES.map((n) => (
                <div key={n} className="bg-pulse-surface-2 px-1.5 py-1 text-center text-[11px] font-semibold text-pulse-text-dim">
                  {n}
                </div>
              ))}
              {days.map((day) => {
                const list = eventsOn(day);
                const inMonth = day.slice(0, 7) === anchor.slice(0, 7);
                return (
                  <div key={day} className={cn("min-h-20 bg-pulse-surface p-1 sm:min-h-24", !inMonth && "opacity-45")}>
                    <Link
                      href={q(day, "week")}
                      className={cn("mb-0.5 block px-1 text-[11px] font-semibold", day === today ? "text-pulse-gold" : "text-pulse-text-dim")}
                    >
                      {Number(day.slice(8))}
                    </Link>
                    {list.slice(0, 3).map((e) => (
                      <EventLine key={`${e.id}-${day}`} e={e} compact />
                    ))}
                    {list.length > 3 && (
                      <Link href={q(day, "week")} className="block px-1.5 text-[11px] text-pulse-text-mute hover:text-pulse-text">
                        +{list.length - 3} more
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-xs text-pulse-text-mute">Showing {data.email}&apos;s calendar. Edit or delete events in Google Calendar.</p>
        </>
      )}
    </div>
  );
}
