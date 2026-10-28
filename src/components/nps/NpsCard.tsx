"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { NpsForm } from "@/components/nps/NpsForm";

/**
 * The feedback question on Home while a survey is open for this person. "Not
 * now" only hides it for this visit: the question stays open for three weeks,
 * and the email has the same buttons.
 */
export function NpsCard({ surveyId }: { surveyId: string }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <section className="relative mb-6 rounded-[20px] border border-pulse-gold/40 bg-pulse-surface p-5 sm:p-6">
      <button
        type="button"
        onClick={() => setHidden(true)}
        className="absolute top-3 right-3 inline-flex h-8 items-center gap-1 rounded-[2px] px-2 text-xs text-pulse-text-mute hover:text-pulse-text"
      >
        Not now <X size={13} aria-hidden="true" />
      </button>
      <h2 className="card-title mb-2 pr-20">A quick question</h2>
      <NpsForm surveyId={surveyId} />
    </section>
  );
}
