import { redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { getClientHome } from "@/lib/client-home";
import { ClientHome } from "@/components/home/ClientHome";
import { SetPasswordCard } from "@/components/home/SetPasswordCard";
import { NpsCard } from "@/components/nps/NpsCard";
import { openSurveyFor } from "@/lib/nps";
import { staffNames } from "@/lib/staff";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  const supabase = await createServerSupabase();
  const staff = await staffNames();
  const [data, survey] = await Promise.all([
    getClientHome(supabase, session.clientId, {
      firstName: session.profile?.full_name,
      staffNames: staff,
    }),
    // Read through RLS: a person only ever sees their own question.
    openSurveyFor(supabase, session.clerkUserId),
  ]);
  if (!data) redirect("/");

  return (
    <>
      <SetPasswordCard />
      {survey && <NpsCard surveyId={survey.id} />}
      <ClientHome data={data} />
    </>
  );
}
