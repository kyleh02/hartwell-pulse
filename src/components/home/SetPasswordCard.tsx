"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * For someone who came in from their welcome email's one-click link and so has
 * no password yet: choose one now, for next time. Shown only to them, and gone
 * the moment it is set.
 */
export function SetPasswordCard() {
  const { user, isLoaded } = useUser();
  const [pw, setPw] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  if (!isLoaded || !user || user.passwordEnabled || state === "done") return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setState("saving");
    try {
      await user.updatePassword({ newPassword: pw, signOutOfOtherSessions: false });
      setState("done");
    } catch (err) {
      const msg =
        (err as { errors?: { longMessage?: string; message?: string }[] })?.errors?.[0]?.longMessage ??
        "That password wasn't accepted. Try a longer one.";
      setError(msg);
      setState("idle");
    }
  }

  return (
    <form
      onSubmit={save}
      className="mb-4 flex flex-col gap-3 rounded-[20px] border border-pulse-gold/40 bg-pulse-gold/[0.06] p-5 sm:flex-row sm:items-center"
    >
      <KeyRound size={22} className="shrink-0 text-pulse-gold" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-extrabold tracking-[0.02em] text-pulse-text uppercase">Choose a password for next time</p>
        <p className="text-sm text-pulse-text-dim">You came in from your welcome link. Set a password so you can sign in again.</p>
        {error && <p className="mt-1 text-xs text-pulse-danger">{error}</p>}
      </div>
      <input
        type="password"
        autoComplete="new-password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="At least 8 characters"
        aria-label="New password"
        className="h-11 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 text-base text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none sm:w-56 sm:text-sm"
      />
      <Button type="submit" disabled={state === "saving" || pw.length < 8}>
        {state === "saving" ? "Saving…" : "Save password"}
      </Button>
    </form>
  );
}
