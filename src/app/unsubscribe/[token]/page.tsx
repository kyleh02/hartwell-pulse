import { createAdminSupabase } from "@/lib/supabase/admin";
import { IronpeakWordmark } from "@/components/brand/IronpeakMark";

export const metadata = { title: "Unsubscribed" };

/**
 * The opt-out link at the foot of every outreach email.
 *
 * Public and unauthenticated, because the person clicking it has no account
 * and asking them to make one to be left alone would be outrageous. It acts on
 * GET, which is normally poor practice, but here the alternative is a page
 * with a button that some recipients will not press, and an opt-out that only
 * works for people who complete a second step is not a functional opt-out.
 *
 * It says the same thing whether or not the token matched anything. A page
 * that distinguished a real token from a made-up one would let anyone test
 * whether an address is on the list.
 */
export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Nothing is read back. The function sets the flag and returns nothing, so
  // this page never learns who the token belonged to.
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (valid.test(token)) {
    await createAdminSupabase().rpc("crm_opt_out", { token });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-pulse-bg px-6 text-center">
      <div className="w-full max-w-md">
        <IronpeakWordmark size="md" className="mb-8" />
        <h1 className="text-xl font-medium text-pulse-text">
          Done. You will not hear from me again.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-pulse-text-dim">
          Your address has been removed and no further emails will be sent to
          it. Nothing else is needed from you, and there is no account to close.
        </p>
        <p className="mt-6 text-xs text-pulse-text-mute">
          Sorry for the interruption.
        </p>
        {/* No Hartwell wordmark here, and none anywhere a prospect can see.
            Ironpeak is a registered business name against Hartwell Digital and
            the ABN in the email footer is the only permitted expression of
            that. A second logo would undo it. */}
      </div>
    </main>
  );
}
