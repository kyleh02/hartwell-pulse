"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { Menu, X } from "lucide-react";
import { Wordmark } from "@/components/brand/Wordmark";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { clientNav, adminNav, isNavActive, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils/cn";

interface ShellUser {
  name: string;
  email: string | null;
}

interface ShellProps {
  variant: "client" | "admin";
  user: ShellUser;
  clientName?: string | null;
  clientLogoUrl?: string | null;
  children: React.ReactNode;
}

function NavLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active = isNavActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-[var(--radius-input)] px-3 py-2 text-sm transition-colors",
              active
                ? "bg-pulse-surface-2 text-pulse-text"
                : "text-pulse-text-dim hover:bg-pulse-surface-2/60 hover:text-pulse-text",
            )}
          >
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center transition-colors",
                active
                  ? "text-pulse-gold"
                  : "text-pulse-text-mute group-hover:text-pulse-text-dim",
              )}
            >
              <Icon size={18} strokeWidth={1.75} />
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function ClientLogo({
  name,
  logoUrl,
}: {
  name?: string | null;
  logoUrl?: string | null;
}) {
  if (!logoUrl && !name) return null;
  return (
    <div className="flex items-center gap-2 rounded-full border border-pulse-border bg-pulse-surface-2 py-1 pl-1 pr-3">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={name ? `${name} logo` : "Client logo"}
          className="h-6 w-6 rounded-full object-cover"
        />
      ) : (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-pulse-gold/15 text-[11px] font-semibold text-pulse-gold">
          {name?.slice(0, 1).toUpperCase()}
        </span>
      )}
      {name && (
        <span className="max-w-[8rem] truncate text-xs text-pulse-text-dim">
          {name}
        </span>
      )}
    </div>
  );
}

export function Shell({
  variant,
  user,
  clientName,
  clientLogoUrl,
  children,
}: ShellProps) {
  const pathname = usePathname();
  const items = variant === "admin" ? adminNav : clientNav;
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Close on Escape.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const userBlock = (
    <div className="flex items-center gap-3">
      <UserButton
        appearance={{ elements: { avatarBox: "h-8 w-8" } }}
      />
      <div className="min-w-0">
        <p className="truncate text-sm text-pulse-text">{user.name}</p>
        <p className="data-mono truncate text-[11px] text-pulse-text-mute">
          {variant === "admin" ? "ADMIN" : (user.email ?? "CLIENT")}
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-pulse-bg">
      {/* ---------- desktop sidebar ---------- */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-pulse-border bg-pulse-bg bg-grid lg:flex">
        <div className="flex h-16 items-center border-b border-pulse-border px-5">
          <Wordmark size="md" />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <NavLinks items={items} pathname={pathname} />
        </div>
        <div className="border-t border-pulse-border p-4">{userBlock}</div>
      </aside>

      {/* ---------- mobile drawer ---------- */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-pulse-border bg-pulse-bg bg-grid">
            <div className="flex h-16 items-center justify-between border-b border-pulse-border px-5">
              <Wordmark size="md" />
              <button
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-dim hover:bg-pulse-surface-2 hover:text-pulse-text"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-5">
              <NavLinks
                items={items}
                pathname={pathname}
                onNavigate={() => setDrawerOpen(false)}
              />
            </div>
            <div className="border-t border-pulse-border p-4">{userBlock}</div>
          </div>
        </div>
      )}

      {/* ---------- main column ---------- */}
      <div className="print-reset lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-pulse-border bg-pulse-bg/85 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              aria-label="Open menu"
              onClick={() => setDrawerOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-dim hover:bg-pulse-surface-2 hover:text-pulse-text lg:hidden"
            >
              <Menu size={18} />
            </button>
            <div className="lg:hidden">
              <Wordmark size="sm" />
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {variant === "client" && (
              <div className="hidden sm:block">
                <ClientLogo name={clientName} logoUrl={clientLogoUrl} />
              </div>
            )}
            <NotificationBell />
          </div>
        </header>

        <main
          className={cn(
            "print-reset px-4 py-6 sm:px-6 lg:px-8 lg:py-8",
            // leave room for the client bottom tab bar on mobile
            variant === "client" && "pb-24 lg:pb-8",
          )}
        >
          {children}
        </main>
      </div>

      {/* ---------- client bottom tab bar (mobile only) ---------- */}
      {variant === "client" && (
        <nav className="no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-pulse-border bg-pulse-bg/95 backdrop-blur lg:hidden">
          {clientNav.map((item) => {
            const active = isNavActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px]",
                  active ? "text-pulse-gold" : "text-pulse-text-mute",
                )}
              >
                <Icon size={20} strokeWidth={1.75} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
