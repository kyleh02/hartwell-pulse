import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Everything except these is protected. Clients are provisioned by Kyle, so
// there is no public sign-up route. Webhook handlers verify their own provider
// signature, and cron endpoints verify CRON_SECRET themselves — both must be
// reachable without a Clerk session (Vercel Cron has no login). They live under
// path-anchored prefixes (note the trailing slash) so siblings like
// /api/webhooks-foo or /api/cron-foo are NOT exempted.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/api/webhooks/(.*)",
  "/api/cron/(.*)",
  // The opt-out link at the foot of every outreach email. The person clicking
  // it has no account, and requiring one to be left alone would be absurd.
  "/unsubscribe/(.*)",
  // The page the PDF renderer opens. A headless browser cannot hold a Clerk
  // session, so the route carries its own check instead: a signed token,
  // scoped to one report id, good for five minutes. Path-anchored like the
  // others, so /printer-foo is not exempted along with it.
  "/print/(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next internals and static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
