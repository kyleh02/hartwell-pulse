import type { Metadata, Viewport } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Hartwell Pulse",
    template: "%s · Hartwell Pulse",
  },
  description:
    "Your marketing, in one place. Check the pulse of your campaigns with Hartwell Digital.",
  icons: { icon: "/favicon.ico" },
};

export const viewport: Viewport = {
  themeColor: "#0a0908",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // clerkJSVersion pins a Clerk.js >= 5.108 so the prebuilt sign-in supports the
  // Client Trust step. The v6 SDK's default loads an older Clerk.js that throws
  // "needs_client_trust not supported yet".
  return (
    <ClerkProvider
      clerkJSVersion="5.125.13"
      appearance={{
        variables: {
          colorPrimary: "#b5a675",
          colorBackground: "#14110f",
          colorInputBackground: "#1c1815",
          colorText: "#f9f7f2",
          colorTextSecondary: "rgba(249,247,242,0.55)",
          colorInputText: "#f9f7f2",
          colorTextOnPrimaryBackground: "#14110f",
          colorDanger: "#b5563f",
          colorSuccess: "#6ba368",
          colorWarning: "#c9a04c",
          colorNeutral: "#f9f7f2",
          borderRadius: "8px",
          fontFamily: "var(--font-outfit), sans-serif",
        },
        elements: {
          card: "bg-pulse-surface border border-pulse-border shadow-none",
          headerTitle: "text-pulse-text",
          headerSubtitle: "text-pulse-text-dim",
          socialButtonsBlockButton:
            "border-pulse-border text-pulse-text hover:bg-pulse-surface-2",
          formButtonPrimary:
            "bg-pulse-gold text-pulse-bg hover:bg-pulse-gold-light text-sm normal-case",
          formFieldInput:
            "bg-pulse-surface-2 border-pulse-border text-pulse-text",
          footerActionLink: "text-pulse-gold hover:text-pulse-gold-light",
        },
      }}
    >
      <html
        lang="en-AU"
        className={`${outfit.variable} ${jetbrainsMono.variable}`}
        suppressHydrationWarning
      >
        <body className="min-h-screen bg-pulse-bg text-pulse-text antialiased">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
