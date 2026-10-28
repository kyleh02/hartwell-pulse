import { createAdminSupabase } from "@/lib/supabase/admin";
import { surveyByToken } from "@/lib/nps";
import { Wordmark } from "@/components/brand/Wordmark";
import { NpsForm } from "@/components/nps/NpsForm";

export const metadata = { title: "A quick question", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Where the number buttons in the feedback email land. Public in middleware:
 * the token in the address is the credential, so a client can answer from
 * their phone without signing in. The number they tapped arrives picked, and
 * nothing is saved until they press Send.
 */
export default async function NpsLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const [{ token }, { s }] = await Promise.all([params, searchParams]);
  const survey = await surveyByToken(createAdminSupabase(), token);
  const n = Number(s);
  const initial = s !== undefined && Number.isInteger(n) && n >= 0 && n <= 10 ? n : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-pulse-bg px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex justify-center">
          <Wordmark size="lg" />
        </div>
        <div className="rounded-[20px] border border-pulse-border bg-pulse-surface p-5 sm:p-8">
          {!survey ? (
            <p className="text-sm text-pulse-text-dim">This link isn&apos;t valid any more. If you&apos;d like to tell me something, the chat in your portal comes straight to me.</p>
          ) : survey.answered_at ? (
            <p className="text-[15px] text-pulse-text">Thank you, I already have your answer.</p>
          ) : (
            <NpsForm token={token} initialScore={initial} />
          )}
        </div>
      </div>
    </main>
  );
}
