"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, X } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/Button";
import { importReportMarkdown } from "@/app/admin/reports/actions";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none";

/**
 * Paste a Markdown draft and get a report. Reports get written long before
 * they get typed into a form, so the draft is the input.
 */
export function ImportReport({
  clients,
}: {
  clients: { id: string; business_name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [markdown, setMarkdown] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!clientId) {
      setError("Pick a client.");
      return;
    }
    startTransition(async () => {
      try {
        const id = await importReportMarkdown(clientId, `${month}-01`, markdown);
        setOpen(false);
        router.push(`/admin/reports/${id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not import that.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClasses("secondary", "md")}
      >
        <FileUp size={15} /> Import Markdown
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            aria-label="Close"
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div className="relative max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
            <div className="flex items-center justify-between border-b border-pulse-border px-4 py-3">
              <p className="text-sm font-medium text-pulse-text">
                Import a report from Markdown
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="mono-label">Client</span>
                  <select
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className={field}
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.business_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="mono-label">Period</span>
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className={field}
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1">
                <span className="mono-label">The draft</span>
                <textarea
                  value={markdown}
                  onChange={(e) => setMarkdown(e.target.value)}
                  rows={12}
                  placeholder="Paste the whole Markdown file."
                  className={`${field} data-mono text-xs`}
                />
              </label>

              <p className="text-[11px] text-pulse-text-mute">
                A leading # line becomes the report title. Each ## heading
                becomes a section, in order, and anything above the first one
                becomes the summary. Tables, bold and ### subheadings all
                render. It arrives as a draft, so nothing reaches the client
                until you publish.
              </p>

              {error && (
                <p className="rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
                  {error}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-pulse-border px-4 py-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={pending || !markdown.trim()}>
                {pending ? "Importing…" : "Create draft"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
