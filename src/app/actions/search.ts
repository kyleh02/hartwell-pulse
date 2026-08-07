"use server";

import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { monthLabel } from "@/lib/metrics";
import { formatMoney } from "@/lib/invoices-shared";

export interface SearchHit {
  id: string;
  group: string;
  title: string;
  subtitle: string | null;
  href: string;
}

/**
 * One search across everything the signed-in person is allowed to see.
 *
 * RLS does the access control, not this function. It runs on the ordinary
 * server client, so a client account searching "invoice" gets their own
 * invoices and nothing else, and the CRM query returns nothing at all for them
 * because crm_* is admin-only. That is the whole reason this is safe to write
 * as one flat sweep rather than branching on role and hoping the branch is
 * right.
 *
 * Deliberately capped small per group. A palette is for jumping to the thing
 * you were already thinking of, not for browsing, and twelve near-identical
 * rows is worse than four.
 */
export async function searchEverything(raw: string): Promise<SearchHit[]> {
  const q = raw.trim();
  if (q.length < 2) return [];

  const session = await getPulseSession();
  if (!session) return [];
  const isAdmin = session.role === "admin";
  const supabase = await createServerSupabase();
  const like = `%${q}%`;
  const hits: SearchHit[] = [];

  const [clients, invoices, reports, assets, copy, crm] = await Promise.all([
    isAdmin
      ? supabase
          .from("clients")
          .select("id, business_name, status")
          .ilike("business_name", like)
          .is("deleted_at", null)
          .limit(5)
      : Promise.resolve({ data: null }),
    supabase
      .from("invoices")
      .select("id, invoice_number, total, status, clients(business_name)")
      .ilike("invoice_number", like)
      .limit(5),
    supabase
      .from("reports")
      .select("id, title, period_month, status")
      .ilike("title", like)
      .limit(5),
    supabase.from("assets").select("id, name, client_id").ilike("name", like).limit(5),
    supabase
      .from("copy_documents")
      .select("id, title, status")
      .ilike("title", like)
      .limit(5),
    isAdmin
      ? supabase
          .from("crm_organisations")
          .select("id, legal_name, trading_name, stage, brand")
          .or(`legal_name.ilike.${like},trading_name.ilike.${like}`)
          .limit(6)
      : Promise.resolve({ data: null }),
  ]);

  for (const c of (clients.data as
    | { id: string; business_name: string; status: string }[]
    | null) ?? []) {
    hits.push({
      id: `client-${c.id}`,
      group: "Clients",
      title: c.business_name,
      subtitle: c.status,
      href: `/admin/clients/${c.id}`,
    });
  }

  for (const i of (invoices.data as
    | {
        id: string;
        invoice_number: string;
        total: number;
        status: string;
        clients: { business_name: string } | null;
      }[]
    | null) ?? []) {
    hits.push({
      id: `invoice-${i.id}`,
      group: "Invoices",
      title: i.invoice_number,
      subtitle: `${formatMoney(Number(i.total))} · ${i.status}${
        i.clients ? ` · ${i.clients.business_name}` : ""
      }`,
      href: isAdmin ? `/admin/invoices/${i.id}` : `/invoices/${i.id}`,
    });
  }

  for (const r of (reports.data as
    | { id: string; title: string; period_month: string; status: string }[]
    | null) ?? []) {
    hits.push({
      id: `report-${r.id}`,
      group: "Reports",
      title: r.title,
      subtitle: `${monthLabel(r.period_month)} · ${r.status}`,
      href: isAdmin ? `/admin/reports/${r.id}` : `/reports/${r.id}`,
    });
  }

  for (const a of (assets.data as { id: string; name: string }[] | null) ?? []) {
    hits.push({
      id: `asset-${a.id}`,
      group: "Assets",
      title: a.name,
      subtitle: null,
      href: isAdmin ? "/admin/assets" : "/assets",
    });
  }

  for (const d of (copy.data as
    | { id: string; title: string; status: string }[]
    | null) ?? []) {
    hits.push({
      id: `copy-${d.id}`,
      group: "Copy",
      title: d.title,
      subtitle: d.status,
      href: isAdmin ? `/admin/copy/${d.id}` : `/copy/${d.id}`,
    });
  }

  for (const o of (crm.data as
    | {
        id: string;
        legal_name: string;
        trading_name: string | null;
        stage: string;
        brand: string;
      }[]
    | null) ?? []) {
    hits.push({
      id: `crm-${o.id}`,
      group: "Pipeline",
      title: o.trading_name || o.legal_name,
      subtitle: `${o.stage} · ${o.brand}`,
      href: `/admin/crm/${o.id}`,
    });
  }

  return hits;
}
