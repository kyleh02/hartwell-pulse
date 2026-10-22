/**
 * What a page shows while its data is being fetched.
 *
 * Every page in the portal fetches on the server before it can render, and
 * there used to be no loading file anywhere, so Next had nothing to put on
 * screen in the meantime. It kept the OLD page frozen until the new one was
 * complete: a click, a stall long enough to wonder whether it registered, then
 * a jump. This is shown the instant a link is followed instead, and Next
 * prefetches it for every link in view, so the swap happens before the server
 * has answered.
 *
 * The shape follows PageHeader and a run of cards, which is what most pages
 * open with, so the real page settles into roughly the same place rather than
 * reflowing everything when it lands.
 *
 * The bar is a SIBLING of the faded placeholder, not inside it. A fade gives
 * its element a stacking context, and a fixed bar inside one is painted at that
 * element's level, which is underneath the sticky header: there, and invisible.
 *
 * A server component with no state. Motion comes from CSS, which the global
 * reduced-motion rule stops; the bar and the blocks are drawn so they stay
 * visible when it does.
 */
export function PageLoading() {
  return (
    <>
      <div className="pulse-progress no-print" aria-hidden="true" />
      <div className="page-loading" aria-busy="true">
        <span className="sr-only" role="status">
          Loading
        </span>

        <div className="mb-6 sm:mb-8" aria-hidden="true">
          <div className="skeleton mb-3 h-3 w-28" />
          <div className="skeleton h-7 w-56 max-w-full" />
          <div className="skeleton mt-3 h-4 w-full max-w-md" />
        </div>

        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4"
            >
              <div className="skeleton h-4 w-1/3" />
              <div className="skeleton mt-3 h-3 w-2/3" />
              <div className="skeleton mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
