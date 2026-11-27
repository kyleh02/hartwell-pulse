"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/Button";
import { disconnectGmailAction, sendTestPair, updateSettings, type SettingsInput } from "@/app/admin/outreach/sender-actions";
import { DraperConnectors, type ConnectorRow } from "@/components/outreach/DraperConnectors";
import { field, Group, Row, Segmented, Switch } from "@/components/outreach/ui";
import type { DraperSettings } from "@/lib/outreach/types";
import { cn } from "@/lib/utils/cn";

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/**
 * Draper's settings as grouped rows (Stage 8). Switches and choices save the
 * moment they change; times, numbers and addresses show a Save once edited.
 * Every save is still a new settings version with a line in the change log.
 */
export function SettingsPanel({
  s,
  gmail,
  setupMissing,
  connectors,
  holidays,
  flash,
}: {
  s: DraperSettings;
  gmail: { email: string; connected_at: string } | null;
  setupMissing: string[];
  connectors: ConnectorRow[];
  holidays: string;
  flash: { outcome: string; why: string | null } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(
    flash
      ? flash.outcome === "connected"
        ? { ok: true, text: "Gmail connected." }
        : flash.outcome === "setup"
          ? { ok: false, text: "Google's client id and secret aren't in Vercel yet." }
          : { ok: false, text: flash.why ?? "Connecting Gmail didn't work." }
      : null,
  );

  const save = (patch: Partial<SettingsInput>, note: string, done = "Saved.") =>
    start(async () => {
      const r = await updateSettings(patch, note);
      setMsg(r.ok ? { ok: true, text: done } : { ok: false, text: r.message });
      router.refresh();
    });

  // Slider: shown as it moves, saved when let go.
  const [daily, setDaily] = useState(s.daily_first_emails);
  const committed = useRef(s.daily_first_emails);
  const commitDaily = () => {
    if (daily === committed.current) return;
    committed.current = daily;
    save({ daily_first_emails: daily }, `First emails a day: ${daily}`, `${daily} first emails a day.`);
  };

  // Timing: one Save for the lot.
  const timing0 = {
    window_start: s.window_start.slice(0, 5),
    window_end: s.window_end.slice(0, 5),
    gap_min_minutes: s.gap_min_minutes,
    gap_max_minutes: s.gap_max_minutes,
    stop_window_minutes: s.stop_window_minutes,
  };
  const [timing, setTiming] = useState(timing0);
  const timingDirty = JSON.stringify(timing) !== JSON.stringify(timing0);

  const [pauseFrom, setPauseFrom] = useState(s.pause_from ?? "");
  const [pauseTo, setPauseTo] = useState(s.pause_to ?? "");
  const pauseDirty = pauseFrom !== (s.pause_from ?? "") || pauseTo !== (s.pause_to ?? "");

  const [inboxes, setInboxes] = useState(s.test_inboxes.join(", "));
  const inboxesDirty = inboxes.trim() !== s.test_inboxes.join(", ");

  const run = (fn: () => Promise<{ ok: boolean; message?: string; to?: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: r.to ? `${done} ${r.to}.` : done } : { ok: false, text: r.message ?? "That didn't work." });
      router.refresh();
    });

  return (
    <div className="space-y-6">
      {msg && <p className={cn("rounded-[var(--radius-input)] px-3 py-2 text-[13px]", msg.ok ? "bg-pulse-success/10 text-pulse-success" : "bg-pulse-danger/10 text-pulse-danger")}>{msg.text}</p>}

      <Group title="Sending">
        <Row label="Send on weekends" detail="Saturdays and Sundays become sending days. The big public holidays and your pause dates are still skipped.">
          <Switch
            label="Send on weekends"
            on={s.send_weekends === true}
            disabled={pending}
            onChange={(on) => save({ send_weekends: on }, `Weekends ${on ? "on" : "off"}`, on ? "Sending on weekends." : "Weekdays only.")}
          />
        </Row>
        <Row
          stack
          label={
            <span className="flex items-baseline justify-between gap-3">
              <span>First emails a day</span>
              <span className="data-mono text-pulse-gold">{daily}</span>
            </span>
          }
          detail="Warms up at 10 a day for five sending days, then 15 and 20. Past 12 a day wait in Check these until 12:30pm."
        >
          <input
            type="range"
            min={1}
            max={25}
            value={daily}
            disabled={pending}
            aria-label="First emails a day"
            className="w-full accent-[var(--pulse-gold)]"
            onChange={(e) => setDaily(Number(e.target.value))}
            onPointerUp={commitDaily}
            onKeyUp={commitDaily}
            onBlur={commitDaily}
          />
        </Row>
        <Row stack label="Follow-up's last line" detail={s.opt_out_line === "B" ? "“If the timing's wrong or someone already looks after your ads, just reply and say so and we'll leave it there.”" : "“No obligation at all. Just reply if you'd rather we didn't write again.”"}>
          <Segmented<"A" | "B">
            ariaLabel="Follow-up's last line"
            value={s.opt_out_line}
            disabled={pending}
            onSelect={(v) => save({ opt_out_line: v }, `Follow-up opt-out line ${v}`, `Line ${v} from now on.`)}
            options={[
              { value: "A", label: "Just reply" },
              { value: "B", label: "One word back" },
            ]}
          />
        </Row>
      </Group>

      <Group title="Timing" note="For 25 first emails and their follow-ups, open about 8:30am to 5:30pm with 10 to 15 minutes between sends. Anything that won't fit goes the next sending day.">
        <Row label="Send between">
          <span className="flex items-center gap-2">
            <input type="time" className={cn(field, "w-[118px]")} value={timing.window_start} onChange={(e) => setTiming({ ...timing, window_start: e.target.value })} aria-label="Window opens" />
            <span className="text-pulse-text-mute">to</span>
            <input type="time" className={cn(field, "w-[118px]")} value={timing.window_end} onChange={(e) => setTiming({ ...timing, window_end: e.target.value })} aria-label="Window closes" />
          </span>
        </Row>
        <Row label="Minutes between sends">
          <span className="flex items-center gap-2">
            <input type="number" min={10} max={120} className={cn(field, "w-[72px]")} value={timing.gap_min_minutes} onChange={(e) => setTiming({ ...timing, gap_min_minutes: Number(e.target.value) })} aria-label="Shortest gap" />
            <span className="text-pulse-text-mute">to</span>
            <input type="number" min={10} max={180} className={cn(field, "w-[72px]")} value={timing.gap_max_minutes} onChange={(e) => setTiming({ ...timing, gap_max_minutes: Number(e.target.value) })} aria-label="Longest gap" />
          </span>
        </Row>
        <Row label="Wait after the 8am summary" detail="Minutes to stop anything before the first email goes.">
          <input type="number" min={0} max={300} className={cn(field, "w-[80px]")} value={timing.stop_window_minutes} onChange={(e) => setTiming({ ...timing, stop_window_minutes: Number(e.target.value) })} aria-label="Stop window" />
        </Row>
        {timingDirty && (
          <div className="flex justify-end gap-2 px-4 py-3">
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setTiming(timing0)}>
              Undo
            </Button>
            <Button type="button" size="sm" disabled={pending} onClick={() => save(timing, "Timing", "Timing saved.")}>
              Save timing
            </Button>
          </div>
        )}
      </Group>

      <Group title="Pause dates" note="Nothing sends between these dates, both included.">
        <Row label="From">
          <input type="date" className={field} value={pauseFrom} onChange={(e) => setPauseFrom(e.target.value)} aria-label="Pause from" />
        </Row>
        <Row label="To">
          <input type="date" className={field} value={pauseTo} onChange={(e) => setPauseTo(e.target.value)} aria-label="Pause to" />
        </Row>
        {(pauseDirty || s.pause_from || s.pause_to) && (
          <div className="flex justify-end gap-2 px-4 py-3">
            {(s.pause_from || s.pause_to) && (
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => save({ pause_from: "", pause_to: "" }, "Pause dates cleared", "No pause dates.")}>
                Clear
              </Button>
            )}
            {pauseDirty && (
              <Button type="button" size="sm" disabled={pending} onClick={() => save({ pause_from: pauseFrom, pause_to: pauseTo }, "Pause dates", "Pause dates saved.")}>
                Save dates
              </Button>
            )}
          </div>
        )}
      </Group>

      <Group title="Test inboxes" note="One Gmail and one Outlook, separated by commas. Test mode sends here.">
        <Row stack label="Addresses">
          <input className={cn(field, "w-full")} value={inboxes} onChange={(e) => setInboxes(e.target.value)} placeholder="you@gmail.com, you@outlook.com" aria-label="Test inboxes" />
        </Row>
        {inboxesDirty && (
          <div className="flex justify-end px-4 py-3">
            <Button type="button" size="sm" disabled={pending} onClick={() => save({ test_inboxes: inboxes }, "Test inboxes", "Test inboxes saved.")}>
              Save inboxes
            </Button>
          </div>
        )}
      </Group>

      <Group title="Gmail">
        <Row label={gmail ? gmail.email : "Not connected"} detail={gmail ? `Connected ${when(gmail.connected_at)}. Draper sends from here.` : "Sign in as kyle@hartwelldigital.com to send."}>
          {gmail ? (
            <span className="flex flex-wrap justify-end gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => run(sendTestPair, "Test pair sent to")}>
                Test pair
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(disconnectGmailAction, "Gmail disconnected.")}>
                Disconnect
              </Button>
            </span>
          ) : setupMissing.length ? (
            <span className="text-[12px] text-pulse-warn">Needs {setupMissing.join(", ")}</span>
          ) : (
            <a href="/api/outreach/gmail/connect" className={buttonClasses("primary", "sm")}>
              Connect
            </a>
          )}
        </Row>
      </Group>

      <section className="space-y-2">
        <h3 className="card-title px-1">Connectors</h3>
        <DraperConnectors rows={connectors} />
      </section>

      <p className="px-1 text-[12px] leading-relaxed text-pulse-text-mute">
        Settings version {s.version}; every change is kept as a new version. Public holidays: {holidays}.
      </p>
    </div>
  );
}
