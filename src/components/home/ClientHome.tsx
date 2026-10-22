import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CircleCheck,
  FileText,
  FolderOpen,
  Globe,
  Mail,
  MessageSquare,
  PenLine,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import type { ClientHomeData, HomeTile } from "@/lib/client-home";
import { formatMetricValue } from "@/lib/metrics";
import { HARTWELL } from "@/lib/brand";
import { DeltaBadge } from "@/components/dashboard/DeltaBadge";
import { OpenChatButton } from "@/components/home/OpenChatButton";
import { cn } from "@/lib/utils/cn";

const ICON: Record<HomeTile["key"], LucideIcon> = {
  website: Globe,
  reports: FileText,
  assets: FolderOpen,
  copy: PenLine,
  invoices: Receipt,
  messages: MessageSquare,
};

/** Keeps the wave on the same line as the name it follows. */
const WAVE = " 👋";

/**
 * The client's Home: who they are to us, what to do first, and where every part
 * of the portal stands, on one screen. See lib/client-home.ts for why it
 * replaced the analytics page.
 *
 * `preview` is the admin's view of it. Nothing links (the client's routes
 * send an admin back to /admin) and the chat buttons do nothing, so the
 * preview can be looked at but not mistaken for the client's own session.
 */
export function ClientHome({
  data,
  preview = false,
}: {
  data: ClientHomeData;
  preview?: boolean;
}) {
  const hasWebsite = data.tiles.some((t) => t.key === "website");
  const greeting = data.isNew ? "Welcome to your portal" : "Welcome back";
  const name = data.firstName ? `, ${data.firstName}` : "";
  const doneCount = data.steps.filter((s) => s.done).length;

  return (
    <div className="space-y-4">
      {/* ---- welcome ---------------------------------------------------- */}
      <section
        className="relative overflow-hidden rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-5 sm:p-7"
        style={{
          backgroundImage:
            "radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--pulse-gold) 16%, transparent) 0%, transparent 55%)",
        }}
      >
        <p className="mono-label mb-2.5 truncate">{data.businessName}</p>
        <h1 className="text-2xl leading-tight font-semibold tracking-tight text-pulse-text sm:text-[30px]">
          {greeting}
          {name}
          {WAVE}
        </h1>
        <p className="mt-2 mb-4 max-w-[620px] text-[15px] text-pulse-text-dim">
          {data.isNew
            ? `This is home for everything we're doing together at ${data.businessName}: ${
                hasWebsite
                  ? "your website, your reports, your files"
                  : "your reports, your files, your invoices"
              } and a direct line to me.`
            : `Here's where everything stands at ${data.businessName} today.`}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-pulse-gold/35 bg-pulse-gold/10 px-3 py-1 text-[13px] text-pulse-text">
            <CalendarDays size={15} className="text-pulse-gold" aria-hidden="true" />
            {data.daysWithUs === 0 ? (
              <>
                Joined {HARTWELL.name}{" "}
                <strong className="data-mono font-semibold text-pulse-gold">today</strong>
              </>
            ) : (
              <>
                With {HARTWELL.name} for{" "}
                <strong className="data-mono font-semibold text-pulse-gold">
                  {data.daysWithUs.toLocaleString("en-AU")}{" "}
                  {data.daysWithUs === 1 ? "day" : "days"}
                </strong>
              </>
            )}
          </span>
          <span className="text-xs text-pulse-text-mute">Started {data.startedOn}</span>
        </div>
      </section>

      {/* ---- getting started, until it is done -------------------------- */}
      {data.isNew && (
        <section className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="mono-label">Getting started</h2>
            <p className="text-xs text-pulse-text-mute">
              {doneCount} of {data.steps.length} done
            </p>
          </div>
          <ol className="mt-3 grid gap-2 sm:grid-cols-3">
            {data.steps.map((step, i) => (
              <li
                key={step.key}
                className="flex items-start gap-3 rounded-xl bg-pulse-text/[0.04] p-3"
              >
                {step.done ? (
                  <>
                    <CircleCheck
                      size={22}
                      className="shrink-0 text-pulse-success"
                      aria-hidden="true"
                    />
                    <span className="sr-only">Done:</span>
                  </>
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pulse-gold text-xs font-semibold text-pulse-bg"
                  >
                    {i + 1}
                  </span>
                )}
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-sm font-medium text-pulse-text",
                      step.done && "line-through opacity-70",
                    )}
                  >
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-xs text-pulse-text-dim">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ---- every part of the portal, with its state ------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.tiles.map((tile) => (
          <Tile key={tile.key} tile={tile} preview={preview} />
        ))}
      </div>

      {/* ---- the month's headline numbers ------------------------------ */}
      {data.metrics.length > 0 && (
        <section className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="mono-label">{data.metricsMonth ?? "This month"}</h2>
            {!preview && (
              <Link
                href="/dashboard/performance"
                className="inline-flex shrink-0 items-center gap-1 text-[13px] text-pulse-gold hover:text-pulse-gold-light"
              >
                Full performance
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {data.metrics.map((m) => (
              <div
                key={`${m.serviceKey}-${m.key}`}
                className="min-w-0 rounded-xl bg-pulse-text/[0.04] p-3"
              >
                <p className="truncate text-xs text-pulse-text-dim">{m.label}</p>
                <p className="data-mono mt-0.5 truncate text-xl text-pulse-text">
                  {formatMetricValue(m.current, m.unit)}
                </p>
                <DeltaBadge delta={m.delta} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- who they are dealing with -------------------------------- */}
      <section className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <span
            aria-hidden="true"
            className="flex h-13 w-13 shrink-0 items-center justify-center rounded-full bg-pulse-gold/20 text-lg font-semibold text-pulse-gold"
          >
            {HARTWELL.personFirst.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <h2 className="mono-label">Your contact</h2>
            <p className="mt-0.5 text-base font-semibold text-pulse-text">{HARTWELL.person}</p>
            <p className="text-sm text-pulse-text-dim">{HARTWELL.name}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <a
            href={preview ? undefined : `mailto:${HARTWELL.email}`}
            className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-[10px] border border-pulse-border px-4 text-sm text-pulse-text transition-colors hover:border-pulse-border-strong"
          >
            <Mail size={17} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{HARTWELL.email}</span>
          </a>
          <OpenChatButton label={`Message ${HARTWELL.personFirst}`} preview={preview} />
        </div>
      </section>
    </div>
  );
}

function Tile({ tile, preview }: { tile: HomeTile; preview: boolean }) {
  const Icon = ICON[tile.key];
  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-pulse-gold/12 text-pulse-gold">
          <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <ArrowRight
          size={16}
          aria-hidden="true"
          className="text-pulse-text-mute transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </div>
      <h2 className="mono-label flex items-center gap-2">
        {tile.title}
        {tile.tone === "attention" && (
          <>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-pulse-warn" />
            <span className="sr-only">, needs you</span>
          </>
        )}
      </h2>
      <p className="flex items-start gap-1.5 text-[15px] font-medium break-words text-pulse-text">
        {tile.tone === "ok" && (
          <CircleCheck size={16} className="mt-[3px] shrink-0 text-pulse-success" aria-hidden="true" />
        )}
        <span className="min-w-0">{tile.line}</span>
      </p>
      <p className="truncate text-xs text-pulse-text-dim">{tile.sub}</p>
      <p className="mt-auto pt-1 text-[13px] text-pulse-gold">{tile.cta}</p>
    </>
  );
  const cls = cn(
    "group flex min-w-0 flex-col gap-2 rounded-[var(--radius-card)] border bg-pulse-surface p-4 transition-colors",
    tile.tone === "attention"
      ? "border-pulse-warn/40 hover:border-pulse-warn/70"
      : "border-pulse-border hover:border-pulse-border-strong",
  );
  if (preview) return <div className={cls}>{body}</div>;
  return (
    <Link href={tile.href} className={cls}>
      {body}
    </Link>
  );
}
