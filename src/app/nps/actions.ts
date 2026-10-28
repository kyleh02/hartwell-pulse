"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { recordAnswer, surveyByToken, type AnswerResult, type Survey } from "@/lib/nps";

/** Answered on Home: the survey must be this signed-in person's own. */
export async function answerFromPortal(surveyId: string, score: number, comment: string): Promise<AnswerResult> {
  const session = await getPulseSession();
  if (!session?.clientId) throw new Error("Not authorised");
  const sb = createAdminSupabase();
  const { data } = await sb.from("nps_surveys").select("*").eq("id", surveyId).maybeSingle();
  const survey = data as Survey | null;
  if (!survey || survey.user_id !== session.clerkUserId || survey.client_id !== session.clientId) {
    return { ok: false, message: "That question isn't open any more." };
  }
  const res = await recordAnswer(sb, survey, score, comment, "portal");
  revalidatePath("/dashboard");
  return res;
}

/**
 * Answered from the email. The token in the link is the credential, so no
 * sign-in is needed. The email's buttons only OPEN this page with a number
 * picked; nothing is recorded until Send is pressed, because mail scanners
 * follow every link in a message and would otherwise answer for the client.
 */
export async function answerFromLink(token: string, score: number, comment: string): Promise<AnswerResult> {
  const sb = createAdminSupabase();
  const survey = await surveyByToken(sb, token);
  if (!survey) return { ok: false, message: "This link isn't valid any more." };
  return recordAnswer(sb, survey, score, comment, "email");
}
