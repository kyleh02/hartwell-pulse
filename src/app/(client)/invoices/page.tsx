import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { listClientInvoices } from "@/lib/invoices";
import { formatMoney } from "@/lib/invoices-shared";
import type { InvoiceStatus } from "@/lib/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const metadata = { title: "Invoices" };

const TONE: Record<InvoiceStatus, "neutral" | "gold" | "success" | "danger"> = {
  draft: "neutral",
  sent: "gold",
  paid: "success",
  void: "danger",
};

function pretty(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function ClientInvoicesPage() {
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  const supabase = await createServerSupabase();
  const invoices = await listClientInvoices(supabase, session.clientId);

  return (
    <div>
      <PageHeader
        label={["Invoices"]}
        title="Your invoices"
        description="Your invoices from Hartwell Digital. Open one to view it or download a PDF."
      />

      {invoices.length === 0 ? (
        <EmptyState
          icon={<Receipt size={20} strokeWidth={1.75} />}
          title="No invoices yet"
          description="When Kyle sends you an invoice it will appear here, and you will get an email."
        />
      ) : (
        <div className="space-y-2">
          {invoices.map((inv) => (
            <Link key={inv.id} href={`/invoices/${inv.id}`}>
              <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:border-pulse-border-strong">
                <div className="min-w-0">
                  <p className="data-mono font-medium text-pulse-text">
                    {inv.invoice_number}
                  </p>
                  <p className="data-mono mt-0.5 text-xs text-pulse-text-mute">
                    Due {pretty(inv.due_date)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="data-mono text-sm text-pulse-text">
                    {formatMoney(inv.total)}
                  </span>
                  <Badge tone={TONE[inv.status]}>{inv.status}</Badge>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
