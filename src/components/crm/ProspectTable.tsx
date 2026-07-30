"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ALL_STAGES, CRM_STAGES, formatAud, isStale } from "@/lib/crm-shared";
import { setStage } from "@/app/admin/crm/actions";
import type { ProspectRow } from "@/lib/crm";
import { cn } from "@/lib/utils/cn";

const STATES = ["Vic", "SA", "NSW", "Qld", "WA", "Tas", "NT", "ACT"];
const TIERS = ["A", "B", "C", "D"];

type Show = "all" | "todo" | "live" | "stale";

const IN_PLAY = ["verified", "contacted", "connected", "followed_up", "replied", "conversation", "proposal"];

/** Stage colour, carried on the select itself so the row reads at a glance. */
const STAGE_TONE: Record<string, string> = {
  researched: "text-pulse-text-mute",
  verified: "text-pulse-warn",
  contacted: "text-pulse-steel",
  connected: "text-pulse-steel",
  followed_up: "text-pulse-steel",
  replied: "text-pulse-success",
  conversation: "text-pulse-success",
  proposal: "text-pulse-success",
  won: "text-pulse-success",
  delivered: "text-pulse-success",
  lost: "text-pulse-text-mute",
  do_not_contact: "text-pulse-danger",
};

export function ProspectTable({ rows }: { rows: ProspectRow[] }) {
  const router = useRouter();
  const [tier, setTier] = useState("all");
  const [state, setState] = useState("all");
  const [show, setShow] = useState<Show>("all");
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (tier !== "all" && r.tier !== tier) return false;
      if (state !== "all" && r.state !== state) return false;
      if (show === "todo" && r.stage !== "researched") return false;
      if (show === "live" && !IN_PLAY.includes(r.stage)) return false;
      if (show === "stale" && !isStale(r.last_verified_at)) return false;
      if (q) {
        const hay = `${r.legal_name} ${r.headline_purpose ?? ""} ${r.contact_name ?? ""}`;
        if (!hay.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, tier, state, show, query]);

  function changeStage(id: string, next: string) {
    startTransition(async () => {
      await setStage(id, next);
      router.refresh();
    });
  }

  return (
    <div>
      {/* filters */}
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <ChipGroup label="Tier" value={tier} onChange={setTier} options={TIERS} />
          <span className="mx-1 hidden h-4 w-px bg-pulse-border sm:block" />
          <ChipGroup label="State" value={state} onChange={setState} options={STATES} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["all", "Everything"],
              ["todo", "Not yet contacted"],
              ["live", "In play"],
              ["stale", "Needs re-verifying"],
            ] as [Show, string][]
          ).map(([key, label]) => (
            <Chip
              key={key}
              active={show === key}
              onClick={() => setShow(key)}
              label={label}
            />
          ))}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search company or purpose…"
            className="ml-auto w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-1.5 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none sm:w-64"
          />
        </div>
      </div>

      <p className="data-mono mb-2 text-xs text-pulse-text-mute">
        Showing {filtered.length} of {rows.length}
      </p>

      {/* The money and stage columns cannot wrap, so the table scrolls in its
          own box rather than dragging the page sideways on a phone. */}
      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-pulse-border">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="mono-label border-b border-pulse-border bg-pulse-surface text-left">
              <th className="px-3 py-2.5 font-medium">Tier</th>
              <th className="px-3 py-2.5 font-medium">Company</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">Funding</th>
              <th className="px-3 py-2.5 font-medium">Contact</th>
              <th className="px-3 py-2.5 font-medium">Stage</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const terminal = r.stage === "lost" || r.stage === "do_not_contact";
              return (
                <tr
                  key={r.id}
                  className={cn(
                    "border-b border-pulse-border align-top transition-colors last:border-0 hover:bg-pulse-surface-2/40",
                    terminal && "opacity-50",
                  )}
                >
                  <td className="px-3 py-3">
                    <span className="data-mono rounded-[3px] border border-pulse-border px-1.5 py-0.5 text-[10px] text-pulse-text-dim">
                      {r.tier ?? "-"}
                    </span>
                  </td>
                  <td className="min-w-0 px-3 py-3">
                    <Link
                      href={`/admin/crm/${r.id}`}
                      className="font-medium text-pulse-text hover:text-pulse-steel-bright"
                    >
                      {r.legal_name}
                    </Link>
                    <span className="data-mono ml-2 text-[10px] text-pulse-text-mute">
                      {r.state}
                    </span>
                    {r.headline_purpose && (
                      <span className="mt-0.5 block max-w-[38rem] text-xs text-pulse-text-mute">
                        {r.headline_purpose}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    <span className="data-mono text-pulse-text">
                      {formatAud(r.grant_total_aud)}
                    </span>
                    {r.grant_count > 1 && (
                      <span className="data-mono block text-[10px] text-pulse-text-mute">
                        {r.grant_count} grants
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {r.contact_name ? (
                      <>
                        <span className="text-pulse-text-dim">{r.contact_name}</span>
                        {r.emails_sent > 0 && (
                          <span className="data-mono block text-[10px] text-pulse-text-mute">
                            {r.emails_sent} of 2 emails
                          </span>
                        )}
                        {r.opted_out && (
                          <span className="data-mono block text-[10px] text-pulse-danger">
                            opted out
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-pulse-text-mute">Not yet named</span>
                    )}
                    {isStale(r.last_verified_at) && !terminal && (
                      <span className="data-mono block text-[10px] text-pulse-warn">
                        evidence over 14 days old
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <select
                      value={r.stage}
                      disabled={pending}
                      onChange={(e) => changeStage(r.id, e.target.value)}
                      aria-label={`Stage for ${r.legal_name}`}
                      className={cn(
                        "data-mono w-full min-w-[8.5rem] rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-2 py-1 text-xs focus:border-pulse-border-strong focus:outline-none disabled:opacity-50",
                        STAGE_TONE[r.stage] ?? "text-pulse-text",
                      )}
                    >
                      {ALL_STAGES.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="mt-4 text-center text-sm text-pulse-text-dim">
          Nothing matches those filters.
        </p>
      )}
    </div>
  );
}

function ChipGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <>
      <span className="mono-label mr-1">{label}</span>
      <Chip active={value === "all"} onClick={() => onChange("all")} label="All" />
      {options.map((o) => (
        <Chip key={o} active={value === o} onClick={() => onChange(o)} label={o} />
      ))}
    </>
  );
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "data-mono rounded-full px-2.5 py-1 text-[11px] transition-colors",
        active
          ? "bg-pulse-steel/15 text-pulse-steel-bright"
          : "text-pulse-text-mute hover:text-pulse-text",
      )}
    >
      {label}
    </button>
  );
}

/** Stage counts strip, so the shape of the pipeline is visible without a board. */
export function StageStrip({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5">
      {CRM_STAGES.map((s) => (
        <span key={s.key} className="flex items-baseline gap-1.5" title={s.hint}>
          <span className="data-mono text-sm text-pulse-text">{counts[s.key] ?? 0}</span>
          <span className="mono-label">{s.label}</span>
        </span>
      ))}
      {counts.do_not_contact ? (
        <span className="flex items-baseline gap-1.5">
          <span className="data-mono text-sm text-pulse-danger">
            {counts.do_not_contact}
          </span>
          <span className="mono-label">Do not contact</span>
        </span>
      ) : null}
    </div>
  );
}
