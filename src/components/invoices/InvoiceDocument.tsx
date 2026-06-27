import type { BusinessSettings } from "@/lib/types/database";
import type { InvoiceBundle } from "@/lib/invoices-shared";
import { formatMoney, gstLabel } from "@/lib/invoices-shared";
import { Wordmark } from "@/components/brand/Wordmark";

function pretty(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function InvoiceDocument({
  bundle,
  business,
}: {
  bundle: InvoiceBundle;
  business: BusinessSettings | null;
}) {
  const { invoice, client, lines } = bundle;
  const isTaxInvoice = invoice.gst_mode !== "none";

  return (
    <div className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-pulse-border pb-6">
        <div>
          <Wordmark size="md" />
          <p className="mt-3 text-sm font-medium text-pulse-text">
            {business?.business_name ?? "Hartwell Digital"}
          </p>
          {business?.abn && (
            <p className="data-mono text-xs text-pulse-text-mute">ABN {business.abn}</p>
          )}
          {business?.address && (
            <p className="mt-1 whitespace-pre-line text-xs text-pulse-text-dim">
              {business.address}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="mono-label">{isTaxInvoice ? "Tax Invoice" : "Invoice"}</p>
          <p className="data-mono mt-1 text-lg text-pulse-text">
            {invoice.invoice_number}
          </p>
          <p className="data-mono mt-2 text-xs text-pulse-text-mute">
            Issued {pretty(invoice.issue_date)}
          </p>
          <p className="data-mono text-xs text-pulse-text-mute">
            Due {pretty(invoice.due_date)}
          </p>
        </div>
      </div>

      <div className="py-5">
        <p className="mono-label">Bill to</p>
        <p className="mt-1 text-sm font-medium text-pulse-text">
          {client.business_name}
        </p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="mono-label border-b border-pulse-border text-left">
            <th className="py-2 font-medium">Description</th>
            <th className="py-2 text-right font-medium">Qty</th>
            <th className="py-2 text-right font-medium">Unit</th>
            <th className="py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-4 text-center text-xs text-pulse-text-mute">
                No line items.
              </td>
            </tr>
          ) : (
            lines.map((l) => (
              <tr key={l.id} className="border-b border-pulse-border">
                <td className="py-2.5 text-pulse-text-dim">{l.description}</td>
                <td className="data-mono py-2.5 text-right text-pulse-text-dim">
                  {l.quantity}
                </td>
                <td className="data-mono py-2.5 text-right text-pulse-text-dim">
                  {formatMoney(l.unit_amount)}
                </td>
                <td className="data-mono py-2.5 text-right text-pulse-text">
                  {formatMoney(l.amount)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="mt-4 flex justify-end">
        <div className="w-56 space-y-1.5 text-sm">
          <div className="flex justify-between text-pulse-text-dim">
            <span>Subtotal</span>
            <span className="data-mono">{formatMoney(invoice.subtotal)}</span>
          </div>
          {invoice.discount > 0 && (
            <div className="flex justify-between text-pulse-text-dim">
              <span>{invoice.discount_label || "Discount"}</span>
              <span className="data-mono">−{formatMoney(invoice.discount)}</span>
            </div>
          )}
          {invoice.gst_mode !== "none" && (
            <div className="flex justify-between text-pulse-text-dim">
              <span>{gstLabel(invoice.gst_mode)}</span>
              <span className="data-mono">{formatMoney(invoice.gst)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-pulse-border pt-1.5 text-base font-medium text-pulse-text">
            <span>Total</span>
            <span className="data-mono">{formatMoney(invoice.total)}</span>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 border-t border-pulse-border pt-5 sm:grid-cols-2">
        {(business?.bank_account || business?.bank_bsb) && (
          <div>
            <p className="mono-label mb-1">Payment</p>
            <p className="text-xs text-pulse-text-dim">Pay by bank transfer:</p>
            {business?.bank_name && (
              <p className="data-mono text-xs text-pulse-text">{business.bank_name}</p>
            )}
            <p className="data-mono text-xs text-pulse-text">
              BSB {business?.bank_bsb} · Acct {business?.bank_account}
            </p>
            <p className="data-mono text-xs text-pulse-text-mute">
              Reference: {invoice.invoice_number}
            </p>
          </div>
        )}
        {invoice.notes && (
          <div>
            <p className="mono-label mb-1">Notes</p>
            <p className="whitespace-pre-wrap text-xs text-pulse-text-dim">
              {invoice.notes}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
