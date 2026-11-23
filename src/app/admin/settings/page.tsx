import { createServerSupabase } from "@/lib/supabase/server";
import { getBusinessSettings, listPricingItems } from "@/lib/invoices";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsManager } from "@/components/admin/SettingsManager";
import { OnboardingSettings } from "@/components/admin/OnboardingSettings";
import { ClaudeConnector } from "@/components/admin/ClaudeConnector";
import { FeedbackSettings } from "@/components/admin/FeedbackSettings";
import { AssistantSettings } from "@/components/admin/AssistantSettings";
import { aiConfigured } from "@/lib/ai/claude";
import { listConnections } from "@/app/admin/settings/connector-actions";
import { requestOrigin } from "@/lib/mcp/http";
import { GoogleCalendarSettings } from "@/components/admin/GoogleCalendarSettings";
import { calendarConnection } from "@/lib/gcal/access";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getPulseSession } from "@/lib/auth/session";

export const metadata = { title: "Settings" };

export default async function AdminSettingsPage({ searchParams }: { searchParams: Promise<{ calendar?: string; why?: string }> }) {
  const supabase = await createServerSupabase();
  const session = await getPulseSession();
  const sp = await searchParams;
  const [business, pricing, connections, origin, calendar] = await Promise.all([
    getBusinessSettings(supabase),
    listPricingItems(supabase),
    listConnections(),
    requestOrigin(),
    session?.role === "admin" ? calendarConnection(createAdminSupabase()) : Promise.resolve(null),
  ]);

  return (
    <div>
      <PageHeader
        label={["Settings"]}
        title="Settings"
        description="Your business details for invoices, your pricing catalogue, how new clients are welcomed, client feedback, the portal assistant, and Claude's access to your pipeline."
      />
      <GoogleCalendarSettings
        connection={calendar}
        outcome={sp.calendar ? { kind: sp.calendar, why: sp.why ?? null } : null}
      />
      <OnboardingSettings
        kickoffUrl={(business as { kickoff_url?: string | null } | null)?.kickoff_url ?? null}
        welcome={(business as { welcome_message?: string | null } | null)?.welcome_message ?? null}
      />
      <FeedbackSettings
        enabled={(business as { nps_enabled?: boolean } | null)?.nps_enabled === true}
        reviewUrl={(business as { google_review_url?: string | null } | null)?.google_review_url ?? null}
      />
      <AssistantSettings
        enabled={(business as { assistant_enabled?: boolean } | null)?.assistant_enabled === true}
        knowledge={(business as { assistant_knowledge?: string | null } | null)?.assistant_knowledge ?? null}
        keySet={aiConfigured()}
      />
      <ClaudeConnector url={`${origin}/api/mcp`} connections={connections} />
      <SettingsManager initialBusiness={business} initialPricing={pricing} />
    </div>
  );
}
