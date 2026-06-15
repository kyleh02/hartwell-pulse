import { SectionLabel } from "@/components/ui/SectionLabel";

export function PageHeader({
  label,
  title,
  description,
  actions,
}: {
  label?: string[];
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {label && <SectionLabel parts={label} className="mb-2" />}
        <h1 className="text-2xl font-semibold tracking-tight text-pulse-text">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm text-pulse-text-dim">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
