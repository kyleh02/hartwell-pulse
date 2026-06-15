"use client";

import { useRef } from "react";
import { Trash2, X, LineChart } from "lucide-react";
import type { InsightSnippet, ReportSectionKind } from "@/lib/types/database";
import type {
  AvailableMetric,
  ReportBlock,
  ReportMetric,
} from "@/lib/reports-shared";
import { metricKeyOf } from "@/lib/reports-shared";
import { ReportMetricBlock } from "@/components/reports/ReportMetricBlock";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { cn } from "@/lib/utils/cn";

export interface EditSection {
  key: string;
  kind: ReportSectionKind;
  title: string;
  body: string;
  blocks: ReportBlock[];
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`;
}

export function SectionCard({
  section,
  available,
  metrics,
  snippets,
  imageUrls,
  onUpdate,
  onRemove,
  onUploadImage,
  dragHandle,
}: {
  section: EditSection;
  available: AvailableMetric[];
  metrics: Record<string, ReportMetric>;
  snippets: InsightSnippet[];
  imageUrls: Record<string, string>;
  onUpdate: (patch: Partial<EditSection>) => void;
  onRemove: () => void;
  onUploadImage: (file: File) => Promise<void>;
  dragHandle: React.ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const isMetrics = section.kind === "metrics";

  const addedKeys = new Set(
    section.blocks
      .filter((b) => b.type === "metric")
      .map((b) => (b.type === "metric" ? metricKeyOf(b.serviceKey, b.metricKey) : "")),
  );
  const addable = available.filter(
    (a) => !addedKeys.has(metricKeyOf(a.serviceKey, a.metricKey)),
  );

  function addMetric(value: string) {
    const a = available.find((x) => metricKeyOf(x.serviceKey, x.metricKey) === value);
    if (!a) return;
    onUpdate({
      blocks: [
        ...section.blocks,
        { id: newId(), type: "metric", serviceKey: a.serviceKey, metricKey: a.metricKey, chart: false },
      ],
    });
  }
  function removeBlock(id: string) {
    onUpdate({ blocks: section.blocks.filter((b) => b.id !== id) });
  }
  function toggleChart(id: string) {
    onUpdate({
      blocks: section.blocks.map((b) =>
        b.id === id && b.type === "metric" ? { ...b, chart: !b.chart } : b,
      ),
    });
  }
  function setCaption(id: string, caption: string) {
    onUpdate({
      blocks: section.blocks.map((b) =>
        b.id === id && b.type === "image" ? { ...b, caption } : b,
      ),
    });
  }
  function insertSnippet(id: string) {
    const s = snippets.find((x) => x.id === id);
    if (!s) return;
    const sep = section.body.trim().length ? "\n\n" : "";
    onUpdate({ body: `${section.body}${sep}${s.body}` });
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
      <div className="flex items-center gap-2 border-b border-pulse-border px-3 py-2.5">
        {dragHandle}
        <SectionLabel parts={[section.kind]} />
        <input
          value={section.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
          className="flex-1 rounded-[var(--radius-input)] bg-transparent px-2 py-1 text-sm font-medium text-pulse-text focus:bg-pulse-surface-2 focus:outline-none"
          placeholder="Section title"
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label="Delete section"
          className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-danger"
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="space-y-4 p-4">
        {!isMetrics && (
          <>
            <textarea
              value={section.body}
              onChange={(e) => onUpdate({ body: e.target.value })}
              rows={6}
              placeholder="Write in plain Australian English, in your voice. Start a line with '- ' for a bullet."
              className="w-full resize-y rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 p-3 text-sm leading-relaxed text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none"
            />
            {snippets.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) insertSnippet(e.target.value);
                  e.target.value = "";
                }}
                className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-1.5 text-xs text-pulse-text-dim focus:outline-none"
              >
                <option value="">Insert a snippet…</option>
                {snippets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            )}
          </>
        )}

        {isMetrics && (
          <>
            {section.blocks.length === 0 && (
              <p className="text-xs text-pulse-text-mute">
                No metrics yet. Add some below.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {section.blocks.map((b) =>
                b.type === "metric" ? (
                  <div key={b.id} className="relative">
                    <ReportMetricBlock
                      metric={metrics[metricKeyOf(b.serviceKey, b.metricKey)]}
                      chart={b.chart}
                    />
                    <div className="absolute right-2 top-2 flex gap-1">
                      <button
                        type="button"
                        onClick={() => toggleChart(b.id)}
                        aria-label="Toggle chart"
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded border border-pulse-border bg-pulse-surface",
                          b.chart ? "text-pulse-gold" : "text-pulse-text-mute",
                        )}
                      >
                        <LineChart size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeBlock(b.id)}
                        aria-label="Remove metric"
                        className="flex h-6 w-6 items-center justify-center rounded border border-pulse-border bg-pulse-surface text-pulse-text-mute hover:text-pulse-danger"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <figure
                    key={b.id}
                    className="relative rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 p-2"
                  >
                    {imageUrls[b.path] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrls[b.path]}
                        alt={b.caption || "Report image"}
                        className="w-full rounded"
                      />
                    ) : (
                      <div className="flex h-24 items-center justify-center text-xs text-pulse-text-mute">
                        Image uploaded
                      </div>
                    )}
                    <input
                      value={b.caption}
                      onChange={(e) => setCaption(b.id, e.target.value)}
                      placeholder="Caption (optional)"
                      className="mt-2 w-full rounded bg-transparent px-1 text-xs text-pulse-text-dim focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeBlock(b.id)}
                      aria-label="Remove image"
                      className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded border border-pulse-border bg-pulse-surface text-pulse-text-mute hover:text-pulse-danger"
                    >
                      <X size={12} />
                    </button>
                  </figure>
                ),
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) addMetric(e.target.value);
                  e.target.value = "";
                }}
                disabled={addable.length === 0}
                className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-1.5 text-xs text-pulse-text-dim focus:outline-none disabled:opacity-40"
              >
                <option value="">
                  {addable.length ? "Add a metric…" : "All metrics added"}
                </option>
                {addable.map((a) => (
                  <option
                    key={metricKeyOf(a.serviceKey, a.metricKey)}
                    value={metricKeyOf(a.serviceKey, a.metricKey)}
                  >
                    {a.serviceName}: {a.label}
                  </option>
                ))}
              </select>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) await onUploadImage(f);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-1.5 text-xs text-pulse-text-dim hover:text-pulse-text"
              >
                Add image
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
