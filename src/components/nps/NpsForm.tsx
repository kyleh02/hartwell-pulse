"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { answerFromLink, answerFromPortal } from "@/app/nps/actions";
import { QUESTION } from "@/lib/nps-shared";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

type Source = { surveyId: string; token?: never } | { token: string; surveyId?: never };

const THANKS = {
  promoter: "That means a lot. Thank you.",
  passive: "Thank you. If there's one thing I could do better, tell me in the chat any time.",
  detractor: "Thank you for being straight with me. I'll be in touch soon to talk it through.",
} as const;

/**
 * The one question, 0 to 10, then an optional reason. The same form on Home
 * and on the page an email button opens.
 */
export function NpsForm({ initialScore = null, ...src }: Source & { initialScore?: number | null }) {
  const [score, setScore] = useState<number | null>(initialScore);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ group: keyof typeof THANKS; reviewUrl: string | null } | null>(null);
  const [pending, start] = useTransition();

  function send() {
    if (score === null) return;
    setError(null);
    start(async () => {
      const res = src.token ? await answerFromLink(src.token, score, comment) : await answerFromPortal(src.surveyId!, score, comment);
      if (res.ok) setDone({ group: res.group, reviewUrl: res.reviewUrl });
      else setError(res.message);
    });
  }

  if (done) {
    return (
      <div role="status">
        <p className="text-[15px] leading-relaxed text-pulse-text">{THANKS[done.group]}</p>
        {done.reviewUrl && (
          <div className="mt-4">
            <p className="mb-3 text-sm leading-relaxed text-pulse-text-dim">
              Would you mind saying so on Google? A sentence or two helps other businesses find me.
            </p>
            <a
              href={done.reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-[2px] bg-pulse-gold px-5 text-xs font-bold tracking-[0.14em] text-pulse-bg uppercase"
            >
              <Star size={14} aria-hidden="true" /> Leave a Google review
            </a>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <p id="nps-q" className="text-[15px] leading-relaxed text-pulse-text">
        {QUESTION}
      </p>
      <div role="radiogroup" aria-labelledby="nps-q" className="mt-4 grid grid-cols-11 gap-0.5 sm:gap-1.5">
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={score === n}
            onClick={() => setScore(n)}
            className={cn(
              "data-mono flex h-10 items-center justify-center rounded-[2px] border text-sm font-bold transition-colors sm:h-11",
              score === n
                ? "border-pulse-gold bg-pulse-gold text-pulse-bg"
                : "border-pulse-border bg-pulse-surface-2 text-pulse-text hover:border-pulse-gold/60",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-pulse-text-mute">
        <span>Not likely</span>
        <span>Very likely</span>
      </div>
      {score !== null && (
        <div className="mt-4">
          <label htmlFor="nps-why" className="mb-1.5 block text-sm text-pulse-text-dim">
            What&apos;s the main reason for your score? <span className="text-pulse-text-mute">(optional)</span>
          </label>
          <textarea
            id="nps-why"
            rows={3}
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-base text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none sm:text-sm"
          />
          {error && <p className="mt-2 text-sm text-pulse-danger">{error}</p>}
          <div className="mt-3">
            <Button onClick={send} disabled={pending}>
              {pending ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
