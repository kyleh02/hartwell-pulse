"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FAULT_LABEL, type Fault } from "@/lib/outreach/rules";
import { cn } from "@/lib/utils/cn";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";

interface Shown {
  url: string;
  finalUrl: string | null;
  status: "ok" | "blocked" | "failed";
  error: string | null;
  psi: { ok: boolean; error?: string; fcpMs: number | null; lcpMs: number | null; requests: number };
  httpStatus: number | null;
  httpsStatus: number | null;
  https: "ok" | "bad_certificate" | "unreachable" | "unknown";
  httpLoads: boolean;
  menu: { url: string; label: string; status: number | null; blocked: boolean }[];
  tags: { aw: string[]; metaPixel: string[]; ga4: string[]; ua: string[] };
  pixelPageViews: Record<string, number>;
  phone: string | null;
  telLink: boolean;
  scriptBuilt: boolean;
  adSignal: boolean;
  faults: Fault[];
  screenshot: string | null;
}

const HTTPS: Record<Shown["https"], string> = {
  ok: "Loads over HTTPS",
  bad_certificate: "Certificate problem",
  unreachable: "Won't load over HTTPS",
  unknown: "HTTPS didn't answer in time",
};

const secs = (ms: number | null) => (ms === null ? "?" : `${(ms / 1000).toFixed(1)} s`);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 py-1 text-[13px]">
      <span className="text-pulse-text-mute">{label}</span>
      <span className="min-w-0 break-words text-pulse-text-dim">{children}</span>
    </div>
  );
}

/**
 * "Measure a site": the measurement the morning run will ask for, once, shown
 * and not stored. Takes 15 to 40 seconds, most of it PageSpeed.
 */
export function MeasureSite() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState<Shown | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setM(null);
    try {
      const res = await fetch("/api/outreach/measure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const j = (await res.json().catch(() => null)) as { ok: boolean; message?: string; measurement?: Shown } | null;
      if (!j?.ok || !j.measurement) setErr(j?.message ?? `The measurement failed (${res.status}).`);
      else setM(j.measurement);
    } catch {
      setErr("The measurement didn't come back. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const tagLine = (label: string, ids: string[]) => (ids.length ? `${label} ${ids.join(", ")}` : null);

  return (
    <div>
      <form onSubmit={go} className="flex flex-wrap gap-2">
        <input
          className={cn(field, "min-w-0 flex-1")}
          placeholder="A web address, like catten.com.au"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button type="submit" disabled={busy || !url.trim()}>
          {busy ? "Measuring" : "Measure"}
        </Button>
      </form>
      {busy && <p className="mt-2 text-[12px] text-pulse-text-mute">Up to a minute: Google&apos;s speed test does most of it.</p>}
      {err && <p className="mt-3 text-xs text-pulse-danger">{err}</p>}
      {m && (
        <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_auto]">
          <div className="divide-y divide-pulse-border">
            <Row label="Page">
              {m.status === "ok" ? "Read fine" : m.status === "blocked" ? "Bot protection, so it couldn't be checked" : "Didn't load"}
              {m.finalUrl && m.finalUrl !== m.url ? ` (ended at ${m.finalUrl})` : ""}
            </Row>
            {m.error && <Row label="Note">{m.error}</Row>}
            <Row label="Speed, phone">
              {m.psi.ok ? `First paint ${secs(m.psi.fcpMs)}, largest paint ${secs(m.psi.lcpMs)}` : `Not measured: ${m.psi.error}`}
            </Row>
            <Row label="Ad tracking">
              {[tagLine("Google Ads", m.tags.aw), tagLine("Meta Pixel", m.tags.metaPixel)].filter(Boolean).join("; ") || "None found"}
              {m.adSignal ? "" : " (no ad signal, so it wouldn't qualify)"}
            </Row>
            <Row label="Analytics">
              {[tagLine("GA4", m.tags.ga4), tagLine("old Universal", m.tags.ua)].filter(Boolean).join("; ") || "None found"}
            </Row>
            {Object.keys(m.pixelPageViews).length > 0 && (
              <Row label="Pixel PageViews">
                {Object.entries(m.pixelPageViews)
                  .map(([id, n]) => `${id}: ${n} per load`)
                  .join("; ")}
              </Row>
            )}
            <Row label="Security">
              {HTTPS[m.https]}
              {m.httpLoads ? "; plain HTTP loads too" : ""}
            </Row>
            <Row label="Phone">
              {m.phone ? `${m.phone}, ${m.telLink ? "tappable" : m.scriptBuilt ? "page built by script, not judged" : "not tappable"}` : "None in the page's HTML"}
            </Row>
            <Row label="Menu">
              {m.menu.length === 0
                ? "No menu found in the HTML (a menu built by script is missed)"
                : m.menu.map((l) => `${l.label} ${l.blocked ? "blocked" : (l.status ?? "no answer")}`).join(" · ")}
            </Row>
            <Row label="Faults this run">
              {m.faults.length ? m.faults.map((f) => FAULT_LABEL[f]).join(", ") : "None"}
            </Row>
            <p className="pt-2 text-[12px] text-pulse-text-mute">
              Not stored. A fault only counts for real when Pulse sees it again at least an hour later, and a
              business needs the ad signal and two faults to be emailed.
            </p>
          </div>
          {m.screenshot && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={m.screenshot}
              alt="Google's phone screenshot of the page"
              className="w-40 justify-self-start rounded border border-pulse-border"
            />
          )}
        </div>
      )}
    </div>
  );
}
