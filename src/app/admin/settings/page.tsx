import { createServerSupabase } from "@/lib/supabase/server";
import { getBusinessSettings, listPricingItems } from "@/lib/invoices";
import { getDriveStatus } from "@/lib/google-drive";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsManager } from "@/components/admin/SettingsManager";
import { GoogleDriveCard } from "@/components/admin/GoogleDriveCard";

export const metadata = { title: "Settings" };

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ drive?: string }>;
}) {
  const supabase = await createServerSupabase();
  const [business, pricing, drive, { drive: outcome }] = await Promise.all([
    getBusinessSettings(supabase),
    listPricingItems(supabase),
    getDriveStatus(),
    searchParams,
  ]);

  return (
    <div>
      <PageHeader
        label={["Settings"]}
        title="Settings"
        description="Your business details for invoices, your pricing catalogue, and the Google Drive connection."
      />
      <GoogleDriveCard status={drive} outcome={outcome ?? null} />
      <SettingsManager initialBusiness={business} initialPricing={pricing} />
    </div>
  );
}
