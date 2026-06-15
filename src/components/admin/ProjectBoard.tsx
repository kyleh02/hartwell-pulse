"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, GripVertical, CalendarClock } from "lucide-react";
import type { BoardCard } from "@/lib/types/database";
import {
  BOARD_COLUMNS,
  BOARD_COLUMN_KEYS,
  CARD_TYPE_LABEL,
  isColumnKey,
} from "@/lib/board-shared";
import { cn } from "@/lib/utils/cn";

interface BoardProps {
  cards: BoardCard[];
  clientName: (id: string | null) => string | null;
  onCardsChange: (next: BoardCard[]) => void;
  onAddCard: (columnKey: string) => void;
  onEditCard: (card: BoardCard) => void;
}

const COLUMN_COLOR: Record<string, { dot: string; count: string; bar: string }> = {
  pending: { dot: "bg-pulse-text-mute", count: "text-pulse-text-mute", bar: "bg-pulse-text-mute/40" },
  in_progress: { dot: "bg-pulse-warn", count: "text-pulse-warn", bar: "bg-pulse-warn/60" },
  delivered: { dot: "bg-pulse-success", count: "text-pulse-success", bar: "bg-pulse-success/60" },
};

function dueLabel(due: string) {
  return new Date(`${due}T00:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

function Card({
  card,
  clientName,
  onEdit,
}: {
  card: BoardCard;
  clientName: (id: string | null) => string | null;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const name = clientName(card.client_id);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 p-3"
    >
      <div className="flex items-start gap-2">
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label="Drag card"
          className="mt-0.5 cursor-grab touch-none text-pulse-text-mute hover:text-pulse-text active:cursor-grabbing"
        >
          <GripVertical size={14} />
        </button>
        <button onClick={onEdit} className="min-w-0 flex-1 text-left">
          <p className="text-sm text-pulse-text">{card.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="data-mono text-[10px] uppercase tracking-wider text-pulse-text-mute">
              {CARD_TYPE_LABEL[card.card_type] ?? card.card_type}
            </span>
            {name && (
              <span className="data-mono text-[10px] text-pulse-gold">{name}</span>
            )}
            {card.due_date && (
              <span className="inline-flex items-center gap-1 text-[10px] text-pulse-text-mute">
                <CalendarClock size={10} /> {dueLabel(card.due_date)}
              </span>
            )}
          </div>
        </button>
      </div>
    </div>
  );
}

function Column({
  colKey,
  label,
  cards,
  clientName,
  onAddCard,
  onEditCard,
}: {
  colKey: string;
  label: string;
  cards: BoardCard[];
  clientName: (id: string | null) => string | null;
  onAddCard: (columnKey: string) => void;
  onEditCard: (card: BoardCard) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: colKey });
  const color = COLUMN_COLOR[colKey] ?? COLUMN_COLOR.pending;
  return (
    <div className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
      <div className={cn("h-1", color.bar)} />
      <div className="flex items-center justify-between border-b border-pulse-border px-3 py-2.5">
        <span className="mono-label flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", color.dot)} />
          {label}{" "}
          <span className={color.count}>{cards.length}</span>
        </span>
        <button
          type="button"
          onClick={() => onAddCard(colKey)}
          aria-label={`Add card to ${label}`}
          className="text-pulse-text-mute hover:text-pulse-text"
        >
          <Plus size={15} />
        </button>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-[140px] flex-1 space-y-2 p-2 transition-colors",
          isOver && "bg-pulse-surface-2/40",
        )}
      >
        <SortableContext
          items={cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {cards.map((c) => (
            <Card
              key={c.id}
              card={c}
              clientName={clientName}
              onEdit={() => onEditCard(c)}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

export function ProjectBoard({
  cards,
  clientName,
  onCardsChange,
  onAddCard,
  onEditCard,
}: BoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const inColumn = (col: string) =>
    cards.filter((c) => c.column_key === col).sort((a, b) => a.position - b.position);

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;
    const activeCard = cards.find((c) => c.id === activeId);
    if (!activeCard) return;

    const targetCol = isColumnKey(overId)
      ? overId
      : cards.find((c) => c.id === overId)?.column_key;
    if (!targetCol) return;

    const next: BoardCard[] = [];
    for (const col of BOARD_COLUMN_KEYS) {
      let list = inColumn(col).filter((c) => c.id !== activeId);
      if (col === targetCol) {
        let idx = list.length;
        if (!isColumnKey(overId)) {
          const i = list.findIndex((c) => c.id === overId);
          idx = i < 0 ? list.length : i;
        }
        list = [
          ...list.slice(0, idx),
          { ...activeCard, column_key: col },
          ...list.slice(idx),
        ];
      }
      list.forEach((c, i) => next.push({ ...c, column_key: col, position: i }));
    }
    onCardsChange(next);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragEnd={handleDragEnd}
    >
      <div className="grid gap-3 md:grid-cols-3">
        {BOARD_COLUMNS.map((col) => (
          <Column
            key={col.key}
            colKey={col.key}
            label={col.label}
            cards={inColumn(col.key)}
            clientName={clientName}
            onAddCard={onAddCard}
            onEditCard={onEditCard}
          />
        ))}
      </div>
      <DragOverlay>
        {activeId ? (
          <div className="rounded-[var(--radius-input)] border border-pulse-gold/40 bg-pulse-surface-2 p-3 text-sm text-pulse-text shadow-xl">
            {cards.find((c) => c.id === activeId)?.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
