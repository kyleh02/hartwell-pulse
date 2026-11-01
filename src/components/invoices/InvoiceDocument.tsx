import type { BusinessSettings } from "@/lib/types/database";
import type { InvoiceBundle } from "@/lib/invoices-shared";
import {
  formatMoney,
  gstLabel,
  groupByPhase,
  hourlySummary,
} from "@/lib/invoices-shared";
import { IronpeakDotMark } from "@/components/brand/IronpeakDotMark";
import { HARTWELL, IRONPEAK } from "@/lib/brand";
import { HD_PATH, HD_WIDTH, HD_HEIGHT } from "@/lib/brand/hd-path";
import { cn } from "@/lib/utils/cn";
import { formatAbn, resolveBillTo } from "@/lib/billing";

/**
 * The invoice, as the client sees it in the portal and as the PDF prints it.
 *
 * One component for the client's page, the admin preview and the print route
 * the renderer photographs, so the attachment and the portal always agree on
 * the amount. It is always a sheet of paper, in both portal themes: what is on
 * the screen is what comes out of the printer.
 *
 * The design (chosen by Kyle on 2 November 2026, "Midnight") puts the
 * website's black and gold across the top as a masthead, with the gold dust,
 * and closes the totals with a black Amount due bar. Ironpeak wears the same
 * layout in its own near-black and steel, under its dot mountain mark, with no
 * gold dust and no mention of Hartwell Digital anywhere.
 *
 * All the styling, including the pagination, lives in globals.css under
 * "Invoice document". The page header and footer are CSS page margin boxes on
 * a named page, written here because they carry the invoice number.
 */

