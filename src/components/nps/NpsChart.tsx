"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface NpsQuarter {
  key: string;
  label: string;
  short: string;
  nps: number;
  total: number;
}

function Tip({ active, payload }: { active?: boolean; payload?: { payload: NpsQuarter }[] }) {
  const p = active ? payload?.[0]?.payload : null;
  if (!p) return null;
  return (
    <div className="rounded-md border border-pulse-border bg-pulse-surface-2 px-3 py-2 shadow-lg">
      <p className="mono-label mb-0.5">{p.label}</p>
      <p className="text-sm font-semibold text-pulse-text">
        {p.nps > 0 ? `+${p.nps}` : p.nps} <span className="font-normal text-pulse-text-dim">from {p.total} answer{p.total === 1 ? "" : "s"}</span>
      </p>
    </div>
  );
}

const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** The score on each bar: above a positive one, below a negative one, and on the line for zero, which has no bar to show it. */
function Value(props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: number | string }) {
  const x = Number(props.x ?? 0) + Number(props.width ?? 0) / 2;
  const y = Number(props.y ?? 0);
  const h = Number(props.height ?? 0);
  const v = Number(props.value ?? 0);
  const below = v < 0;
  const top = Math.min(y, y + h);
  const bottom = Math.max(y, y + h);
  return (
    <text x={x} y={below ? bottom + 14 : top - 6} textAnchor="middle" fill="var(--pulse-text)" fontSize={12} fontWeight={700}>
      {fmt(v)}
    </text>
  );
}

/**
 * The score each quarter, on the scale's own range of -100 to 100 so a small
 * sample cannot be drawn as a cliff. One series, so no legend; the zero line
 * is drawn because above or below it is the whole question.
 */
export function NpsChart({ quarters }: { quarters: NpsQuarter[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={quarters} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--pulse-border)" strokeWidth={1} />
          <XAxis dataKey="short" tickLine={false} axisLine={false} dy={6} interval={0} tick={{ fill: "var(--pulse-text-mute)", fontSize: 11 }} />
          <YAxis
            // Room past each end so a label on a +100 or -100 bar has space.
            domain={[-125, 125]}
            ticks={[-100, -50, 0, 50, 100]}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={fmt}
            tick={{ fill: "var(--pulse-text-mute)", fontSize: 11 }}
          />
          <ReferenceLine y={0} stroke="var(--pulse-text-mute)" strokeWidth={1} />
          <Tooltip content={<Tip />} cursor={{ fill: "var(--pulse-surface-2)", opacity: 0.6 }} />
          <Bar dataKey="nps" fill="var(--pulse-gold)" maxBarSize={28} radius={2} isAnimationActive={false}>
            <LabelList dataKey="nps" content={Value} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
