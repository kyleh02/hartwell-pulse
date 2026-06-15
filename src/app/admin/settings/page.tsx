import { createServerSupabase } from "@/lib/supabase/server";
import { getBusinessSettings, listPricingItems } from "@/lib/invoices";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsManager } from "@/components/admin/SettingsManager";

export const metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  const supabase = await createServerSupabase();
  const [business, pricing] = await Promise.all([
    getBusinessSettings(supabase),
    listPricingItems(supabase),
  ]);

  return (
    <div>
      <PageHeader
        label={["Settings"]}
        title="Settings"
        description="Your business details for invoices and your pricing catalogue."
      />
      <SettingsManager initialBusiness={business} initialPricing={pricing} />
    </div>
  );
}
