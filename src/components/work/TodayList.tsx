"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { GripVertical } from "lucide-react";
import { WorkItemRow } from "@/components/work/WorkItemRow";
import { acknowledgeWork, reorderWork } from "@/app/admin/work/actions";
import {
  bucketFor,
  compareWork,
  daysOverdue,
  isSnoozed,
  type WorkRow,
} from "@/lib/work-shared";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

/** Overdue this long and unanswered gets asked about, once. */
const ASK_AFTER_DAYS = 7;

function Sortable({ row }: { row: WorkRow }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.65 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
    >
      <WorkItemRow
        row={row}
        dragHandle={
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            className="mt-0.5 flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-pulse-text-mute hover:text-pulse-text active:cursor-grabbing"
          >
            <GripVertical size={14} />
          </button>
        }
      />
    </div>
  );
}

function Group({
  label,
  count,
  children,
  collapsible = false,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  if (count === 0) return null;
  return (
    <section className="mb-10">
      <button
        type="button"
        onClick={() => collapsible && setOpen((v) => !v)}
        className="mb-4 flex w-full items-center gap-2.5 text-left"
        disabled={!collapsible}
      >
        <span className="mono-label">{label}</span>
        <span className="data-mono text-xs text-pulse-text-mute">{count}</span>
        <span className="h-px flex-1 bg-pulse-border" />
        {collapsible && (
          <span className="text-xs text-pulse-text-mute">
            {open ? "hide" : "show"}
          </span>
        )}
      </button>
      {open && <div className="space-y-2.5">{children}</div>}
    </section>
  );
}

/**
 * The list Kyle works down.
 *
 * Overdue first, then today, then the week, then things with no date. That
 * order is the answer to "what next", which is the question this page exists
 * for; the board and calendar answer the other two.
 *
 * Only Today is draggable. Ordering a day is a real decision and it sticks;
 * ordering next Thursday is arranging furniture in a room nobody is in yet.
 */
export function TodayList({ rows }: { rows: WorkRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [order, setOrder] = useState<string[] | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { overdue, today, later, someday, asking } = useMemo(() => {
    const live = rows.filter((r) => !isSnoozed(r));
    const o: WorkRow[] = [];
    const t: WorkRow[] = [];
    const l: WorkRow[] = [];
    const s: WorkRow[] = [];
    for (const r of live) {
      const b = bucketFor(r);
      if (b === "overdue") o.push(r);
      else if (b === "today") t.push(r);
      else if (b === "later") l.push(r);
      else s.push(r);
    }
    // Asked once, and only once. Answering sets asked_at and it never returns.
    const asking = o.filter(
      (r) => daysOverdue(r) >= ASK_AFTER_DAYS && !r.asked_at,
    );
    return {
      overdue: o.sort(compareWork),
      today: t.sort(compareWork),
      later: l.sort(compareWork),
      someday: s.sort(compareWork),
      asking,
    };
  }, [rows]);

  const todayOrdered = useMemo(() => {
    if (!order) return today;
    const byId = new Map(today.map((r) => [r.id, r]));
    const out = order.map((id) => byId.get(id)).filter(Boolean) as WorkRow[];
    for (const r of today) if (!order.includes(r.id)) out.push(r);
    return out;
  }, [today, order]);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = todayOrdered.map((r) => r.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    setOrder(next);
    startTransition(async () => {
      await reorderWork(next);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing on the list"
        description="Add something with the button above, or let the generators fill it as invoices fall due and sends come round."
      />
    );
  }

  return (
    <div>
      {asking.length > 0 && (
        <div className="mb-10 rounded-[var(--radius-card)] border border-pulse-warn/40 bg-pulse-warn/10 p-5">
          <p className="mono-label text-pulse-warn">Still doing these?</p>
          <p className="mt-2 max-w-2xl text-sm text-pulse-warn">
            Each of these has been overdue for a week or more. Answering settles
            it: this is asked once and never again, so nothing here nags you.
          </p>
          <ul className="mt-4 space-y-2">
            {asking.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3">
                <span className="flex-1 text-sm text-pulse-warn">{r.title}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await acknowledgeWork(r.id);
                      router.refresh();
                    })
                  }
                >
                  Yes, keep it
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Group label="Overdue" count={overdue.length}>
        {overdue.map((r) => (
          <WorkItemRow key={r.id} row={r} />
        ))}
      </Group>

      <section className="mb-10">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="mono-label">Today</span>
          <span className="data-mono text-xs text-pulse-text-mute">
            {todayOrdered.length}
          </span>
          <span className="h-px flex-1 bg-pulse-border" />
        </div>
        {todayOrdered.length === 0 ? (
          <p className="text-sm text-pulse-text-mute">
            Nothing due today. The week is below.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={todayOrdered.map((r) => r.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2.5">
                {todayOrdered.map((r) => (
                  <Sortable key={r.id} row={r} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>

      <Group label="Later" count={later.length} collapsible>
        {later.map((r) => (
          <WorkItemRow key={r.id} row={r} />
        ))}
      </Group>

      <Group label="Someday" count={someday.length} collapsible>
        {someday.map((r) => (
          <WorkItemRow key={r.id} row={r} />
        ))}
      </Group>
    </div>
  );
}
