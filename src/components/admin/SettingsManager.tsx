"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";
import type { BusinessSettings, GstMode, PricingItem } from "@/lib/types/database";
import { formatMoney } from "@/lib/invoices-shared";
import { Button } from "@/components/ui/Button";

function defaultBusiness(): BusinessSettings {
  return {
    id: 1,
    business_name: "Hartwell Digital",
    abn: null,
    address: null,
    email_from: null,
    bank_name: null,
    bank_bsb: null,
    bank_account: null,
    payment_terms_days: 14,
    gst_mode: "add",
    updated_at: "",
  };
}

export function SettingsManager({
  initialBusiness,
  initialPricing,
}: {
  initialBusiness: BusinessSettings | null;
  initialPricing: PricingItem[];
}) {
  const supabase = useSupabaseClient();
  const [biz, setBiz] = useState<BusinessSettings>(
    initialBusiness ?? defaultBusiness(),
  );
  const [savedBiz, setSavedBiz] = useState(true);
  const [items, setItems] = useState<PricingItem[]>(initialPricing);
  const [draft, setDraft] = useState({ category: "", name: "", tier: "", default_amount: 0 });

  function setField<K extends keyof BusinessSettings>(k: K, v: BusinessSettings[K]) {
    setBiz((p) => ({ ...p, [k]: v }));
    setSavedBiz(false);
  }
  async function saveBiz() {
    await supabase
      .from("business_settings")
      .update({
        business_name: biz.business_name,
        abn: biz.abn,
        address: biz.address,
        email_from: biz.email_from,
        bank_name: biz.bank_name,
        bank_bsb: biz.bank_bsb,
        bank_account: biz.bank_account,
        payment_terms_days: biz.payment_terms_days,
        gst_mode: biz.gst_mode,
      })
      .eq("id", 1);
    setSavedBiz(true);
  }

  async function updateItem(id: string, patch: Partial<PricingItem>) {
    setItems((p) => p.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    await supabase.from("pricing_items").update(patch).eq("id", id);
  }
  async function deleteItem(id: string) {
    setItems((p) => p.filter((i) => i.id !== id));
    await supabase.from("pricing_items").delete().eq("id", id);
  }
  async function addItem() {
    if (!draft.name.trim()) return;
    const { data } = await supabase
      .from("pricing_items")
      .insert({
        category: draft.category.trim() || "General",
        name: draft.name.trim(),
        tier: draft.tier.trim() || null,
        default_amount: Number(draft.default_amount) || 0,
        position: items.length,
      })
      .select("*")
      .single();
    if (data) setItems((p) => [...p, data as PricingItem]);
    setDraft({ category: "", name: "", tier: "", default_amount: 0 });
  }

  const field =
    "rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none";

  return (
    <div className="space-y-8">
      {/* business details */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-pulse-text">
            Business details (for invoices)
          </h2>
          <div className="flex items-center gap-2">
            <span className="data-mono text-[11px] text-pulse-text-mute">
              {savedBiz ? "saved" : "unsaved"}
            </span>
            <Button size="sm" variant="secondary" onClick={saveBiz}>
              Save
            </Button>
          </div>
        </div>
        <div className="grid gap-3 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="mono-label">Business name</span>
            <input className={field} value={biz.business_name} onChange={(e) => setField("business_name", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="mono-label">ABN</span>
            <input className={field} value={biz.abn ?? ""} onChange={(e) => setField("abn", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="mono-label">Address</span>
            <textarea className={field} rows={2} value={biz.address ?? ""} onChange={(e) => setField("address", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="mono-label">Bank name</span>
            <input className={field} value={biz.bank_name ?? ""} onChange={(e) => setField("bank_name", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="mono-label">Sending email (from)</span>
            <input className={field} value={biz.email_from ?? ""} onChange={(e) => setField("email_from", e.target.value)} placeholder="kyle@hartwelldigital.com" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="mono-label">BSB</span>
            <input className={field} value={biz.bank_bsb ?? ""} onChange={(e) => setField("bank_bsb", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="mono-label">Account number</span>
            <input className={field} value={biz.bank_account ?? ""} onChange={(e) => setField("bank_account", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="mono-label">Default terms (days)</span>
            <input type="number" className={field} value={biz.payment_terms_days} onChange={(e) => setField("payment_terms_days", Number(e.target.value))} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="mono-label">Default GST</span>
            <select className={field} value={biz.gst_mode} onChange={(e) => setField("gst_mode", e.target.value as GstMode)}>
              <option value="add">Add 10% GST</option>
              <option value="inclusive">Prices include GST</option>
              <option value="none">No GST</option>
            </select>
          </label>
        </div>
      </section>

      {/* pricing catalogue */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-pulse-text">
          Pricing catalogue
        </h2>
        <p className="mb-3 text-xs text-pulse-text-mute">
          Set your fixed prices here. They prefill on invoices and you can amend
          any line before sending.
        </p>
        <div className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
          <div className="divide-y divide-pulse-border">
            {items.map((it) => (
              <div key={it.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-pulse-text">
                    {it.name}
                    {it.tier && (
                      <span className="text-pulse-text-dim"> — {it.tier}</span>
                    )}
                  </p>
                  <p className="data-mono text-[10px] uppercase tracking-wider text-pulse-text-mute">
                    {it.category}
                  </p>
                </div>
                <div className="flex items-center gap-1 text-sm text-pulse-text-mute">
                  <span>$</span>
                  <input
                    type="number"
                    value={it.default_amount}
                    onChange={(e) => updateItem(it.id, { default_amount: Number(e.target.value) })}
                    className={`${field} w-28 text-right`}
                  />
                </div>
                <label className="flex items-center gap-1.5 text-xs text-pulse-text-dim">
                  <input
                    type="checkbox"
                    checked={it.active}
                    onChange={(e) => updateItem(it.id, { active: e.target.checked })}
                  />
                  Active
                </label>
                <button
                  type="button"
                  onClick={() => deleteItem(it.id)}
                  aria-label="Delete item"
                  className="text-pulse-text-mute hover:text-pulse-danger"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {items.length === 0 && (
              <p className="p-4 text-xs text-pulse-text-mute">
                No items yet. Run the pricing seed, or add them below.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-pulse-border p-3">
            <input className={`${field} w-32`} placeholder="Category" value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} />
            <input className={`${field} flex-1`} placeholder="Name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            <input className={`${field} w-28`} placeholder="Tier" value={draft.tier} onChange={(e) => setDraft((d) => ({ ...d, tier: e.target.value }))} />
            <input type="number" className={`${field} w-28 text-right`} placeholder="Amount" value={draft.default_amount || ""} onChange={(e) => setDraft((d) => ({ ...d, default_amount: Number(e.target.value) }))} />
            <button
              type="button"
              onClick={addItem}
              className="inline-flex items-center gap-1 rounded-[var(--radius-input)] border border-dashed border-pulse-border px-3 py-2 text-xs text-pulse-text-dim hover:text-pulse-text"
            >
              <Plus size={13} /> Add
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
