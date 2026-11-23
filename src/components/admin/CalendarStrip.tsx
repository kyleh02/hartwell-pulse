import Link from "next/link";
import { calendarEvents, type CalEvent } from "@/lib/gcal/view";
import { addDays, melbourneDate } from "@/lib/gcal/rules";
import { cn } from "@/lib/utils/cn";

function Day({ name, events }: { name: string; events: CalEvent[] }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-1 text-xs font-semibold text-pulse-text-dim">{name}</h3>
      {events.length ? (
        <ul className="grid gap-0.5">
          {events.map((e) => (
            <li key={e.id} className="truncate text-sm leading-relaxed text-pulse-text">
              <span className="mr-1.5 inline-block w-14 font-mono text-[11px] text-pulse-text-mute">{e.time ?? "All day"}</span>
              <span className={cn(e.pulse && "text-pulse-gold")}>{e.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-pulse-text-mute">Nothing on</p>
      )}
    </div>
  );
}

/** Today and tomorrow from Google Calendar, on the dashboard. Nothing at all until it's connected. */
export async function CalendarStrip() {
  const today = melbourneDate(new Date());
  const tomorrow = addDays(today, 1);
  const data = await calendarEvents(today, tomorrow);
  if (data.state === "no-table" || data.state === "not-connected") return null;
  const on = (day: string) =>
    data.state === "ok"
      ? data.events.filter((e) => e.day <= day && e.lastDay >= day).sort((a, b) => Number(b.allDay) - Number(a.allDay) || (a.time ?? "").localeCompare(b.time ?? ""))
      : [];
  return (
    <section className="mb-6 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="card-title">Calendar</h2>
        <Link href="/admin/calendar" className="text-xs font-semibold text-pulse-gold hover:underline">
          Open calendar
        </Link>
      </div>
      {data.state === "error" ? (
        <p className="text-sm text-pulse-danger">Google Calendar couldn&apos;t be read: {data.message}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Day name="Today" events={on(today)} />
          <Day name="Tomorrow" events={on(tomorrow)} />
        </div>
      )}
    </section>
  );
}
