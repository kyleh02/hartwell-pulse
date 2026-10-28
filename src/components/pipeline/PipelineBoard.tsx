"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import {
  STAGES,
  followUpState,
  leadTitle,
  money,
  shortDate,
  type Lead,
  type LeadStage,
} from "@/lib/pipeline-shared";
import { moveLead } from "@/app/admin/pipeline/actions";
import { cn } from "@/lib/utils/cn";

/**
 * The four open stages, side by side. Drag a card to another column to move
 * it; the card moves at once and the server catches up. Won is not a drop
 * target, because winning is a button on the lead that onboards them.
 */
export function PipelineBoard({ leads, today }: { leads: Lead[]; today: string }) {
  const router = useRouter();
  const [local, setLocal] = useState<Record<string, LeadStage>>({});
  const [over, setOver] = useState<LeadStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const stageOf = (l: Lead) => local[l.id] ?? l.stage;
  const open = STAGES.filter((s) => s.open);

  function drop(stage: LeadStage, id: string) {
    setOver(null);
    const lead = leads.find((l) => l.id === id);
    if (!lead || stageOf(lead) === stage) return;
    setLocal((m) => ({ ...m, [id]: stage }));
    setError(null);
    start(async () => {
      const res = await moveLead(id, stage);
      if (!res.ok) {
        setError(res.message);
        setLocal((m) => {
          const next = { ...m };
          delete next[id];
          return next;
        });
      }
      router.refresh();
    });
  }

  return (
    <div>
      {error && <p className="mb-3 text-sm text-pulse-danger">{error}</p>}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-4">
        {open.map((col) => {
          const items = leads.filter((l) => stageOf(l) === col.key);
          const value = items.reduce((s, l) => s + (Number(l.value) || 0), 0);
          return (
            <section
              key={col.key}
              aria-label={col.label}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.key);
              }}
              onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                drop(col.key, e.dataTransfer.getData("text/lead"));
              }}
              className={cn(
                "min-h-40 rounded-[20px] border p-3 transition-colors",
                over === col.key ? "border-pulse-gold/60 bg-pulse-gold/[0.06]" : "border-pulse-border bg-pulse-surface/40",
              )}
            >
              <div className="mb-3 flex items-baseline justify-between gap-2 px-1">
                <h2 className="card-title">{col.label}</h2>
                <span className="data-mono text-xs text-pulse-text-mute">
                  {items.length}
                  {value > 0 ? ` · ${money(value)}` : ""}
                </span>
              </div>
              <div className="space-y-2">
                {items.map((l) => {
                  const due = followUpState(l, today);
                  return (
                    <Link
                      key={l.id}
                      href={`/admin/pipeline/${l.id}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/lead", l.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      className={cn(
                        "lift block cursor-grab rounded-[14px] border bg-pulse-surface p-3.5 active:cursor-grabbing",
                        due === "overdue" ? "border-pulse-warn/50" : "border-pulse-border",
                      )}
                    >
                      <p className="text-[14px] leading-snug font-extrabold tracking-[0.02em] break-words text-pulse-text uppercase">
                        {leadTitle(l)}
                      </p>
                      {l.business && l.name && <p className="text-xs text-pulse-text-dim">{l.name}</p>}
                      {l.service && <p className="mt-1.5 line-clamp-2 text-xs text-pulse-text-dim">{l.service}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        {l.value ? <span className="font-semibold text-pulse-text">{money(l.value)}</span> : null}
                        {l.follow_up_on && (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1",
                              due === "overdue" ? "text-pulse-warn" : due === "today" ? "text-pulse-gold" : "text-pulse-text-mute",
                            )}
                          >
                            <CalendarClock size={12} aria-hidden="true" />
                            {due === "today" ? "Today" : shortDate(l.follow_up_on)}
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
                {items.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-pulse-text-mute">Drop a lead here</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
