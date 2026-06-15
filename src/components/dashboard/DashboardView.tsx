import { Activity } from "lucide-react";
import type { DashboardData } from "@/lib/dashboard";
import { StatCard } from "@/components/dashboard/StatCard";
import { ServiceSection } from "@/components/dashboard/ServiceSection";
import { EmptyState } from "@/components/ui/EmptyState";

export function DashboardView({ data }: { data: DashboardData }) {
  if (!data.hasData) {
    return (
      <EmptyState
        icon={<Activity size={20} strokeWidth={1.75} />}
        title="Your metrics land here soon"
        description="Once your data sources are connected, your summary cards and service charts show up on this screen."
      />
    );
  }

  return (
    <div className="space-y-6">
      {data.summary.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {data.summary.map((m) => (
            <StatCard key={`${m.serviceKey}-${m.key}`} metric={m} />
          ))}
        </div>
      )}

      <div className="space-y-4">
        {data.sections.map((s) => (
          <ServiceSection key={s.serviceKey} section={s} />
        ))}
      </div>
    </div>
  );
}
