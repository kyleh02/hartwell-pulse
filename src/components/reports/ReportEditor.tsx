"use client";

import { useState, useTransition } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import type { InsightSnippet, ReportSectionKind } from "@/lib/types/database";
import type { ReportBundle } from "@/lib/reports-shared";
import { sectionBlocks } from "@/lib/reports-shared";
import Link from "next/link";
import { SectionCard, type EditSection } from "@/components/reports/SectionCard";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { monthLabel } from "@/lib/metrics";
import {
  saveReport,
  setReportStatus,
  uploadReportImage,
  createSnippet,
  deleteSnippet,
} from "@/app/admin/reports/actions";

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`;
}

const ADD_KINDS: { kind: ReportSectionKind; label: string }[] = [
  { kind: "metrics", label: "Metrics" },
  { kind: "insights", label: "Insights" },
  { kind: "recommendations", label: "Recommendations" },
  { kind: "custom", label: "Custom" },
];

function SortableSection({
  section,
  render,
}: {
  section: EditSection;
  render: (handle: React.ReactNode) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.key });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const handle = (
    <button
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label="Drag to reorder"
      className="flex h-8 w-7 cursor-grab touch-none items-center justify-center rounded text-pulse-text-mute hover:text-pulse-text active:cursor-grabbing"
    >
      <GripVertical size={15} />
    </button>
  );

  return (
    <div ref={setNodeRef} style={style}>
      {render(handle)}
    </div>
  );
}

export function ReportEditor({
  bundle,
  imageUrls: initialImageUrls,
  snippets: initialSnippets,
}: {
  bundle: ReportBundle;
  imageUrls: Record<string, string>;
  snippets: InsightSnippet[];
}) {
  const [title, setTitle] = useState(bundle.report.title);
  const [status, setStatus] = useState(bundle.report.status);
  const [sections, setSections] = useState<EditSection[]>(() =>
    bundle.sections.map((s) => ({
      key: s.id,
      kind: s.kind,
      title: s.title,
      body: s.body ?? "",
      blocks: sectionBlocks(s),
    })),
  );
  const [imageUrls, setImageUrls] = useState(initialImageUrls);
  const [snippets, setSnippets] = useState(initialSnippets);
  const [saved, setSaved] = useState(true);
  const [pending, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function touch() {
    setSaved(false);
  }
  function patchSection(key: string, patch: Partial<EditSection>) {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
    touch();
  }
  function removeSection(key: string) {
    setSections((prev) => prev.filter((s) => s.key !== key));
    touch();
  }
  function addSection(kind: ReportSectionKind) {
    const labelMap: Record<ReportSectionKind, string> = {
      metrics: "Performance",
      insights: "Insights",
      recommendations: "Recommendations",
      custom: "Section",
    };
    setSections((prev) => [
      ...prev,
      { key: newId(), kind, title: labelMap[kind], body: "", blocks: [] },
    ]);
    touch();
  }
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setSections((prev) => {
      const from = prev.findIndex((s) => s.key === active.id);
      const to = prev.findIndex((s) => s.key === over.id);
      return from < 0 || to < 0 ? prev : arrayMove(prev, from, to);
    });
    touch();
  }

  async function handleUploadImage(key: string, file: File) {
    const fd = new FormData();
    fd.append("reportId", bundle.report.id);
    fd.append("file", file);
    const { path, url } = await uploadReportImage(fd);
    setImageUrls((prev) => ({ ...prev, [path]: url }));
    setSections((prev) =>
      prev.map((s) =>
        s.key === key
          ? { ...s, blocks: [...s.blocks, { id: newId(), type: "image", path, caption: "" }] }
          : s,
      ),
    );
    touch();
  }

  function buildInput() {
    return {
      title,
      sections: sections.map((s) => ({
        kind: s.kind,
        title: s.title,
        body: s.body,
        blocks: s.blocks,
      })),
    };
  }

  function save() {
    startTransition(async () => {
      await saveReport(bundle.report.id, buildInput());
      setSaved(true);
    });
  }
  function publish() {
    startTransition(async () => {
      await saveReport(bundle.report.id, buildInput());
      await setReportStatus(bundle.report.id, "published");
      setStatus("published");
      setSaved(true);
    });
  }
  function unpublish() {
    startTransition(async () => {
      await setReportStatus(bundle.report.id, "draft");
      setStatus("draft");
    });
  }

  return (
    <div>
      {/* toolbar */}
      <div className="mb-6 flex flex-col gap-3 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="data-mono text-xs text-pulse-text-mute">
            {bundle.client.business_name} · {monthLabel(bundle.report.period_month)}
          </p>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              touch();
            }}
            className="mt-1 w-full rounded-[var(--radius-input)] bg-transparent text-lg font-semibold text-pulse-text focus:bg-pulse-surface-2 focus:px-2 focus:outline-none"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={status === "published" ? "success" : "neutral"}>
            {status}
          </Badge>
          <span className="data-mono text-[11px] text-pulse-text-mute">
            {saved ? "saved" : "unsaved"}
          </span>
          <Link
            href={`/admin/reports/${bundle.report.id}/preview`}
            target="_blank"
            className={buttonClasses("ghost", "sm")}
          >
            Preview
          </Link>
          <Button variant="secondary" size="sm" onClick={save} disabled={pending}>
            Save
          </Button>
          {status === "published" ? (
            <Button variant="ghost" size="sm" onClick={unpublish} disabled={pending}>
              Unpublish
            </Button>
          ) : (
            <Button size="sm" onClick={publish} disabled={pending}>
              Publish
            </Button>
          )}
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[1fr_280px] lg:gap-6">
        {/* sections */}
        <div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={sections.map((s) => s.key)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-3">
                {sections.map((section) => (
                  <SortableSection
                    key={section.key}
                    section={section}
                    render={(handle) => (
                      <SectionCard
                        section={section}
                        available={bundle.available}
                        metrics={bundle.metrics}
                        snippets={snippets}
                        imageUrls={imageUrls}
                        onUpdate={(patch) => patchSection(section.key, patch)}
                        onRemove={() => removeSection(section.key)}
                        onUploadImage={(file) => handleUploadImage(section.key, file)}
                        dragHandle={handle}
                      />
                    )}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <div className="mt-4 flex flex-wrap gap-2">
            {ADD_KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                onClick={() => addSection(k.kind)}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-input)] border border-dashed border-pulse-border px-3 py-1.5 text-xs text-pulse-text-dim hover:border-pulse-border-strong hover:text-pulse-text"
              >
                <Plus size={13} /> {k.label}
              </button>
            ))}
          </div>
        </div>

        {/* snippet library */}
        <aside className="mt-6 lg:mt-0">
          <SnippetManager
            snippets={snippets}
            setSnippets={setSnippets}
          />
        </aside>
      </div>
    </div>
  );
}

function SnippetManager({
  snippets,
  setSnippets,
}: {
  snippets: InsightSnippet[];
  setSnippets: React.Dispatch<React.SetStateAction<InsightSnippet[]>>;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [, startTransition] = useTransition();

  function add() {
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) return;
    const optimistic: InsightSnippet = {
      id: newId(),
      owner_user_id: "",
      category: null,
      title: t,
      body: b,
      created_at: new Date().toISOString(),
    };
    setSnippets((prev) => [optimistic, ...prev]);
    setTitle("");
    setBody("");
    const fd = new FormData();
    fd.set("title", t);
    fd.set("body", b);
    startTransition(() => createSnippet(fd));
  }
  function remove(id: string) {
    setSnippets((prev) => prev.filter((s) => s.id !== id));
    startTransition(() => deleteSnippet(id));
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
      <p className="mono-label mb-3">Insight snippets</p>
      <div className="space-y-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Snippet title"
          className="w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-1.5 text-xs text-pulse-text placeholder:text-pulse-text-mute focus:outline-none"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Reusable text in your voice"
          className="w-full resize-y rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-1.5 text-xs text-pulse-text placeholder:text-pulse-text-mute focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          className="w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 py-1.5 text-xs text-pulse-text-dim hover:text-pulse-text"
        >
          Save snippet
        </button>
      </div>
      <div className="mt-4 space-y-2">
        {snippets.map((s) => (
          <div
            key={s.id}
            className="flex items-start justify-between gap-2 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 p-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-pulse-text">
                {s.title}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[11px] text-pulse-text-mute">
                {s.body}
              </p>
            </div>
            <button
              type="button"
              onClick={() => remove(s.id)}
              aria-label="Delete snippet"
              className="shrink-0 text-pulse-text-mute hover:text-pulse-danger"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {snippets.length === 0 && (
          <p className="text-[11px] text-pulse-text-mute">
            Save bits of text you reuse, then drop them into any section.
          </p>
        )}
      </div>
    </div>
  );
}
