/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
