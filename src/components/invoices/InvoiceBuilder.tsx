"use client";

import { useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Send,
  MailCheck,
  RotateCcw,
  Layers,
  GripVertical,
} from "lucide-react";
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
import { cn } from "@/lib/utils/cn";
import type {
  BusinessSettings,
  GstMode,
  InvoiceBrand,
  EmailEvent,
  InvoiceLineItem,
  InvoiceSend,
  InvoiceStatus,
  PricingItem,
  RateMode,
} from "@/lib/types/database";
import type { InvoiceBundle, LineDraft } from "@/lib/invoices-shared";
import {
  computeTotals,
  lineAmount,
  formatMoney,
  groupByPhase,
  hourlySummary,
  DEFAULT_INVOICE_EMAIL,
} from "@/lib/invoices-shared";
import {
  saveInvoice,
  sendInvoice,
  resendInvoice,
  sendTestInvoice,
  setInvoiceStatus,
  deleteInvoice,
} from "@/app/admin/invoices/actions";
import { InvoiceDocument } from "@/components/invoices/InvoiceDocument";
import {
  RecipientPicker,
  type InvoicePerson,
} from "@/components/invoices/RecipientPicker";
import { PrintButton } from "@/components/invoices/PrintButton";
import { SendHistory } from "@/components/invoices/SendHistory";
import { LastSent } from "@/components/invoices/LastSent";
import { Button } from "@/components/ui/Button";
import { celebrate } from "@/lib/celebrate";
import { requestDocumentPdf } from "@/lib/pdf-client";
import { Badge } from "@/components/ui/Badge";

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * A drop target that is the whole phase, not just the gaps between its lines.
 *
 * Without it a phase could only be dropped INTO by aiming at one of its existing
 * lines, so the last line of a phase could never be dragged past the end of
 * another one.
 */
function DropZone({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        className,
        "rounded-[var(--radius-input)] transition-colors",
        isOver && "bg-pulse-gold/5 ring-1 ring-pulse-gold/30",
      )}
    >
      {children}
    </div>
  );
}

/**
 * One line editor.
 *
 * Declared at module scope on purpose. Defined inside InvoiceBuilder it would be
 * a new component type on every render, so React would unmount and remount every
 * row on each keystroke and the field being typed in would lose focus.
 */
