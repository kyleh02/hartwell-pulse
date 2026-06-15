"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { CalendarRange, KanbanSquare, Plus } from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";
import type { BoardCard, BoardColumn } from "@/lib/types/database";
import { ProjectBoard } from "@/components/admin/ProjectBoard";
import { ProjectCalendar } from "@/components/admin/ProjectCalendar";
import { CardEditor, type CardDraft } from "@/components/admin/CardEditor";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

export function AdminDashboard({
  initialCards,
  clients,
  today,
}: {
  initialCards: BoardCard[];
  clients: { id: string; business_name: string }[];
  today: string;
}) {
  const supabase = useSupabaseClient();
  const { userId } = useAuth();
  const [view, setView] = useState<"board" | "calendar">("board");
  const [cards, setCards] = useState<BoardCard[]>(initialCards);
  const [editing, setEditing] = useState<CardDraft | null>(null);

  const nameMap = new Map(clients.map((c) => [c.id, c.business_name]));
  const clientName = (id: string | null) => (id ? (nameMap.get(id) ?? null) : null);

  async function persistChanged(next: BoardCard[]) {
    const changed = next.filter((nc) => {
      const old = cards.find((c) => c.id === nc.id);
      return old && (old.column_key !== nc.column_key || old.position !== nc.position);
    });
    setCards(next);
    await Promise.all(
      changed.map((c) =>
        supabase
          .from("board_cards")
          .update({ column_key: c.column_key, position: c.position })
          .eq("id", c.id),
      ),
    );
  }

  function openNew(columnKey: string, dueDate?: string) {
    setEditing({
      title: "",
      client_id: null,
      card_type: "other",
      column_key: columnKey,
      due_date: dueDate ?? null,
      description: "",
    });
  }
  function openEdit(card: BoardCard) {
    setEditing({
      id: card.id,
      title: card.title,
      client_id: card.client_id,
      card_type: card.card_type,
      column_key: card.column_key,
      due_date: card.due_date,
      description: card.description ?? "",
    });
  }

  async function saveCard(draft: CardDraft) {
    const patch = {
      title: draft.title,
      client_id: draft.client_id,
      card_type: draft.card_type,
      column_key: draft.column_key as BoardColumn,
      due_date: draft.due_date,
      description: draft.description || null,
    };
    if (draft.id) {
      setCards((prev) =>
        prev.map((c) => (c.id === draft.id ? { ...c, ...patch } : c)),
      );
      setEditing(null);
      await supabase.from("board_cards").update(patch).eq("id", draft.id);
    } else {
      const position = cards.filter((c) => c.column_key === draft.column_key).length;
      const { data } = await supabase
        .from("board_cards")
        .insert({ ...patch, position, created_by: userId ?? null })
        .select("*")
        .single();
      if (data) setCards((prev) => [...prev, data as BoardCard]);
      setEditing(null);
    }
  }

  async function deleteCard(id: string) {
    setCards((prev) => prev.filter((c) => c.id !== id));
    setEditing(null);
    await supabase.from("board_cards").delete().eq("id", id);
  }

  const toggleBtn = (key: "calendar" | "board", label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => setView(key)}
      className={cn(
        "flex items-center gap-2 rounded-[6px] px-3 py-1.5 text-sm transition-colors",
        view === key
          ? "bg-pulse-surface-2 text-pulse-text"
          : "text-pulse-text-dim hover:text-pulse-text",
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-2">
        <div className="inline-flex rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface p-1">
          {toggleBtn("calendar", "Calendar", <CalendarRange size={16} strokeWidth={1.75} />)}
          {toggleBtn("board", "Board", <KanbanSquare size={16} strokeWidth={1.75} />)}
        </div>
        <Button size="sm" onClick={() => openNew("pending")}>
          <Plus size={15} strokeWidth={2} /> New card
        </Button>
      </div>

      {view === "board" ? (
        <ProjectBoard
          cards={cards}
          clientName={clientName}
          onCardsChange={persistChanged}
          onAddCard={(col) => openNew(col)}
          onEditCard={openEdit}
        />
      ) : (
        <ProjectCalendar
          cards={cards}
          today={today}
          onEditCard={openEdit}
          onAddOnDay={(d) => openNew("pending", d)}
        />
      )}

      {editing && (
        <CardEditor
          initial={editing}
          clients={clients}
          onSave={saveCard}
          onClose={() => setEditing(null)}
          onDelete={editing.id ? deleteCard : undefined}
        />
      )}
    </div>
  );
}
