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
  outputFileTracingIncludes: {
    "/api/reports/[reportId]/pdf": ["./node_modules/@sparticuz/chromium/**/*"],
    "/api/reports/**": ["./node_modules/@sparticuz/chromium/**/*"],
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
