/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Chromium is a binary, not something to bundle. Left external, the PDF
  // route loads it from node_modules at runtime; bundled, the executable never
  // arrives and the launch fails with a path that does not exist.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // And keeping it out of the bundle is only half of it. Nothing imports the
  // binary, it is read off disk at runtime, so Next's file tracer has no
  // reason to copy it into the deployed function and does not. The result is
  // an /api route that starts fine and then reports that
  // node_modules/@sparticuz/chromium/bin does not exist. Naming the package
  // here is what puts it in the upload.
  //
  // Scoped to the one route that needs it. Applied broadly it would add tens
  // of megabytes to every function in the deployment.
  //
  // EVERY route that renders a PDF has to be named here, not just the reports
  // ones. renderAndAttach imports the browser dynamically, so a route missing
  // from this list deploys happily and then cannot find the binary at runtime.
  // The recurring cron is the dangerous one: it renders with nobody watching
  // and is built to send anyway rather than fail, so a missing binary there
  // costs a silently unattached PDF on every monthly invoice.
  outputFileTracingIncludes: {
    "/api/reports/[reportId]/pdf": ["./node_modules/@sparticuz/chromium/**/*"],
    "/api/reports/**": ["./node_modules/@sparticuz/chromium/**/*"],
    "/api/invoices/[invoiceId]/pdf": ["./node_modules/@sparticuz/chromium/**/*"],
    "/api/invoices/**": ["./node_modules/@sparticuz/chromium/**/*"],
    "/api/cron/recurring": ["./node_modules/@sparticuz/chromium/**/*"],
  },
  images: {
    remotePatterns: [
      // Supabase Storage public/object URLs (set your project ref in the host)
      { protocol: "https", hostname: "*.supabase.co" },
      // Clerk-hosted user/client avatars
      { protocol: "https", hostname: "img.clerk.com" },
    ],
  },
};

export default nextConfig;
