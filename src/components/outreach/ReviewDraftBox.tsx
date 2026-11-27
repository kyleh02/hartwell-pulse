"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

/** The review draft, ready to copy into kyle@'s Gmail reply. */
export function ReviewDraftBox({ subject, body, threadUrl }: { subject: string; body: string; threadUrl: string | null }) {
  const [copied, setCopied] = useState<"subject" | "body" | null>(null);
  const copy = (what: "subject" | "body") =>
    navigator.clipboard?.writeText(what === "subject" ? subject : body).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface p-3">
        <p className="min-w-0 text-sm text-pulse-text">
          <span className="text-pulse-text-mute">Subject: </span>
          {subject}
        </p>
        <Button type="button" size="sm" variant="secondary" onClick={() => copy("subject")}>
          {copied === "subject" ? "Copied" : "Copy subject"}
        </Button>
      </div>
      <pre className="max-h-[70vh] overflow-y-auto rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface p-4 font-sans text-[14px] leading-relaxed break-words whitespace-pre-wrap text-pulse-text">
        {body}
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => copy("body")}>
          {copied === "body" ? "Copied" : "Copy the review"}
        </Button>
        {threadUrl && (
          <a href={threadUrl} target="_blank" rel="noreferrer" className="inline-flex items-center px-2 text-[13px] text-pulse-gold underline underline-offset-2">
            Open their thread in Gmail
          </a>
        )}
      </div>
    </div>
  );
}
