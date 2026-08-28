"use client";

import { useState } from "react";
import { CalendarDays, Columns3, ListChecks, Repeat } from "lucide-react";
import Link from "next/link";
import { TodayList } from "@/components/work/TodayList";
import { WorkBoard, WorkCalendar } from "@/components/work/WorkViews";
import { NewWorkForm } from "@/components/work/NewWorkForm";
import type { WorkRow } from "@/lib/work-shared";
import { cn } from "@/lib/utils/cn";
import { buttonClasses } from "@/components/ui/Button";

type View = "today" | "board" | "calendar";

const VIEWS: { key: View; label: string; icon: React.ReactNode }[] = [
  { key: "today", label: "Today", icon: <ListChecks size={14} /> },
  { key: "board", label: "Board", icon: <Columns3 size={14} /> },
  { key: "calendar", label: "Calendar", icon: <CalendarDays size={14} /> },
];

/**
 * Three ways to look at one list.
 *
 * Today answers "what next", the board answers "where is everything", the
 * calendar answers "is Thursday full". They are tabs rather than pages because
 * they are the same rows, and the old arrangement of a separate board with its
 * own table is exactly how two places to track work came about.
 */
export function WorkDashboard({
  rows,
  clients,
}: {
  rows: WorkRow[];
  clients: { id: string; business_name: string }[];
}) {
  const [view, setView] = useState<View>("today");

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface p-1">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-sm transition-colors",
                view === v.key
                  ? "bg-pulse-surface-2 text-pulse-text"
                  : "text-pulse-text-dim hover:text-pulse-text",
              )}
            >
              {v.icon}
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/work/recurring"
            className={buttonClasses("ghost", "sm")}
          >
            <Repeat size={14} /> Recurring
          </Link>
          <NewWorkForm clients={clients} />
        </div>
      </div>

      {view === "today" && <TodayList rows={rows} />}
      {view === "board" && <WorkBoard rows={rows} />}
      {view === "calendar" && <WorkCalendar rows={rows} />}
    </div>
  );
}
