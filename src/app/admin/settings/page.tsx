import { createServerSupabase } from "@/lib/supabase/server";
import { getBusinessSettings, listPricingItems } from "@/lib/invoices";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsManager } from "@/components/admin/SettingsManager";
import { OnboardingSettings } from "@/components/admin/OnboardingSettings";

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
        description="Your business details for invoices, your pricing catalogue, and how new clients are welcomed."
      />
      <OnboardingSettings
        kickoffUrl={(business as { kickoff_url?: string | null } | null)?.kickoff_url ?? null}
        welcome={(business as { welcome_message?: string | null } | null)?.welcome_message ?? null}
      />
      <SettingsManager initialBusiness={business} initialPricing={pricing} />
    </div>
  );
}
