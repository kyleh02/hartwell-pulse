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
