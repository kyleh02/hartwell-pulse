import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Invoice,
  InvoiceLineItem,
  Client,
  BusinessSettings,
  PricingItem,
} from "@/lib/types/database";
import type { InvoiceBundle } from "@/lib/invoices-shared";

export async function getInvoiceBundle(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<InvoiceBundle | null> {
  const { data: inv } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return null;
  const invoice = inv as Invoice;

  const [{ data: client }, { data: lines }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", invoice.client_id).maybeSingle(),
    supabase
      .from("invoice_line_items")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("position", { ascending: true }),
  ]);
  if (!client) return null;

  // An instalment has to be able to say what it is part of, what has been paid
  // already and what is left, or the client reads a second document for half the
  // money and reasonably asks whether they now owe one and a half times the job.
  let parent: Invoice | null = null;
  let siblings: Invoice[] = [];
  if (invoice.parent_invoice_id) {
    const [{ data: p }, { data: sibs }] = await Promise.all([
      supabase
        .from("invoices")
        .select("*")
        .eq("id", invoice.parent_invoice_id)
        .maybeSingle(),
      supabase
        .from("invoices")
        .select("*")
        .eq("parent_invoice_id", invoice.parent_invoice_id)
        .order("instalment_number", { ascending: true }),
    ]);
    parent = (p as Invoice | null) ?? null;
    siblings = (sibs as Invoice[] | null) ?? [];
  }

  return {
    invoice,
    client: client as Client,
    lines: (lines as InvoiceLineItem[] | null) ?? [],
    parent,
    siblings,
  };
}

export type AdminInvoiceRow = Invoice & { client_name: string };

export async function listAdminInvoices(
  supabase: SupabaseClient,
): Promise<AdminInvoiceRow[]> {
  const { data } = await supabase
    .from("invoices")
    .select("*, clients(business_name)")
    .order("created_at", { ascending: false });
  const rows =
    (data as (Invoice & { clients: { business_name: string } | null })[] | null) ??
    [];
  return rows.map((r) => ({
    ...r,
    client_name: r.clients?.business_name ?? "Unknown",
  }));
}

export async function listClientInvoices(
  supabase: SupabaseClient,
  clientId: string,
): Promise<Invoice[]> {
  const { data } = await supabase
    .from("invoices")
    .select("*")
    .eq("client_id", clientId)
    .neq("status", "draft")
    .order("issue_date", { ascending: false });
  return (data as Invoice[] | null) ?? [];
}

export async function getBusinessSettings(
  supabase: SupabaseClient,
): Promise<BusinessSettings | null> {
  const { data } = await supabase
    .from("business_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  return (data as BusinessSettings | null) ?? null;
}

export async function listPricingItems(
  supabase: SupabaseClient,
): Promise<PricingItem[]> {
  const { data } = await supabase
    .from("pricing_items")
    .select("*")
    .order("position", { ascending: true });
  return (data as PricingItem[] | null) ?? [];
}
