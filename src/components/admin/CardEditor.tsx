"use client";

import { useState } from "react";
import { X, Trash2 } from "lucide-react";
import { BOARD_COLUMNS, CARD_TYPES } from "@/lib/board-shared";
import { Button } from "@/components/ui/Button";

export interface CardDraft {
  id?: string;
  title: string;
  client_id: string | null;
  card_type: string;
  column_key: string;
  due_date: string | null;
  description: string;
}

export function CardEditor({
  initial,
  clients,
  onSave,
  onClose,
  onDelete,
}: {
  initial: CardDraft;
  clients: { id: string; business_name: string }[];
  onSave: (draft: CardDraft) => void | Promise<void>;
  onClose: () => void;
  onDelete?: (id: string) => void | Promise<void>;
}) {
  const [title, setTitle] = useState(initial.title);
  const [clientId, setClientId] = useState(initial.client_id ?? "");
  const [cardType, setCardType] = useState(initial.card_type);
  const [columnKey, setColumnKey] = useState(initial.column_key);
  const [dueDate, setDueDate] = useState(initial.due_date ?? "");
  const [description, setDescription] = useState(initial.description);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    await onSave({
      id: initial.id,
      title: title.trim(),
      client_id: clientId || null,
      card_type: cardType,
      column_key: columnKey,
      due_date: dueDate || null,
      description,
    });
    setSaving(false);
  }

  const field =
    "mt-1.5 w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
        <div className="flex items-center justify-between border-b border-pulse-border px-4 py-3">
          <p className="text-sm font-medium text-pulse-text">
            {initial.id ? "Edit card" : "New card"}
          </p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <label className="block">
            <span className="mono-label">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={field}
              placeholder="e.g. June report for Demo Co"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mono-label">Client</span>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className={field}
              >
                <option value="">No client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.business_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mono-label">Type</span>
              <select
                value={cardType}
                onChange={(e) => setCardType(e.target.value)}
                className={field}
              >
                {CARD_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mono-label">Column</span>
              <select
                value={columnKey}
                onChange={(e) => setColumnKey(e.target.value)}
                className={field}
              >
                {BOARD_COLUMNS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mono-label">Due date</span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={field}
              />
            </label>
          </div>
          <label className="block">
            <span className="mono-label">Notes</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={field}
            />
          </label>
        </div>

        <div className="flex items-center justify-between border-t border-pulse-border px-4 py-3">
          {initial.id && onDelete ? (
            <button
              type="button"
              onClick={() => onDelete(initial.id!)}
              className="inline-flex items-center gap-1.5 text-xs text-pulse-text-mute hover:text-pulse-danger"
            >
              <Trash2 size={13} /> Delete
            </button>
          ) : (
            <span />
          )}
          <Button size="sm" onClick={save} disabled={saving || !title.trim()}>
            {initial.id ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}
