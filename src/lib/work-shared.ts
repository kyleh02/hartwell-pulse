// Client-safe work item types and pure helpers. No server-only imports, so the
// Today list (a client component) and the server data layer can both use them.

export type WorkSourceKind =
  | "manual"
  | "crm_send"
  | "crm_task"
  | "invoice"
  | "report"
  | "recurring"
  | "notification";

export type WorkState = "open" | "done" | "dropped";

export interface WorkItem {
  id: string;
  title: string;
  detail: string | null;
  client_id: string | null;
  brand: "hartwell" | "ironpeak" | null;
  due_at: string | null;
  has_time: boolean;
  source_kind: WorkSourceKind;
  source_id: string | null;
  source_key: string | null;
  state: WorkState;
  done_at: string | null;
  dropped_at: string | null;
  drop_reason: string | null;
  snoozed_until: string | null;
  asked_at: string | null;
  nudged_at: string | null;
  position: number | null;
  hours: number | null;
  hours_note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkStep {
  id: string;
  work_item_id: string;
  label: string;
  done_at: string | null;
  position: number;
}

/** An item plus what the list needs to draw it. */
export interface WorkRow extends WorkItem {
  client_name: string | null;
  steps: WorkStep[];
}

export const TZ = "Australia/Brisbane";

/**
 * Where a row belongs on the Today page.
 *
 * `someday` is a real answer, not a fallback. An item with no date is work
 * Kyle intends to do and has not scheduled, and putting it in Today because it
 * has nowhere else to go is how a list stops being trustworthy.
 */
export type WorkBucket = "overdue" | "today" | "later" | "someday";

export function bucketFor(item: WorkItem, now = new Date()): WorkBucket {
  if (!item.due_at) return "someday";
  const due = new Date(item.due_at);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  if (due < startOfDay(now)) return "overdue";
  if (due <= endOfToday) return "today";
  return "later";
}

function startOfDay(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

/** Whole days an item is past due. Zero when it is not. */
export function daysOverdue(item: WorkItem, now = new Date()): number {
  if (!item.due_at) return 0;
  const diff = startOfDay(now).getTime() - startOfDay(new Date(item.due_at)).getTime();
  return Math.max(0, Math.round(diff / 86_400_000));
}

/**
 * Snoozed items are open but out of the way.
 *
 * Checked on read rather than by a job that flips state back, so a snooze can
 * never be lost to a cron that did not run.
 */
export function isSnoozed(item: WorkItem, now = new Date()): boolean {
  return Boolean(item.snoozed_until && new Date(item.snoozed_until) > now);
}

/**
 * The order of a day: positioned items first in their order, then anything
 * with a clock on it by that clock, then the rest by due date, then title.
 *
 * A drag writes `position` on one row and leaves the others alone, which is
 * why null sorts last rather than as zero.
 */
export function compareWork(a: WorkRow, b: WorkRow): number {
  if (a.position !== null && b.position !== null) return a.position - b.position;
  if (a.position !== null) return -1;
  if (b.position !== null) return 1;

  if (a.has_time && b.has_time && a.due_at && b.due_at) {
    return a.due_at < b.due_at ? -1 : a.due_at > b.due_at ? 1 : 0;
  }
  if (a.has_time !== b.has_time) return a.has_time ? -1 : 1;

  if (a.due_at && b.due_at && a.due_at !== b.due_at) return a.due_at < b.due_at ? -1 : 1;
  if (a.due_at && !b.due_at) return -1;
  if (!a.due_at && b.due_at) return 1;
  return a.title.localeCompare(b.title);
}

export function stepProgress(steps: WorkStep[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.done_at).length, total: steps.length };
}

/**
 * Whether ticking this off may act on its source, or must send Kyle to the
 * screen that owns it.
 *
 * The rule: a tick may never fabricate a record with legal or financial
 * weight. Logging a cold email writes the Spam Act touch, and marking an
 * invoice paid says money arrived. Both are things that must be true, and a
 * checkbox on a list of twelve is not where either gets decided.
 */
export function needsConfirmation(item: WorkItem): boolean {
  return item.source_kind === "crm_send" || item.source_kind === "invoice";
}

/** Where the confirm-elsewhere kinds send you. */
export function sourceHref(item: WorkItem): string | null {
  if (!item.source_id) return null;
  switch (item.source_kind) {
    case "crm_send":
    case "crm_task":
      return `/admin/crm/${item.source_id}`;
    case "invoice":
      return `/admin/invoices/${item.source_id}`;
    case "report":
      return `/admin/reports/${item.source_id}`;
    default:
      return null;
  }
}

export const SOURCE_LABEL: Record<WorkSourceKind, string> = {
  manual: "Task",
  crm_send: "Outreach",
  crm_task: "Outreach",
  invoice: "Invoice",
  report: "Report",
  recurring: "Recurring",
  notification: "Notification",
};
