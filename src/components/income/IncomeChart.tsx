"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { IncomeMonth } from "@/lib/income-shared";

const money = (n: number) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });

/** $0, $2K, $4.5K: axis ticks stay short. */
const compact = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toLocaleString("en-AU", { maximumFractionDigits: 1 })}K` : `$${n}`;

function Tip({ active, payload }: { active?: boolean; payload?: { payload: IncomeMonth }[] }) {
  const p = active ? payload?.[0]?.payload : null;
  if (!p) return null;
  return (
    <div className="rounded-md border border-pulse-border bg-pulse-surface-2 px-3 py-2 shadow-lg">
      <p className="mono-label mb-0.5">
        {p.label}
        {p.current ? " so far" : ""}
      </p>
      <p className="text-sm font-semibold text-pulse-text">{money(p.amount)}</p>
    </div>
  );
}

/**
 * Money received each month, the last twelve. One series, so no legend: the
 * card's title names it. The month under way is drawn lighter, because a part
 * month next to whole ones reads as a drop that has not happened.
 */
export function IncomeChart({ months }: { months: IncomeMonth[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={months} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--pulse-border)" strokeWidth={1} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            dy={6}
            interval={0}
            tick={{ fill: "var(--pulse-text-mute)", fontSize: 11 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={compact}
            tick={{ fill: "var(--pulse-text-mute)", fontSize: 11 }}
          />
          <Tooltip
            content={<Tip />}
            cursor={{ fill: "var(--pulse-surface-2)", opacity: 0.6 }}
          />
          <Bar dataKey="amount" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {months.map((m) => (
              <Cell key={m.key} fill="var(--pulse-gold)" fillOpacity={m.current ? 0.45 : 1} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