function pretty(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Money with a real minus sign. A hyphen lets the line break between the sign
 * and the figure, which is how "−$550.00" once printed with the sign on one
 * line and the amount on the next.
 */
function money(n: number): string {
  return formatMoney(n).replace("-", "−");
}

export function InvoiceDocument({
  bundle,
  business,
}: {
  bundle: InvoiceBundle;
  business: BusinessSettings | null;
}) {
  const { invoice, client, lines } = bundle;
  // What it was issued with once sent, the client's profile while a draft. See
  // lib/billing.ts.
  const billTo = resolveBillTo(invoice, client);
  // Everything an instalment has to state to be read as half of something
  // already agreed rather than as a fresh charge.
  const parent = bundle.parent ?? null;
  const siblings = bundle.siblings ?? [];
  const isInstalment = !!invoice.parent_invoice_id && !!parent;
  const paidParts = siblings.filter((s) => s.status === "paid");
  const paidSoFar = paidParts.reduce((t, s) => t + Number(s.total), 0);
  // What is left once this one is settled too, so the client can see the end of
  // it rather than having to work it out.
  const settled = siblings
    .filter((s) => s.status === "paid" || s.id === invoice.id)
    .reduce((t, s) => t + Number(s.total), 0);
  const remainingAfter = parent ? Number(parent.total) - settled : 0;
  const isTaxInvoice = invoice.gst_mode !== "none";
  const ironpeak = invoice.brand === "ironpeak";
  const issuer = ironpeak ? IRONPEAK.name : (business?.business_name ?? HARTWELL.name);
  // What is left to pay once a deposit already received is credited.
  const deposit = Number(invoice.deposit_amount ?? 0);
  const amountDue = invoice.total - deposit;
  const hourly = invoice.rate_mode === "hourly";
  const hours = hourly ? hourlySummary(lines) : null;
  // Flat-fee work is almost always qty 1, where Unit == Amount — so show the
  // Qty/Unit columns only when a line actually has a quantity other than 1.
  //
  // An hourly invoice always shows its hours, but NOT the rate on every line:
  // the rate is the same all the way down, so it reads as clutter and belongs
  // once beside the totals. The only exception is lines that disagree about the
  // rate, where a single figure at the bottom would be a false statement — then
  // the column comes back.
  const varied = lines.some((l) => Number(l.quantity) !== 1);
  const showQty = hourly || varied;
  const showUnit = hourly ? hours?.rate === null : varied;
  const cols = 2 + (showQty ? 1 : 0) + (showUnit ? 1 : 0);
  // Phases are a presentation of the same lines: each group gets a heading and
  // its own subtotal, and the totals underneath are untouched. An invoice with
  // no phases produces exactly one group with a null title, which renders as a
  // plain run of rows.
  const groups = groupByPhase(lines);
  const hasBank = !!(business?.bank_account || business?.bank_bsb);
  // A subtotal that equals the amount due says the same thing twice.
  const showSubtotal = invoice.discount > 0 || isTaxInvoice || deposit > 0;

  return (
    <div className="invoice-wrap">
      <article className={cn("invoice-doc", ironpeak && "is-ironpeak")}>
        <PageFrame
          ironpeak={ironpeak}
          issuer={issuer}
          abn={business?.abn ?? null}
          number={invoice.invoice_number ?? ""}
          title={isTaxInvoice ? "Tax invoice" : "Invoice"}
        />

        <header className="inv-mast">
          {!ironpeak && <GoldDust />}
          <div className="inv-mast-top">
            {ironpeak ? (
              // The dot mountain in steel with the word in white: the brand
              // kit's two-tone lockup, in the proportions of its own files.
              <span className="inv-lockup is-ironpeak-lockup">
                <IronpeakDotMark size={58} className="inv-ipmark" />
                <span className="inv-wordmark">Ironpeak</span>
              </span>
            ) : (
              <span className="inv-lockup">
                <HdMonogram id={invoice.id} />
                <span className="inv-wordmark">Hartwell Digital</span>
              </span>
            )}
            <div className="inv-mast-id">
              <p className="inv-kicker">{isTaxInvoice ? "Tax invoice" : "Invoice"}</p>
              <p className="inv-number inv-fig">{invoice.invoice_number}</p>
            </div>
          </div>
          <dl className="inv-facts">
            <div>
              <dt>Issued</dt>
              <dd>{pretty(invoice.issue_date)}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>{pretty(invoice.due_date)}</dd>
            </div>
            <div className="inv-facts-due">
              <dt>Amount due</dt>
              <dd className="inv-fig">{money(amountDue)}</dd>
            </div>
          </dl>
        </header>

        <section className="inv-parties">
          <div className="inv-party">
            <p className="inv-label">Bill to</p>
            <p className="inv-party-name">{billTo.name}</p>
            {billTo.legal_name && billTo.legal_name !== billTo.name && (
              <p>{billTo.legal_name}</p>
            )}
            {billTo.abn && <p className="inv-fig">ABN {formatAbn(billTo.abn)}</p>}
            {billTo.address && <p className="inv-pre">{billTo.address}</p>}
            {billTo.attention && <p>Attention: {billTo.attention}</p>}
          </div>
          <div className="inv-party">
            <p className="inv-label">From</p>
            <p className="inv-party-name">{issuer}</p>
            {/* On Ironpeak the ABN is the only permitted mention of the parent
                entity. No Hartwell Digital name, logo or address. */}
            {business?.abn && <p className="inv-fig">ABN {business.abn}</p>}
            {ironpeak ? (
              <>
                <p>{IRONPEAK.location}</p>
                <p>{IRONPEAK.email}</p>
              </>
            ) : (
              <>
                {business?.address && <p className="inv-pre">{business.address}</p>}
                <p>{HARTWELL.email}</p>
              </>
            )}
          </div>
        </section>

        {isInstalment && parent && (
          <section className="inv-instalment">
            <p className="inv-label inv-accent">
              Part {invoice.instalment_number} of {invoice.instalment_count} of invoice{" "}
              {parent.invoice_number}
            </p>
            <dl className="inv-dl inv-dl-wide">
              <dt>Original invoice</dt>
              <dd>
                {parent.invoice_number}, issued {pretty(parent.issue_date)}, for{" "}
                <span className="inv-fig">{money(Number(parent.total))}</span>
              </dd>
              <dt>Paid so far</dt>
              <dd>
                {paidParts.length > 0 ? (
                  <>
                    <span className="inv-fig">{money(paidSoFar)}</span> (
                    {paidParts
                      .map(
                        (s) =>
                          `part ${s.instalment_number}${s.paid_at ? ", " + pretty(s.paid_at) : ""}`,
                      )
                      .join("; ")}
                    )
                  </>
                ) : (
                  "Nothing paid against it yet"
                )}
              </dd>
              <dt>This instalment</dt>
              <dd>
                <span className="inv-fig">{money(Number(invoice.total))}</span>, due{" "}
                {pretty(invoice.due_date)}
              </dd>
              <dt>Remaining after this</dt>
              <dd className="inv-fig">{money(remainingAfter)}</dd>
            </dl>
            {(bundle.parentLines ?? []).length > 0 && (
              <div className="inv-covers">
                <p className="inv-label">What this covers</p>
                {/* Listed without amounts, deliberately. Repricing each line to
                    its share would put rounding on every one of them and would
                    read as the whole job charged again at half price. Title
                    then description, the shape the original invoice renders
                    its lines in, so the two documents read alike. */}
                <ul>
                  {(bundle.parentLines ?? []).map((l) => (
                    <li key={l.id}>
                      <span className="inv-line-title">
                        {l.title || l.description || "Work supplied"}
                      </span>
                      {l.title && l.description && (
                        <span className="inv-line-desc">{l.description}</span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="inv-small">
                  Charged in full on invoice {parent.invoice_number}. This document
                  covers part {invoice.instalment_number} of that amount only.
                </p>
              </div>
            )}
            <p className="inv-small inv-instalment-foot">
              This is an agreed instalment of invoice {parent.invoice_number}, not an
              additional charge.
            </p>
          </section>
        )}

        <table className="inv-table">
          <thead>
            <tr>
              <th className="inv-th-desc">Description</th>
              {showQty && <th className="inv-num">{hourly ? "Hours" : "Qty"}</th>}
              {showUnit && <th className="inv-num">{hourly ? "Rate/hr" : "Unit"}</th>}
              <th className="inv-num">Amount</th>
            </tr>
          </thead>
          {lines.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={cols} className="inv-empty">
                  No line items.
                </td>
              </tr>
            </tbody>
          ) : (
            // A tbody per phase, so the print rules can keep a phase heading
            // with its first line and its subtotal with its last.
            groups.map((g) => (
              <tbody key={g.key} className="inv-group">
                {g.title && (
                  <tr className="inv-phase">
                    <td colSpan={cols}>
                      <span className="inv-phase-title">{g.title}</span>
                      {g.note && <span className="inv-phase-note">{g.note}</span>}
                    </td>
                  </tr>
                )}
                {g.lines.map((l) => (
                  <tr key={l.id} className={cn("inv-line", l.amount < 0 && "is-credit")}>
                    <td className="inv-desc">
                      {l.title && <span className="inv-line-title">{l.title}</span>}
                      {l.description && (
                        <span className="inv-line-desc">{l.description}</span>
                      )}
                      {!l.title && !l.description && (
                        <span className="inv-line-title">Work supplied</span>
                      )}
                    </td>
                    {showQty && <td className="inv-num">{l.quantity}</td>}
                    {showUnit && <td className="inv-num">{money(l.unit_amount)}</td>}
                    <td className="inv-num inv-amt">{money(l.amount)}</td>
                  </tr>
                ))}
                {/* Every phase closes with its own figure, so a client reading
                    a two-phase quote can see what each phase costs without
                    adding the lines up themselves. */}
                {g.title && (
                  <tr className="inv-subtotal">
                    <td colSpan={cols - 1}>{g.title} subtotal</td>
                    <td className="inv-num">{money(g.subtotal)}</td>
                  </tr>
                )}
              </tbody>
            ))
          )}
        </table>

        {/* Payment and totals are one block that never splits, so the bank
            details can never be stranded on a page without the amount. */}
        <section className={cn("inv-close", !hasBank && "is-totals-only")}>
          {hasBank && (
            <div className="inv-pay">
              <p className="inv-label">How to pay</p>
              <dl className="inv-dl">
                <dt>Method</dt>
                <dd>Bank transfer</dd>
                {business?.bank_name && (
                  <>
                    <dt>Bank</dt>
                    <dd>{business.bank_name}</dd>
                  </>
                )}
                <dt>BSB</dt>
                <dd className="inv-fig">{business?.bank_bsb}</dd>
                <dt>Account</dt>
                <dd className="inv-fig">{business?.bank_account}</dd>
                <dt>Reference</dt>
                <dd className="inv-fig inv-strong">{invoice.invoice_number}</dd>
              </dl>
            </div>
          )}
          <div className="inv-totals">
            {hours && (
              <p className="inv-trow is-meta">
                {hours.hours} hours
                {hours.rate !== null ? ` at ${money(hours.rate)} per hour` : ""}
              </p>
            )}
            {showSubtotal && (
              <p className="inv-trow">
                <span>Subtotal</span>
                <span className="inv-fig">{money(invoice.subtotal)}</span>
              </p>
            )}
            {invoice.discount > 0 && (
              <p className="inv-trow">
                <span>{invoice.discount_label || "Discount"}</span>
                <span className="inv-fig">{money(-invoice.discount)}</span>
              </p>
            )}
            {isTaxInvoice && (
              <p className="inv-trow">
                <span>{gstLabel(invoice.gst_mode)}</span>
                <span className="inv-fig">{money(invoice.gst)}</span>
              </p>
            )}
            {deposit > 0 && (
              <>
                <p className="inv-trow is-total">
                  <span>Total</span>
                  <span className="inv-fig">{money(invoice.total)}</span>
                </p>
                <p className="inv-trow">
                  <span>{invoice.deposit_label || "Deposit received"}</span>
                  <span className="inv-fig">{money(-deposit)}</span>
                </p>
              </>
            )}
            <p className="inv-due">
              <span>Amount due</span>
              <span className="inv-fig">{money(amountDue)}</span>
            </p>
          </div>
        </section>

        {invoice.notes && (
          <section className="inv-notes">
            <p className="inv-label">Notes</p>
            <div className="inv-notes-body">
              {invoice.notes
                .split(/\n\s*\n/)
                .filter((p) => p.trim())
                .map((p, i) => (
                  <p key={i} className="inv-pre">
                    {p.trim()}
                  </p>
                ))}
            </div>
          </section>
        )}

        {/* On paper the page footer carries this. On screen the sheet has no
            page, so it closes with the same line. */}
        <footer className="inv-colophon">
          <span>
            {ironpeak
              ? [IRONPEAK.name, business?.abn ? `ABN ${business.abn}` : null]
                  .filter(Boolean)
                  .join("  ·  ")
              : [issuer, business?.abn ? `ABN ${business.abn}` : null, HARTWELL.web]
                  .filter(Boolean)
                  .join("  ·  ")}
          </span>
          <span className="inv-fig">{invoice.invoice_number}</span>
        </footer>
      </article>
    </div>
  );
}

/**
 * The running header and footer on every printed page, as CSS margin boxes on
 * the named page `invoice`. Written here rather than in globals.css because
 * the text carries the invoice number, and CSS cannot read that from the page.
 *
 * The page has no side margins, so the masthead can run to the edges of the
 * sheet; the document pads itself instead (see globals.css), and the boxes pad
 * themselves to match. The first page has no top margin for the same reason,
 * and no "continued" line, because it is not continued.
 *
 * Colours and fonts are literal: margin boxes sit outside the document, so the
 * invoice's own tokens do not reach them.
 */
function PageFrame({
  ironpeak,
  issuer,
  abn,
  number,
  title,
}: {
  ironpeak: boolean;
  issuer: string;
  abn: string | null;
  number: string;
  title: string;
}) {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
  const left = (
    ironpeak
      ? [IRONPEAK.name, abn ? `ABN ${abn}` : null]
      : [issuer, abn ? `ABN ${abn}` : null, HARTWELL.web]
  )
    .filter(Boolean)
    .join("   ·   ");
  const font = ironpeak ? '"Hanken Grotesk", sans-serif' : "Outfit, sans-serif";
  const box = `font-family: ${font}; font-size: 7.5pt; letter-spacing: 0.02em; color: #7a766e;`;
  return (
    <style>{`
      @page invoice {
        size: A4;
        margin: 18mm 0 20mm;
        @bottom-left { content: "${esc(left)}"; ${box} vertical-align: middle; padding-left: 18mm; }
        @bottom-right { content: "${esc(number)}   ·   Page " counter(page) " of " counter(pages); ${box} vertical-align: middle; padding-right: 18mm; }
        @top-left { content: "${esc(`${title} ${number}, continued`)}"; ${box} vertical-align: bottom; padding: 0 0 4mm 18mm; }
      }
      @page invoice:first {
        margin-top: 0;
        @top-left { content: none; }
      }
    `}</style>
  );
}

/**
 * The HD monogram, flat, in a foil gradient. Vector, so it stays sharp at any
 * zoom in a PDF. The gradient id is the invoice's, so it is stable between the
 * server render and the browser and unique on the page.
 */
function HdMonogram({ id, height = 30 }: { id: string; height?: number }) {
  const gid = `inv-foil-${id}`;
  return (
    <svg
      width={Math.round((height * HD_WIDTH) / HD_HEIGHT)}
      height={height}
      viewBox={`0 0 ${HD_WIDTH} ${HD_HEIGHT}`}
      aria-hidden="true"
      className="inv-monogram"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" style={{ stopColor: "var(--inv-foil-1)" }} />
          <stop offset="0.45" style={{ stopColor: "var(--inv-foil-2)" }} />
          <stop offset="0.6" style={{ stopColor: "var(--inv-foil-3)" }} />
          <stop offset="1" style={{ stopColor: "var(--inv-foil-4)" }} />
        </linearGradient>
      </defs>
      <path d={HD_PATH} fill={`url(#${gid})`} />
    </svg>
  );
}

/** A four-point star, the glint the 3D logo uses, centred on (x, y). */
function glint(x: number, y: number, s: number) {
  const k = s * 0.12;
  return (
    <path
      key={`${x}-${y}`}
      className="inv-glint"
      d={`M${x} ${y - s}C${x + k} ${y - k} ${x + k} ${y - k} ${x + s} ${y}C${x + k} ${y + k} ${x + k} ${y + k} ${x} ${y + s}C${x - k} ${y + k} ${x - k} ${y + k} ${x - s} ${y}C${x - k} ${y - k} ${x - k} ${y - k} ${x} ${y - s}Z`}
    />
  );
}

/** One speck, in one of the four opaque dust tones. */
function speck(key: number, x: number, y: number, r: number, t: number) {
  const tone = t < 0.42 ? 1 : t < 0.54 ? 2 : t < 0.66 ? 3 : 4;
  return (
    <circle
      key={key}
      cx={x.toFixed(1)}
      cy={y.toFixed(1)}
      r={r.toFixed(2)}
      className={`inv-dust-${tone}`}
    />
  );
}

/**
 * Gold dust across the masthead, as on the website, with a few four-point
 * glints. Seeded, so every invoice carries the same field and the server and
 * browser draw the same thing. Densest towards the top right and kept off the
 * invoice number and the amount.
 *
 * Two fields, because the masthead has two layouts. The wide one (and paper)
 * has the number and the amount on the right, so the dust avoids those. The
 * narrow one stacks everything on the left, and a field stretched across it
 * put specks inside the words, so narrow gets a small field of its own in the
 * empty space beside the invoice number. globals.css shows one or the other.
 *
 * Every tone is an opaque gold mixed toward the black rather than gold at some
 * opacity: transparency in a PDF becomes a soft mask, which some viewers paint
 * with a coloured cast.
 */
function GoldDust() {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const wide = [];
  for (let i = 0; i < 140; i++) {
    const x = rnd() * 1000;
    const y = rnd() * 300;
    const weight = Math.pow(x / 1000, 1.6) * (1 - (y / 300) * 0.55);
    if (rnd() > weight) continue;
    if (x > 760 && ((y > 112 && y < 195) || y > 212)) continue;
    const r = 0.6 + rnd() * 1.5;
    wide.push(speck(i, x, y, r, 0.3 + rnd() * 0.5 * weight));
  }
  seed = 11;
  const narrow = [];
  for (let i = 0; i < 40; i++) {
    const x = rnd() * 200;
    const y = rnd() * 66;
    const weight = Math.pow(x / 200, 1.3);
    if (rnd() > weight) continue;
    const r = 0.5 + rnd() * 1.1;
    narrow.push(speck(i, x, y, r, 0.3 + rnd() * 0.5 * weight));
  }
  return (
    <>
      <svg
        className="inv-dust is-wide"
        viewBox="0 0 1000 300"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        {wide}
        {glint(905, 38, 9)}
        {glint(712, 22, 5)}
        {glint(962, 132, 4)}
      </svg>
      <svg
        className="inv-dust is-narrow"
        viewBox="0 0 200 66"
        preserveAspectRatio="xMaxYMid meet"
        aria-hidden="true"
      >
        {narrow}
        {glint(178, 14, 7)}
        {glint(132, 50, 3.5)}
      </svg>
    </>
  );
}
