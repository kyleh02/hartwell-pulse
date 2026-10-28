import { SectionLabel } from "@/components/ui/SectionLabel";

/**
 * The top of every page, set the way the website sets its sections: a gold
 * eyebrow, a heavy uppercase title whose last word is picked out in gold, and
 * a thin gold rule fading away underneath.
 *
 * A one-word title stays plain. Gold on the only word reads as a highlight of
 * nothing in particular; the website only ever golds the word that lands it.
 */
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
  const words = title.trim().split(/\s+/);
  const last = words.length > 1 ? words.pop() : null;

  return (
    <div className="mb-7 sm:mb-9">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {label && <SectionLabel parts={label} className="mb-3" />}
          <h1 className="text-[26px] leading-[1.05] font-extrabold tracking-[-0.01em] break-words text-pulse-text uppercase sm:text-[34px]">
            {words.join(" ")}
            {last && (
              <>
                {" "}
                <span className="text-pulse-gold">{last}</span>
              </>
            )}
          </h1>
          {description && (
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-pulse-text-dim">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="gold-rule mt-6" aria-hidden="true" />
    </div>
  );
}
