/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Chromium is a binary, not something to bundle. Left external, the PDF
  // route loads it from node_modules at runtime; bundled, the executable never
  // arrives and the launch fails with a path that does not exist.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
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
