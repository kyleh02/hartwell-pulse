import type { BusinessSettings, Brand, Client, Report } from "@/lib/types/database";
import { Wordmark } from "@/components/brand/Wordmark";
import { IronpeakWordmark } from "@/components/brand/IronpeakMark";
import { HARTWELL, IRONPEAK, isIronpeak } from "@/lib/brand";
import { monthLabel } from "@/lib/metrics";

/**
 * The masthead at the top of a report, and the strip along the bottom.
 *
 * Deliberately visible on screen as well as in print. The old letterhead was
 * print-only, which meant the first time anyone saw the branded document was
 * after they had already sent it. A report is a deliverable, so what is on the
 * screen should be the thing that comes out of the printer.
 */
export function ReportLetterhead({
  brand,
  business,
  client,
  report,
}: {
  brand: Brand;
  business: BusinessSettings | null;
  client: Client;
  report: Report;
}) {
  const ironpeak = isIronpeak(brand);

  return (
    <header className="report-block mb-8 border-b border-pulse-border pb-6 sm:mb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {ironpeak ? (
            <>
              <IronpeakWordmark size="lg" />
              {/* The ABN is the only permitted mention of the parent entity on
                  anything a client sees. No Hartwell name, no second logo. */}
              {business?.abn && (
                <p className="data-mono mt-3 text-xs text-pulse-text-mute">
                  ABN {business.abn}
                </p>
              )}
              <p className="mt-1 text-xs text-pulse-text-dim">
                {IRONPEAK.location}
              </p>
              <p className="data-mono text-xs text-pulse-text-dim">
                {IRONPEAK.email}
              </p>
            </>
          ) : (
            <>
              <Wordmark size="md" />
              <p className="mt-3 text-sm font-medium text-pulse-text">
                {business?.business_name ?? HARTWELL.name}
              </p>
              {business?.abn && (
                <p className="data-mono text-xs text-pulse-text-mute">
                  ABN {business.abn}
                </p>
              )}
              {business?.address && (
                <p className="mt-1 whitespace-pre-line text-xs text-pulse-text-dim">
                  {business.address}
                </p>
              )}
            </>
          )}
        </div>

        {/* Right-aligning this only reads correctly while it sits beside the
            logo; once it wraps underneath on a phone, left is right. */}
        <div className="text-left sm:text-right">
          <p className={`mono-label ${ironpeak ? "tracking-[0.2em]" : ""}`}>
            Performance report
          </p>
          <p className="data-mono mt-1 text-sm text-pulse-text">
            {monthLabel(report.period_month)}
          </p>
        </div>
      </div>

      <h1 className="report-heading mt-7 text-2xl font-semibold tracking-tight text-pulse-text sm:text-3xl">
        {report.title}
      </h1>
      <p className="mt-1.5 text-sm text-pulse-text-dim">
        Prepared for {client.business_name}
      </p>
    </header>
  );
}

/**
 * A closing strip. Print-only: on screen the app chrome already says who this
 * is from, but a PDF travels on its own and a page with no attribution at the
 * end looks unfinished.
 */
export function ReportColophon({
  brand,
  business,
}: {
  brand: Brand;
  business: BusinessSettings | null;
}) {
  const ironpeak = isIronpeak(brand);
  const parts = ironpeak
    ? [IRONPEAK.name, business?.abn ? `ABN ${business.abn}` : null, IRONPEAK.email]
    : [
        business?.business_name ?? HARTWELL.name,
        business?.abn ? `ABN ${business.abn}` : null,
        HARTWELL.site,
      ];

  return (
    <footer className="print-only mt-10 border-t border-pulse-border pt-4">
      <p className="data-mono text-[10px] text-pulse-text-mute">
        {parts.filter(Boolean).join("  ·  ")}
      </p>
    </footer>
  );
}
