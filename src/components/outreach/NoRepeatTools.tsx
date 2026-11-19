"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { checkBusinessAction, type CheckResult } from "@/app/admin/outreach/actions";
import { cn } from "@/lib/utils/cn";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";

const EMPTY = { website: "", name: "", email: "", abn: "", phone: "", postcode: "", services: "" };

const SOURCE: Record<string, string> = {
  fingerprint: "Fingerprint",
  lead: "Pipeline",
  client: "Clients",
  do_not_contact: "Do not contact",
  exclusion: "Your exclusions",
  prospect: "Prospects",
  client_area: "Near a client",
};

type ImportReply =
  | { ok: true; rows: number; skipped?: number; keys: number; added: number; already: number; file?: string }
  | { ok: false; message: string };

/**
 * The no-repeat rule, by hand: check any business the way the morning run
 * will, bring in a contact list kept elsewhere, and copy the do-not-contact
 * list into the permanent fingerprints.
 */
export function NoRepeatTools() {
  const router = useRouter();
  const [f, setF] = useState(EMPTY);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<ImportReply | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function check(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    setCheckError(null);
    startCheck(async () => {
      try {
        setResult(await checkBusinessAction(f));
      } catch (err) {
        setCheckError(err instanceof Error ? err.message : "The check failed.");
      }
    });
  }

  async function send(body: FormData | string) {
    setImporting(true);
    setImported(null);
    try {
      const res = await fetch("/api/outreach/fingerprints", {
        method: "POST",
        body,
        headers: typeof body === "string" ? { "content-type": "application/json" } : undefined,
      });
      setImported((await res.json()) as ImportReply);
      router.refresh();
    } catch {
      setImported({ ok: false, message: "The upload didn't reach the portal. Try again." });
    } finally {
      setImporting(false);
    }
  }

  function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setImported({ ok: false, message: "Choose a CSV file first." });
      return;
    }
    const form = new FormData();
    form.append("file", file);
    void send(form);
  }

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ---------- check a business ---------- */}
      <form onSubmit={check} className="rounded-[var(--radius-input)] border border-pulse-border p-3">
        <p className="text-sm font-semibold text-pulse-text">Check a business</p>
        <p className="mt-0.5 mb-3 text-[12px] text-pulse-text-mute">
          The same check the morning run gets. Any one field will do; add a postcode and what they do to
          check the distance from your clients too.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className={field} placeholder="Website" value={f.website} onChange={set("website")} />
          <input className={field} placeholder="Business name" value={f.name} onChange={set("name")} />
          <input className={field} placeholder="Email" type="email" value={f.email} onChange={set("email")} />
          <input className={field} placeholder="ABN" inputMode="numeric" value={f.abn} onChange={set("abn")} />
          <input className={field} placeholder="Phone" inputMode="tel" value={f.phone} onChange={set("phone")} />
          <input className={field} placeholder="Postcode" inputMode="numeric" value={f.postcode} onChange={set("postcode")} />
          <input className={field} placeholder="What they do" value={f.services} onChange={set("services")} />
          <Button type="submit" disabled={checking}>
            {checking ? "Checking" : "Check"}
          </Button>
        </div>
        {checkError && <p className="mt-3 text-xs text-pulse-danger">{checkError}</p>}
        {result && (
          <div className="mt-3 space-y-1.5 text-[13px]">
            <p className={cn("font-semibold", result.allowed ? "text-pulse-success" : "text-pulse-danger")}>
              {result.allowed ? "Allowed: nothing matches." : "Blocked."}
            </p>
            {result.problem && <p className="text-pulse-text-dim">{result.problem}</p>}
            {result.blocks.length > 0 && (
              <ul className="space-y-0.5 text-pulse-text-dim">
                {result.blocks.map((b, i) => (
                  <li key={i}>
                    <span className="text-pulse-text-mute">
                      {SOURCE[b.source] ?? b.source}
                      {b.kind === "area" ? "" : `, by ${b.kind}`}:{" "}
                    </span>
                    {b.label}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[12px] text-pulse-text-mute">
              The morning run would be told:{" "}
              {result.connector.allowed
                ? "allowed"
                : `blocked${result.connector.reasons.length ? ` (${result.connector.reasons.join("; ")})` : ", no reason given"}`}
              .
            </p>
            {result.keys.length > 0 && (
              <p className="data-mono text-[11px] break-words text-pulse-text-mute">Checked on {result.keys.join(" · ")}</p>
            )}
          </div>
        )}
      </form>

      {/* ---------- imports ---------- */}
      <div className="rounded-[var(--radius-input)] border border-pulse-border p-3">
        <p className="text-sm font-semibold text-pulse-text">Bring in contact lists</p>
        <p className="mt-0.5 mb-3 text-[12px] text-pulse-text-mute">
          A CSV with a header row: domain, email and business name, ABN and phone if you have them. Only a hash
          of each is kept, for good, and every business on it is blocked.
        </p>
        <form onSubmit={upload} className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="min-w-0 flex-1 text-[12px] text-pulse-text-dim file:mr-3 file:rounded-[2px] file:border file:border-pulse-border file:bg-pulse-surface-2 file:px-3 file:py-1.5 file:text-pulse-text"
          />
          <Button type="submit" disabled={importing}>
            {importing ? "Importing" : "Import"}
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-pulse-border pt-3">
          <p className="min-w-0 flex-1 text-[12px] text-pulse-text-mute">
            Copy the do-not-contact list in as well, so its blocks are kept even if the list changes.
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={importing}
            onClick={() => void send(JSON.stringify({ from: "do_not_contact" }))}
          >
            Copy it in
          </Button>
        </div>
        {imported && (
          <p className={cn("mt-3 text-[13px]", imported.ok ? "text-pulse-text-dim" : "text-pulse-danger")}>
            {imported.ok
              ? `${imported.file ? `${imported.file}: ` : ""}${imported.rows} rows${imported.skipped ? ` (${imported.skipped} with nothing usable)` : ""}, ${imported.keys} keys. ${imported.added} fingerprints added, ${imported.already} already on file.`
              : imported.message}
          </p>
        )}
      </div>
    </div>
  );
}
