"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/**
 * "Send now", shown only while test mode is on (the page doesn't render it
 * otherwise, and its address answers 404 outside test mode). One email a
 * call, up to ten a press, each through the same checks as a scheduled send.
 */
export function TestSendButtons() {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "first" | "follow_up">(null);
  const [log, setLog] = useState<string[]>([]);

  async function run(kind: "first" | "follow_up") {
    setBusy(kind);
    setLog([]);
    for (let i = 0; i < 10; i++) {
      let note = "That didn't work.";
      let done = true;
      try {
        const res = await fetch("/api/outreach/test-send", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind }),
        });
        if (res.status === 404) note = "Only in test mode.";
        else if (res.ok) {
          const j = (await res.json()) as { note: string; done: boolean };
          note = j.note;
          done = j.done;
        }
      } catch {
        note = "The portal didn't answer.";
      }
      setLog((l) => [...l, note]);
      if (done) break;
    }
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={!!busy} onClick={() => run("first")}>
          {busy === "first" ? "Sending…" : "Send queued test emails now"}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={!!busy} onClick={() => run("follow_up")}>
          {busy === "follow_up" ? "Sending…" : "Send test follow-ups now"}
        </Button>
      </div>
      <p className="text-[12px] text-pulse-text-mute">
        Test mode only. Sends what has passed the hour-later re-check straight away, to your test inboxes, through the same
        checks as a scheduled send. Each one measures its page again first, so allow up to a minute an email.
      </p>
      {log.length > 0 && (
        <ul className="space-y-0.5 text-[12px] text-pulse-text-dim">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