function SortableLine({
  line: l,
  editable,
  hourly,
  hourlyRate,
  fieldCls,
  phaseOptions,
  custom,
  onUpdate,
  onRemove,
  onMovePhase,
  onMarkCustom,
  onClearCustom,
}: {
  line: LineDraft;
  editable: boolean;
  hourly: boolean;
  hourlyRate: string;
  fieldCls: string;
  phaseOptions: { pos: number; label: string }[];
  custom: boolean;
  onUpdate: (id: string, patch: Partial<LineDraft>) => void;
  onRemove: (id: string) => void;
  onMovePhase: (id: string, pos: number) => void;
  onMarkCustom: (id: string) => void;
  onClearCustom: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: l.id, disabled: !editable });
  // transition is what makes the other rows glide aside as one is dragged over
  // them, rather than snapping.
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    // The listeners sit on the whole card, not just the grip. A drag handle the
    // size of an icon is easy to miss and easy to miss AIMING at, and the first
    // thing anyone tries is to grab the card itself.
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      className={cn(
        "flex items-start gap-2 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2/30 p-2",
        // touch-none stops the browser scrolling the page instead of dragging.
        editable && "touch-none cursor-grab active:cursor-grabbing",
        isDragging && "z-10",
      )}
    >
      {editable && (
        <span
          ref={setActivatorNodeRef}
          {...attributes}
          aria-label="Drag to reorder"
          className="mt-2 text-pulse-text-mute"
        >
          <GripVertical size={14} />
        </span>
      )}
      <div
        className="min-w-0 flex-1 space-y-2"
        // The fields are inside the draggable card, so their events have to be
        // kept out of it: without this a click into a box would start a drag,
        // and a space typed into the title would be read as "pick this up".
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <input
          value={l.title}
          disabled={!editable}
          onChange={(e) => onUpdate(l.id, { title: e.target.value })}
          placeholder="Title — e.g. Custom website design & build"
          className={`${fieldCls} w-full font-medium`}
        />
        <textarea
          value={l.description}
          disabled={!editable}
          onChange={(e) => onUpdate(l.id, { description: e.target.value })}
          placeholder="Description (optional) — what they're getting and why it's worth it. Shows beneath the title."
          rows={2}
          className={`${fieldCls} w-full resize-y`}
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {editable && phaseOptions.length > 1 && l.phase_position !== null && (
            <select
              value={l.phase_position}
              aria-label="Phase"
              onChange={(e) => onMovePhase(l.id, Number(e.target.value))}
              className={`${fieldCls} mr-auto text-xs`}
            >
              {phaseOptions.map((o) => (
                <option key={o.pos} value={o.pos}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          <span className="mono-label">{hourly ? "Hours" : "Qty"}</span>
          <input
            type="number"
            step="any"
            value={l.quantity}
            disabled={!editable}
            onChange={(e) => onUpdate(l.id, { quantity: Number(e.target.value) })}
            className={`${fieldCls} w-16 text-right`}
          />
          {hourly &&
            lineAmount(l) >= 0 &&
            (custom ? (
              <>
                <span className="mono-label">Rate</span>
                <input
                  type="number"
                  step="any"
                  value={l.unit_amount}
                  disabled={!editable}
                  onChange={(e) =>
                    onUpdate(l.id, { unit_amount: Number(e.target.value) })
                  }
                  className={`${fieldCls} w-20 text-right`}
                />
                {editable && (
                  <button
                    type="button"
                    onClick={() => onClearCustom(l.id)}
                    className="text-[11px] text-pulse-text-mute underline hover:text-pulse-text"
                  >
                    standard
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                disabled={!editable}
                onClick={() => onMarkCustom(l.id)}
                title="Bill this line at a different rate"
                className="data-mono rounded-[var(--radius-input)] border border-dashed border-pulse-border px-2 py-1 text-xs text-pulse-text-mute hover:text-pulse-text disabled:opacity-60"
              >
                {formatMoney(Number(hourlyRate) || 0)}/hr
              </button>
            ))}
          {(!hourly || lineAmount(l) < 0) && (
            <>
              <span className="mono-label">{hourly ? "Amount" : "Unit"}</span>
              <input
                type="number"
                step="any"
                value={l.unit_amount}
                disabled={!editable}
                onChange={(e) =>
                  onUpdate(l.id, { unit_amount: Number(e.target.value) })
                }
                className={`${fieldCls} w-24 text-right`}
              />
            </>
          )}
          <span className="data-mono w-24 text-right text-sm text-pulse-text">
            {formatMoney(lineAmount(l))}
          </span>
          {editable && (
            <button
              type="button"
              onClick={() => onRemove(l.id)}
              aria-label="Remove line"
              className="text-pulse-text-mute hover:text-pulse-danger"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS_TONE: Record<InvoiceStatus, "neutral" | "gold" | "success" | "danger"> = {
  draft: "neutral",
  sent: "gold",
  paid: "success",
  void: "danger",
};

export function InvoiceBuilder({
  bundle,
  pricingItems,
  business,
  people = [],
  sends = [],
  emailEvents = [],
}: {
  bundle: InvoiceBundle;
  pricingItems: PricingItem[];
  business: BusinessSettings | null;
  people?: InvoicePerson[];
  sends?: InvoiceSend[];
  emailEvents?: EmailEvent[];
}) {
  const { invoice } = bundle;
  const [lines, setLines] = useState<LineDraft[]>(() =>
    bundle.lines.map((l) => ({
      id: l.id,
      title: l.title ?? "",
      description: l.description,
      quantity: Number(l.quantity),
      unit_amount: Number(l.unit_amount),
      phase_position: l.phase_position ?? null,
      phase_title: l.phase_title ?? "",
      phase_note: l.phase_note ?? "",
    })),
  );
  const [issueDate, setIssueDate] = useState(invoice.issue_date.slice(0, 10));
  const [dueDate, setDueDate] = useState(invoice.due_date.slice(0, 10));
  const [gstMode, setGstMode] = useState<GstMode>(invoice.gst_mode);
  const [rateMode, setRateMode] = useState<RateMode>(invoice.rate_mode ?? "fixed");
  // The rate is a property of the invoice, not of each line: it is typed once
  // here and written down onto every charge line, which is what lets the
  // document drop the per-line Rate column.
  // The standard rate, resolved once and shared by the rate box and the
  // override seeding below so they can never disagree about what "standard"
  // means.
  //
  // Invoices built before the rate was stored on the invoice have it only on
  // their lines, which is where it used to live. Reading the column alone left
  // those showing a blank rate box and a $0.00/hr button on every line, and
  // pressing "standard" then zeroed the line, because nothing is what it
  // thought the standard was. Fall back to the lines, and the next save writes
  // it to the column for good.
  const resolvedRate =
    invoice.hourly_rate !== null && invoice.hourly_rate !== undefined
      ? Number(invoice.hourly_rate)
      : hourlySummary(
          bundle.lines.map((l) => ({
            quantity: Number(l.quantity),
            unit_amount: Number(l.unit_amount),
          })),
        ).rate;
  const [hourlyRate, setHourlyRate] = useState(
    resolvedRate === null ? "" : String(resolvedRate),
  );
  // Lines billed at something other than the standard rate. Held in the UI
  // rather than the database: a line IS overridden exactly when its rate differs
  // from the invoice's, so reopening the invoice reconstructs this from the
  // figures themselves and there is no flag to fall out of step with them.
  const [customIds, setCustomIds] = useState<Set<string>>(() => {
    if (resolvedRate === null) return new Set();
    return new Set(
      bundle.lines
        .filter(
          (l) => Number(l.unit_amount) > 0 && Number(l.unit_amount) !== resolvedRate,
        )
        .map((l) => l.id),
    );
  });
  const [brand, setBrand] = useState(invoice.brand ?? "hartwell");
  const [deposit, setDeposit] = useState(String(invoice.deposit_amount ?? 0));
  const [depositLabel, setDepositLabel] = useState(invoice.deposit_label ?? "");
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [emailMessage, setEmailMessage] = useState(
    () =>
      invoice.email_message ??
      business?.invoice_email_message ??
      DEFAULT_INVOICE_EMAIL,
  );
  const [recipients, setRecipients] = useState<string[]>(
    () => invoice.recipient_user_ids ?? [],
  );
  const [recurringActive, setRecurringActive] = useState(
    invoice.recurring_active ?? false,
  );
  const [anchorDay, setAnchorDay] = useState(invoice.recurring_anchor_day ?? 1);
  const [recurringTerms, setRecurringTerms] = useState(
    String(invoice.recurring_terms_days ?? ""),
  );
  const [status, setStatus] = useState<InvoiceStatus>(invoice.status);
  const [saved, setSaved] = useState(true);
  const [testNote, setTestNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A sent invoice stays editable so a wrong one can be corrected and reissued
  // under the same number. Paid and void are closed records: a paid invoice is
  // what the money was against, and a void one exists to preserve what was
  // cancelled. The server enforces the same thing.
  const editable = status === "draft" || status === "sent";
  const isDraft = status === "draft";
  const totals = computeTotals(lines, gstMode);
  const hourly = rateMode === "hourly";
  /** A new line starts at the invoice rate when billing hourly. */
  function defaultUnit() {
    return hourly ? Number(hourlyRate) || 0 : 0;
  }
  /**
   * Retype the standard rate onto the lines that follow it.
   *
   * Overridden lines and discount lines are left alone: the whole point of an
   * override is that changing the standard does not disturb it.
   */
  function applyHourlyRate(next: string) {
    setHourlyRate(next);
    const n = Number(next) || 0;
    setLines((p) =>
      p.map((l) =>
        lineAmount(l) < 0 || customIds.has(l.id) ? l : { ...l, unit_amount: n },
      ),
    );
    touch();
  }
  /** Let this line be billed at its own rate, starting from the standard one. */
  function markCustom(id: string) {
    setCustomIds((p) => new Set(p).add(id));
  }
  /** Put the line back on the standard rate. */
  function clearCustom(id: string) {
    setCustomIds((p) => {
      const next = new Set(p);
      next.delete(id);
      return next;
    });
    // With no standard rate set there is nothing to go back TO, and writing the
    // 0 that an empty box parses to would wipe a real figure. Just stop treating
    // the line as an override.
    if (hourlyRate === "") return;
    setLines((p) =>
      p.map((l) => (l.id === id ? { ...l, unit_amount: Number(hourlyRate) } : l)),
    );
    touch();
  }
  // Phasing is not a separate flag: an invoice is phased when its lines carry a
  // phase. One source of truth means the toggle can never disagree with the
  // document.
  const phased = lines.some((l) => l.phase_position !== null);
  const groups = groupByPhase(lines);
  const phaseOptions = groups
    .filter((g) => g.title !== null)
    .map((g) => ({ pos: g.lines[0].phase_position as number, label: g.title as string }));

  function touch() {
    setSaved(false);
  }
  // A line added at the bottom of a phased invoice belongs to the last phase.
  // Without this it falls out the back as an unphased row sitting under the final
  // phase subtotal, which reads on the document like a mistake.
  function tailPhase(p: LineDraft[]) {
    const last = p[p.length - 1];
    return {
      phase_position: last?.phase_position ?? null,
      phase_title: last?.phase_title ?? "",
      phase_note: last?.phase_note ?? "",
    };
  }
  function addBlank() {
    setLines((p) => [
      ...p,
      {
        id: newId(),
        title: "",
        description: "",
        quantity: 1,
        unit_amount: defaultUnit(),
        ...tailPhase(p),
      },
    ]);
    touch();
  }
  function addDiscount() {
    // A discount is just a line with a negative amount — enter the amount as e.g. -500.
    setLines((p) => [
      ...p,
      {
        id: newId(),
        title: "Discount",
        description: "",
        quantity: 1,
        unit_amount: 0,
        ...tailPhase(p),
      },
    ]);
    touch();
  }
  function addFromCatalogue(itemId: string) {
    const it = pricingItems.find((p) => p.id === itemId);
    if (!it) return;
    setLines((p) => [
      ...p,
      {
        id: newId(),
        title: it.name,
        description: it.tier ?? "",
        quantity: 1,
        unit_amount: Number(it.default_amount),
        ...tailPhase(p),
      },
    ]);
    touch();
  }
  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((p) => p.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    touch();
  }
  function removeLine(id: string) {
    setLines((p) => p.filter((l) => l.id !== id));
    touch();
  }

  // ---- phases ------------------------------------------------------------
  // A phase is not a record of its own: it is the run of lines that share a
  // phase_position, with the heading copied onto each of them. That is why every
  // operation below rewrites lines rather than a phase list, and why the order of
  // `lines` stays meaningful — the document groups by walking it.
  function blankLine(pos: number | null, title: string, note: string): LineDraft {
    return {
      id: newId(),
      title: "",
      description: "",
      quantity: 1,
      unit_amount: defaultUnit(),
      phase_position: pos,
      phase_title: title,
      phase_note: note,
    };
  }
  /** Index of the last line in a phase, so an addition lands inside it. */
  function lastIndexOfPhase(p: LineDraft[], pos: number) {
    let at = -1;
    p.forEach((l, i) => {
      if (l.phase_position === pos) at = i;
    });
    return at;
  }
  function enablePhases() {
    setLines((p) =>
      p.length === 0
        ? [blankLine(0, "Phase 1", "")]
        : p.map((l) => ({
            ...l,
            phase_position: 0,
            phase_title: l.phase_title || "Phase 1",
          })),
    );
    touch();
  }
  function removePhases() {
    setLines((p) =>
      p.map((l) => ({ ...l, phase_position: null, phase_title: "", phase_note: "" })),
    );
    touch();
  }
  function addPhase() {
    setLines((p) => {
      const next =
        p.reduce(
          (m, l) => (l.phase_position === null ? m : Math.max(m, l.phase_position)),
          -1,
        ) + 1;
      return [...p, blankLine(next, "Phase " + String(next + 1), "")];
    });
    touch();
  }
  function updatePhase(pos: number, patch: Partial<LineDraft>) {
    setLines((p) => p.map((l) => (l.phase_position === pos ? { ...l, ...patch } : l)));
    touch();
  }
  function removePhase(pos: number) {
    setLines((p) => {
      const kept = p.filter((l) => l.phase_position !== pos);
      // Renumber what is left so the phases stay 0..n-1 in document order. A gap
      // would still render, but a "Phase 3" with no Phase 2 above it is exactly
      // the kind of thing a client notices.
      const order: number[] = [];
      for (const l of kept) {
        if (l.phase_position !== null && !order.includes(l.phase_position)) {
          order.push(l.phase_position);
        }
      }
      return kept.map((l) =>
        l.phase_position === null
          ? l
          : { ...l, phase_position: order.indexOf(l.phase_position) },
      );
    });
    touch();
  }
  function addLineToPhase(pos: number) {
    setLines((p) => {
      const head = p.find((l) => l.phase_position === pos);
      const line = blankLine(pos, head?.phase_title ?? "", head?.phase_note ?? "");
      const at = lastIndexOfPhase(p, pos);
      return at < 0 ? [...p, line] : [...p.slice(0, at + 1), line, ...p.slice(at + 1)];
    });
    touch();
  }
  // A short distance before a drag starts, so a click on the handle is still a
  // click and does not have to be perfectly still.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const activeLine = activeLineId
    ? (lines.find((l) => l.id === activeLineId) ?? null)
    : null;

  /**
   * Drop a line into its new place, in whichever phase it landed in.
   *
   * `lines` is the document order and phases are contiguous runs of it, so a
   * move is one splice: lift the line out, work out the index it was dropped
   * at, and put it back carrying the heading of whatever run it now belongs to.
   * Dropping on the phase itself, rather than on one of its lines, appends -
   * which is the only way to drag a line past the end of a phase.
   */
  function handleLineDragEnd(e: DragEndEvent) {
    setActiveLineId(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;
    const moving = lines.find((l) => l.id === activeId);
    if (!moving) return;

    setLines((p) => {
      const rest = p.filter((l) => l.id !== activeId);
      let targetPos: number | null;
      let at: number;
      if (overId.startsWith("phase:")) {
        const raw = overId.slice("phase:".length);
        targetPos = raw === "none" ? null : Number(raw);
        let last = -1;
        rest.forEach((l, i) => {
          if ((l.phase_position ?? null) === targetPos) last = i;
        });
        at = last < 0 ? rest.length : last + 1;
      } else {
        const i = rest.findIndex((l) => l.id === overId);
        if (i < 0) return p;
        targetPos = rest[i].phase_position;
        at = i;
      }
      // The heading is denormalised onto every line of a phase, so a line
      // arriving in one has to be given that phase's heading or it would start a
      // second run under the old title.
      const head =
        targetPos === null
          ? undefined
          : rest.find((l) => l.phase_position === targetPos);
      const moved: LineDraft = {
        ...moving,
        phase_position: targetPos,
        phase_title:
          targetPos === null ? "" : (head?.phase_title ?? moving.phase_title),
        phase_note:
          targetPos === null ? "" : (head?.phase_note ?? moving.phase_note),
      };
      return [...rest.slice(0, at), moved, ...rest.slice(at)];
    });
    touch();
  }

  function moveLineToPhase(id: string, pos: number) {
    setLines((p) => {
      const line = p.find((l) => l.id === id);
      if (!line || line.phase_position === pos) return p;
      const rest = p.filter((l) => l.id !== id);
      const head = rest.find((l) => l.phase_position === pos);
      const moved: LineDraft = {
        ...line,
        phase_position: pos,
        phase_title: head?.phase_title ?? "Phase " + String(pos + 1),
        phase_note: head?.phase_note ?? "",
      };
      const at = lastIndexOfPhase(rest, pos);
      return at < 0
        ? [...rest, moved]
        : [...rest.slice(0, at + 1), moved, ...rest.slice(at + 1)];
    });
    touch();
  }

  // One line editor, used the same whether the invoice is phased or flat, so a
  // line cannot look or behave differently depending on where it sits.
  //
  // Both number fields take step="any" because hours come in quarters and halves
  // and the browser rejects a fractional value against the default step of 1,
  // which reads to the admin as the field simply refusing to accept 2.5.
  function lineCard(l: LineDraft) {
    return (
      <SortableLine
        key={l.id}
        line={l}
        editable={editable}
        hourly={hourly}
        hourlyRate={hourlyRate}
        fieldCls={fieldCls}
        phaseOptions={phaseOptions}
        custom={customIds.has(l.id)}
        onUpdate={updateLine}
        onRemove={removeLine}
        onMovePhase={moveLineToPhase}
        onMarkCustom={markCustom}
        onClearCustom={clearCustom}
      />
    );
  }

  function buildInput() {
    return {
      issue_date: issueDate,
      due_date: dueDate,
      brand,
      rate_mode: rateMode,
      hourly_rate: hourly && hourlyRate !== "" ? Number(hourlyRate) : null,
      deposit_amount: Number(deposit) || 0,
      deposit_label: depositLabel,
      gst_mode: gstMode,
      recipient_user_ids: recipients,
      notes,
      email_message: emailMessage,
      recurring_active: recurringActive,
      recurring_anchor_day: anchorDay,
      recurring_terms_days: recurringTerms === "" ? null : Number(recurringTerms),
      lines: lines.map((l) => ({
        title: l.title,
        description: l.description,
        quantity: Number(l.quantity) || 0,
        unit_amount: Number(l.unit_amount) || 0,
        phase_position: l.phase_position,
        phase_title: l.phase_title,
        phase_note: l.phase_note,
      })),
    };
  }
  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await saveInvoice(invoice.id, buildInput());
        setSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save.");
      }
    });
  }
  function test() {
    setError(null);
    setTestNote(null);
    startTransition(async () => {
      try {
        // Save first, so the proof reflects what is stored rather than what is
        // on screen. That distinction is the whole point of a test send.
        await saveInvoice(invoice.id, buildInput());
        setSaved(true);
        const to = await sendTestInvoice(invoice.id);
        setTestNote(`Test sent to ${to}. Nothing was recorded and the client got nothing.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not send the test.");
      }
    });
  }
  function send() {
    // A zero-total invoice is almost always a save that did not land.
    if (totals.total === 0) {
      if (
        !window.confirm(
          "This invoice totals $0.00.\n\nThat usually means the line items have not saved. Send it anyway?",
        )
      )
        return;
    }
    // Name them. A confirm that says "the client" is how an invoice reaches
    // someone it was never meant for.
    const going =
      recipients.length === 0
        ? people
        : people.filter((p) => recipients.includes(p.clerk_user_id));
    const who = going
      .map((p) => `${p.full_name ?? "Unnamed"}${p.email ? ` (${p.email})` : ""}`)
      .join("\n");
    if (
      !window.confirm(
        `Send invoice ${invoice.invoice_number} for ${formatMoney(totals.total)} now?\n\nIt goes to:\n${who || "nobody — check Send to"}\n\nThey get an email and a notification.`,
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      try {
        await saveInvoice(invoice.id, buildInput());
        // Make the PDF BEFORE sending, and through the route rather than the
        // action: rendering needs up to sixty seconds and a server action gets
        // ten. Failure here is deliberately ignored. The invoice still goes,
        // carrying a link instead of an attachment, because an invoice that
        // does not arrive is worse than one that arrives without its PDF.
        if (!invoice.pdf_path) {
          await requestDocumentPdf("invoice", invoice.id);
        }
        await sendInvoice(invoice.id);
        setStatus("sent");
        setSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not send.");
      }
    });
  }
  /**
   * Save the corrections, then email the same invoice number again.
   *
   * Saving first is the whole point: a resend that went out before the fix
   * landed would send the client the wrong version a second time.
   */
  function resend() {
    const going =
      recipients.length === 0
        ? people
        : people.filter((p) => recipients.includes(p.clerk_user_id));
    const who = going
      .map((p) => `${p.full_name ?? "Unnamed"}${p.email ? ` (${p.email})` : ""}`)
      .join("\n");
    if (
      !window.confirm(
        `Resend invoice ${invoice.invoice_number} for ${formatMoney(totals.total)}?\n\nIt goes to:\n${who || "nobody, check Send to"}\n\nSame invoice number, with whatever you have changed. Anyone not listed above gets nothing.`,
      )
    )
      return;
    setError(null);
    setTestNote(null);
    startTransition(async () => {
      try {
        await saveInvoice(invoice.id, buildInput());
        setSaved(true);
        const res = await resendInvoice(invoice.id);
        if (!res.ok) {
          setError(res.message);
          return;
        }
        setTestNote(
          res.sentTo.length
            ? `Resent to ${res.sentTo.join(", ")}.`
            : "Resent, though nobody on the account has an email address on file.",
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not resend.");
      }
    });
  }

  function mark(s: InvoiceStatus) {
    startTransition(async () => {
      await setInvoiceStatus(invoice.id, s);
      setStatus(s);
      // Getting paid is the only invoice state worth cheering. Sending one is
      // just work.
      if (s === "paid") {
        celebrate({
          title: `${formatMoney(totals.total)} paid`,
          message: `${bundle.client.business_name} settled ${invoice.invoice_number}.`,
          tone: "success",
          intensity: 3,
        });
      }
    });
  }
  function del() {
    if (
      !window.confirm(
        "Delete this draft invoice? This permanently removes it and can't be undone.",
      )
    )
      return;
    startTransition(async () => {
      await deleteInvoice(invoice.id);
    });
  }

  // live preview built from the current edits
  const previewBundle: InvoiceBundle = {
    invoice: {
      ...invoice,
      issue_date: issueDate,
      due_date: dueDate,
      brand,
      rate_mode: rateMode,
      hourly_rate: hourly && hourlyRate !== "" ? Number(hourlyRate) : null,
      deposit_amount: Number(deposit) || 0,
      deposit_label: depositLabel,
      gst_mode: gstMode,
      notes: notes || null,
      discount: totals.discount,
      subtotal: totals.subtotal,
      gst: totals.gst,
      total: totals.total,
      status,
    },
    client: bundle.client,
    lines: lines.map((l, i) => ({
      id: l.id,
      invoice_id: invoice.id,
      client_id: bundle.client.id,
      title: l.title || null,
      description: l.description,
      quantity: Number(l.quantity) || 0,
      unit_amount: Number(l.unit_amount) || 0,
      amount: lineAmount(l),
      position: i,
      phase_position: l.phase_position,
      phase_title: l.phase_position === null ? null : l.phase_title || null,
      phase_note: l.phase_position === null ? null : l.phase_note || null,
    })) as InvoiceLineItem[],
  };

  const fieldCls =
    "rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-2 py-1.5 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none disabled:opacity-60";

  return (
    <div>
      <Link
        href="/admin/invoices"
        className="no-print mb-4 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim transition-colors hover:text-pulse-text"
      >
        <ArrowLeft size={15} strokeWidth={1.75} /> All invoices
      </Link>

      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
        <div>
          <p className="data-mono text-sm text-pulse-text">
            {invoice.invoice_number} · {bundle.client.business_name}
          </p>
          <p className="text-xs text-pulse-text-mute">
            {formatMoney(totals.total)} total
          </p>
          <LastSent sends={sends} events={emailEvents} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[status]}>{status}</Badge>
          {editable && (
            <>
              {/* Drafts only. Anything sent is a financial record. */}
              {isDraft && (
                <Button variant="danger" size="sm" onClick={del} disabled={pending}>
                  <Trash2 size={14} /> Delete
                </Button>
              )}
              <span className="data-mono text-[11px] text-pulse-text-mute">
                {saved ? "saved" : "unsaved"}
              </span>
              <Button variant="secondary" size="sm" onClick={save} disabled={pending}>
                Save
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={test}
                disabled={pending}
                title="Send this invoice to yourself, exactly as the client would get it"
              >
                <MailCheck size={14} /> Test to me
              </Button>
              {isDraft ? (
                recurringActive ? (
                  <span className="data-mono text-[11px] text-pulse-gold">
                    auto-sends monthly
                  </span>
                ) : (
                  <Button size="sm" onClick={send} disabled={pending || lines.length === 0}>
                    <Send size={14} /> Send
                  </Button>
                )
              ) : (
                <Button size="sm" onClick={resend} disabled={pending}>
                  <RotateCcw size={14} /> Resend
                </Button>
              )}
            </>
          )}
          {status === "sent" && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => mark("paid")}
                disabled={pending}
              >
                Mark paid
              </Button>
              <Button variant="ghost" size="sm" onClick={() => mark("void")} disabled={pending}>
                Void
              </Button>
            </>
          )}
          {status === "paid" && (
            <Button variant="ghost" size="sm" onClick={() => mark("sent")} disabled={pending}>
              Reopen
            </Button>
          )}
        </div>
      </div>

      {/* This invoice is already in somebody's inbox. Say so before anything
          gets changed, not after. */}
      {status === "sent" && (
        <p className="no-print -mt-3 mb-6 rounded-[var(--radius-card)] border border-pulse-gold/30 bg-pulse-gold/10 px-4 py-3 text-sm text-pulse-gold">
          Already sent{invoice.last_sent_at ? " and in their inbox" : ""}. You
          can correct it and Resend under the same number, which is the right
          fix for one that has not been paid. Change who it goes to under Send
          to first if that is the part that was wrong.
        </p>
      )}

      {(error || testNote) && (
        <div className="no-print -mt-3 mb-6">
          {error && (
            <p className="rounded-[var(--radius-card)] border border-pulse-danger/40 bg-pulse-danger/10 px-4 py-3 text-sm text-pulse-danger">
              {error}
            </p>
          )}
          {testNote && !error && (
            <p className="rounded-[var(--radius-card)] border border-pulse-success/40 bg-pulse-success/10 px-4 py-3 text-sm text-pulse-success">
              {testNote}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* editor */}
        <div className="no-print space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="mono-label">Issue date</span>
              <input
                type="date"
                value={issueDate}
                disabled={!editable}
                onChange={(e) => {
                  setIssueDate(e.target.value);
                  touch();
                }}
                className={fieldCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="mono-label">Due date</span>
              <input
                type="date"
                value={dueDate}
                disabled={!editable}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  touch();
                }}
                className={fieldCls}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="mono-label">Issued under</span>
            <select
              value={brand}
              disabled={!editable}
              onChange={(e) => {
                setBrand(e.target.value as InvoiceBrand);
                touch();
              }}
              className={fieldCls}
            >
              <option value="hartwell">Hartwell Digital</option>
              <option value="ironpeak">Ironpeak Consulting</option>
            </select>
            <span className="text-[11px] text-pulse-text-mute">
              {brand === "ironpeak"
                ? "Ironpeak branding on a light document, ABN line only, no Hartwell Digital name. Same invoice number sequence."
                : "The standard Hartwell Digital invoice."}
            </span>
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="mono-label">Deposit received</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={deposit}
                disabled={!editable}
                onChange={(e) => {
                  setDeposit(e.target.value);
                  touch();
                }}
                className={fieldCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="mono-label">Deposit label</span>
              <input
                value={depositLabel}
                disabled={!editable}
                placeholder="Deposit received"
                onChange={(e) => {
                  setDepositLabel(e.target.value);
                  touch();
                }}
                className={fieldCls}
              />
            </label>
          </div>
          {Number(deposit) > 0 && (
            <p className="text-[11px] text-pulse-text-mute">
              Credited against the total, so the document shows the full contract
              value and then what is left to pay.
            </p>
          )}

          <label className="flex flex-col gap-1">
            <span className="mono-label">GST</span>
            <select
              value={gstMode}
              disabled={!editable}
              onChange={(e) => {
                setGstMode(e.target.value as GstMode);
                touch();
              }}
              className={fieldCls}
            >
              <option value="add">Add 10% GST (Tax Invoice)</option>
              <option value="inclusive">Prices include GST</option>
              <option value="none">No GST</option>
            </select>
          </label>

          <label className="flex items-start gap-2 text-sm text-pulse-text-dim">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={hourly}
              disabled={!editable}
              onChange={(e) => {
                setRateMode(e.target.checked ? "hourly" : "fixed");
                touch();
              }}
            />
            <span>
              Bill by the hour
              <span className="mt-0.5 block text-[11px] text-pulse-text-mute">
                Each line becomes hours at one rate. The invoice lists the hours
                and shows the rate once, beside the totals.
              </span>
            </span>
          </label>

          {hourly && (
            <label className="flex items-center gap-2 text-sm text-pulse-text-dim">
              <span className="mono-label">Hourly rate</span>
              <input
                type="number"
                step="any"
                value={hourlyRate}
                disabled={!editable}
                onChange={(e) => applyHourlyRate(e.target.value)}
                placeholder="95"
                className={`${fieldCls} w-24 text-right`}
              />
              <span className="text-[11px] text-pulse-text-mute">
                the standard rate. Press the rate on any line to bill that one
                differently.
              </span>
            </label>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-sm text-pulse-text-dim">
              <input
                type="checkbox"
                checked={recurringActive}
                disabled={!editable}
                onChange={(e) => {
                  setRecurringActive(e.target.checked);
                  touch();
                }}
              />
              Recurring monthly — auto-generate and send each month
            </label>
            {recurringActive && (
              <label className="flex items-center gap-2 pl-6 text-xs text-pulse-text-mute">
                Bill on day
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={anchorDay}
                  disabled={!editable}
                  onChange={(e) => {
                    setAnchorDay(Number(e.target.value));
                    touch();
                  }}
                  className={`${fieldCls} w-16 text-right`}
                />
                of each month (auto-sends until you switch this off)
              </label>
            )}
            {recurringActive && (
              <>
                <label className="flex items-center gap-2 pl-6 text-xs text-pulse-text-mute">
                  Terms
                  <input
                    type="number"
                    min={0}
                    placeholder="default"
                    value={recurringTerms}
                    disabled={!editable}
                    onChange={(e) => {
                      setRecurringTerms(e.target.value);
                      touch();
                    }}
                    className={`${fieldCls} w-20 text-right`}
                  />
                  days for this retainer (blank uses the business default)
                </label>
                <p className="pl-6 text-[11px] text-pulse-text-mute">
                  Write{" "}
                  <code className="data-mono text-pulse-gold">{"{service_period}"}</code>{" "}
                  in a line description or the notes and each generated invoice
                  fills in its own dates, e.g. 6 August to 5 September 2026.{" "}
                  <code className="data-mono text-pulse-gold">{"{service_start}"}</code>{" "}
                  and{" "}
                  <code className="data-mono text-pulse-gold">{"{service_end}"}</code>{" "}
                  work too.
                </p>
              </>
            )}
          </div>

          <div className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="mono-label">Line items</p>
              {editable && (
                <button
                  type="button"
                  onClick={phased ? removePhases : enablePhases}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-input)] border border-dashed border-pulse-border px-2 py-1 text-[11px] text-pulse-text-dim hover:text-pulse-text"
                >
                  <Layers size={12} />
                  {phased ? "Remove phases" : "Group into phases"}
                </button>
              )}
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={(e: DragStartEvent) => setActiveLineId(String(e.active.id))}
              onDragCancel={() => setActiveLineId(null)}
              onDragEnd={handleLineDragEnd}
            >
            {phased ? (
              <div className="space-y-3">
                {groups.map((g) => {
                  const pos = g.lines[0].phase_position;
                  // A run with no phase renders bare, so a line pulled out of a
                  // phase is still visible and editable rather than vanishing.
                  if (pos === null) {
                    return (
                      <DropZone key={g.key} id="phase:none" className="space-y-2">
                        <SortableContext
                          items={g.lines.map((l) => l.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {g.lines.map(lineCard)}
                        </SortableContext>
                      </DropZone>
                    );
                  }
                  return (
                    <div
                      key={g.key}
                      className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2/20 p-2.5"
                    >
                      <div className="mb-2 flex items-start gap-2">
                        <div className="flex-1 space-y-1.5">
                          <input
                            value={g.lines[0].phase_title}
                            disabled={!editable}
                            onChange={(e) =>
                              updatePhase(pos, { phase_title: e.target.value })
                            }
                            placeholder={`Phase ${pos + 1} — e.g. Design and build`}
                            className={`${fieldCls} w-full font-medium`}
                          />
                          <input
                            value={g.lines[0].phase_note}
                            disabled={!editable}
                            onChange={(e) =>
                              updatePhase(pos, { phase_note: e.target.value })
                            }
                            placeholder="Note (optional) — e.g. Payable on commencement"
                            className={`${fieldCls} w-full text-xs`}
                          />
                        </div>
                        {editable && (
                          <button
                            type="button"
                            onClick={() => removePhase(pos)}
                            aria-label="Remove phase and its lines"
                            className="mt-1.5 text-pulse-text-mute hover:text-pulse-danger"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                      <DropZone id={`phase:${pos}`} className="space-y-2">
                        <SortableContext
                          items={g.lines.map((l) => l.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {g.lines.map(lineCard)}
                        </SortableContext>
                      </DropZone>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        {editable ? (
                          <button
                            type="button"
                            onClick={() => addLineToPhase(pos)}
                            className="inline-flex items-center gap-1 rounded-[var(--radius-input)] border border-dashed border-pulse-border px-2 py-1 text-[11px] text-pulse-text-dim hover:text-pulse-text"
                          >
                            <Plus size={12} /> Line
                          </button>
                        ) : (
                          <span />
                        )}
                        <span className="text-xs text-pulse-text-mute">
                          Subtotal{" "}
                          <span className="data-mono text-pulse-text">
                            {formatMoney(g.subtotal)}
                          </span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <SortableContext
                items={lines.map((l) => l.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">{lines.map(lineCard)}</div>
              </SortableContext>
            )}
            {/* The lifted card follows the cursor while the row it came from
                stays faded in place, so it is always clear what is being moved
                and where it started. */}
            <DragOverlay>
              {activeLine ? (
                <div className="flex items-center gap-3 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface px-3 py-2 text-sm text-pulse-text shadow-lg">
                  <GripVertical size={14} className="text-pulse-text-mute" />
                  <span className="truncate">
                    {activeLine.title || "Untitled line"}
                  </span>
                  <span className="data-mono ml-auto text-pulse-text-mute">
                    {formatMoney(lineAmount(activeLine))}
                  </span>
                </div>
              ) : null}
            </DragOverlay>
            </DndContext>

            {editable && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={addBlank}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-input)] border border-dashed border-pulse-border px-2.5 py-1.5 text-xs text-pulse-text-dim hover:text-pulse-text"
                >
                  <Plus size={13} /> Line
                </button>
                <button
                  type="button"
                  onClick={addDiscount}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-input)] border border-dashed border-pulse-border px-2.5 py-1.5 text-xs text-pulse-text-dim hover:text-pulse-text"
                >
                  <Plus size={13} /> Discount
                </button>
                {phased && (
                  <button
                    type="button"
                    onClick={addPhase}
                    className="inline-flex items-center gap-1 rounded-[var(--radius-input)] border border-dashed border-pulse-border px-2.5 py-1.5 text-xs text-pulse-text-dim hover:text-pulse-text"
                  >
                    <Plus size={13} /> Phase
                  </button>
                )}
                {pricingItems.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) addFromCatalogue(e.target.value);
                      e.target.value = "";
                    }}
                    className={`${fieldCls} text-xs`}
                  >
                    <option value="">Add from catalogue…</option>
                    {pricingItems
                      .filter((p) => p.active)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.tier ? `${p.name} — ${p.tier}` : p.name} (
                          {formatMoney(Number(p.default_amount))})
                        </option>
                      ))}
                  </select>
                )}
              </div>
            )}
          </div>

          <label className="flex flex-col gap-1">
            <span className="mono-label">Notes</span>
            <textarea
              value={notes}
              disabled={!editable}
              onChange={(e) => {
                setNotes(e.target.value);
                touch();
              }}
              rows={3}
              placeholder="Anything the client should know (optional)."
              className={fieldCls}
            />
          </label>

          <div className="flex flex-col gap-2">
            <span className="mono-label">Send to</span>
            <RecipientPicker
              people={people}
              selected={recipients}
              onChange={(ids) => {
                setRecipients(ids);
                touch();
              }}
              disabled={!editable}
            />
          </div>

          <label className="flex flex-col gap-1">
            <span className="mono-label">Email message to client</span>
            <textarea
              value={emailMessage}
              disabled={!editable}
              onChange={(e) => {
                setEmailMessage(e.target.value);
                touch();
              }}
              rows={6}
              className={fieldCls}
            />
            <span className="text-[11px] text-pulse-text-mute">
              What the client receives in the invoice email. {"{client}"},{" "}
              {"{invoice}"}, {"{amount}"} and {"{due date}"} fill in automatically.
            </span>
          </label>
        </div>

        {/* live preview */}
        <div>
          <div className="no-print mb-2 flex items-center justify-between">
            <p className="mono-label">Preview</p>
            <PrintButton />
          </div>
          <InvoiceDocument bundle={previewBundle} business={business} />

          {sends.length > 0 && (
            <div className="mt-4">
              <SendHistory sends={sends} events={emailEvents} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
