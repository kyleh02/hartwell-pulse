import {
  LayoutDashboard,
  FileText,
  FolderOpen,
  MessageSquare,
  Users,
  Settings,
  CalendarRange,
  Receipt,
  PenLine,
  Target,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Live indicator rendered next to the label (only "messages" so far). */
  badge?: "messages";
}

export const clientNav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Reports", href: "/reports", icon: FileText },
  { label: "Assets", href: "/assets", icon: FolderOpen },
  { label: "Copy", href: "/copy", icon: PenLine },
  { label: "Messages", href: "/messages", icon: MessageSquare, badge: "messages" },
  { label: "Invoices", href: "/invoices", icon: Receipt },
];

export const adminNav: NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: CalendarRange },
  { label: "Clients", href: "/admin/clients", icon: Users },
  { label: "Reports", href: "/admin/reports", icon: FileText },
  { label: "Assets", href: "/admin/assets", icon: FolderOpen },
  { label: "Copy", href: "/admin/copy", icon: PenLine },
  { label: "Messages", href: "/admin/messages", icon: MessageSquare, badge: "messages" },
  { label: "Invoices", href: "/admin/invoices", icon: Receipt },
  // Ironpeak Consulting outreach. Admin only, like the rest of this nav.
  { label: "Pipeline", href: "/admin/crm", icon: Target },
  { label: "Settings", href: "/admin/settings", icon: Settings },
];

/** Exact match for index routes, prefix match for the rest. */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/admin" || href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}
