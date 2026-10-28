import { IronpeakWordmark } from "@/components/brand/IronpeakMark";

export const metadata = { title: "Unsubscribed" };

/**
 * The opt-out link from Ironpeak outreach emails sent in 2026.
 *
 * The outreach CRM was deleted on 28 October 2026 (migration 0056), with its
 * opt-outs kept on the do-not-contact list first. Nothing here can look up a
 * token any more, and nothing needs to: there is no list left to send from,
 * so the page's promise is simply true. It still says the same thing whatever
 * the token, as it always did, so it cannot be used to test an address.
 */
export default function UnsubscribePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-pulse-bg px-6 text-center">
      <div className="w-full max-w-md">
        <IronpeakWordmark size="md" className="mb-8" />
        <h1 className="text-xl font-medium text-pulse-text">
          Done. You will not hear from me again.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-pulse-text-dim">
          No further emails will be sent to this address. Nothing else is needed
          from you, and there is no account to close.
        </p>
        <p className="mt-6 text-xs text-pulse-text-mute">
          Sorry for the interruption.
        </p>
      </div>
    </main>
  );
}
