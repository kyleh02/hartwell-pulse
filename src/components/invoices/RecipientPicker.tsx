"use client";

import { Check, Mail, Users } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface InvoicePerson {
  clerk_user_id: string;
  full_name: string | null;
  email: string | null;
}

/**
 * Who this invoice goes to.
 *
 * An empty selection means everyone on the account, which is what every
 * invoice written before this existed carries and the right default for a
 * one-person client. The control says so in words rather than leaving an
 * empty state to be interpreted, because the cost of guessing wrong here is a
 * client's partner receiving an invoice they cannot open.
 *
 * It shows the addresses, not just the names. The whole question being
 * answered is which inbox this lands in.
 */
export function RecipientPicker({
  people,
  selected,
  onChange,
  disabled,
}: {
  people: InvoicePerson[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const everyone = selected.length === 0;

  function toggle(id: string) {
    if (everyone) {
      // First pick out of "everyone" means just that person, which is the
      // reason anyone opens this control.
      onChange([id]);
      return;
    }
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    onChange(next);
  }

  if (people.length === 0) {
    return (
      <p className="text-xs text-pulse-text-mute">
        Nobody has been added to this client&apos;s account yet, so there is no
        one to send an invoice to.
      </p>
    );
  }

  // One contact means there is no choice to make. Say who gets it and stop.
  if (people.length === 1) {
    return (
      <p className="text-xs text-pulse-text-dim">
        Goes to {people[0].full_name ?? people[0].email ?? "the account"}
        {people[0].email && (
          <span className="data-mono text-pulse-text-mute"> · {people[0].email}</span>
        )}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {people.map((p) => {
        const on = everyone || selected.includes(p.clerk_user_id);
        return (
          <button
            key={p.clerk_user_id}
            type="button"
            disabled={disabled}
            onClick={() => toggle(p.clerk_user_id)}
            aria-pressed={on}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-[var(--radius-input)] border px-3 py-2 text-left transition-colors disabled:opacity-50",
              on
                ? "border-pulse-border-strong bg-pulse-surface-2"
                : "border-pulse-border hover:border-pulse-border-strong",
            )}
          >
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border",
                on
                  ? "border-pulse-gold bg-pulse-gold text-pulse-bg"
                  : "border-pulse-border-strong",
              )}
            >
              {on && <Check size={11} strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-pulse-text">
                {p.full_name ?? "Unnamed"}
              </span>
              {p.email && (
                <span className="data-mono block truncate text-[11px] text-pulse-text-mute">
                  {p.email}
                </span>
              )}
            </span>
          </button>
        );
      })}

      <p className="flex items-start gap-1.5 pt-0.5 text-[11px] text-pulse-text-mute">
        {everyone ? (
          <>
            <Users size={12} className="mt-0.5 shrink-0" />
            Everyone on the account. Tick one person to send it to them only.
          </>
        ) : (
          <>
            <Mail size={12} className="mt-0.5 shrink-0" />
            The reminder before it is due and the overdue chase go to the same
            people.
          </>
        )}
      </p>
    </div>
  );
}
