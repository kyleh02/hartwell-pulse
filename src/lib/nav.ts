import {
  Globe,
  House,
  FileText,
  FolderOpen,
  MessageSquare,
  Users,
  Settings,
  CalendarRange,
  ClipboardCheck,
  Receipt,
  PenLine,
  Target,
  TrendingUp,
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
  { label: "Home", href: "/dashboard", icon: House },
  { label: "Reports", href: "/reports", icon: FileText },
  { label: "Assets", href: "/assets", icon: FolderOpen },
  { label: "Approvals", href: "/approvals", icon: ClipboardCheck },
  // Only shown to clients who already have copy documents; the approval board
  // is where new work goes.
  { label: "Copy", href: "/copy", icon: PenLine },
  { label: "Website", href: "/website", icon: Globe },
  { label: "Messages", href: "/messages", icon: MessageSquare, badge: "messages" },
  { label: "Invoices", href: "/invoices", icon: Receipt },
];

export const adminNav: NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: CalendarRange },
  { label: "Clients", href: "/admin/clients", icon: Users },
  { label: "Reports", href: "/admin/reports", icon: FileText },
  { label: "Assets", href: "/admin/assets", icon: FolderOpen },
  { label: "Copy", href: "/admin/copy", icon: PenLine },
  { label: "Approvals", href: "/admin/approvals", icon: ClipboardCheck },
  { label: "Messages", href: "/admin/messages", icon: MessageSquare, badge: "messages" },
  { label: "Invoices", href: "/admin/invoices", icon: Receipt },
  { label: "Income", href: "/admin/income", icon: TrendingUp },
  // Ironpeak Consulting outreach. Admin only, like the rest of this nav.
  { label: "Pipeline", href: "/admin/crm", icon: Target },
  { label: "Settings", href: "/admin/settings", icon: Settings },
];

/**
 * Exact match for the admin index, prefix match for the rest. The client Home
 * is a prefix match because its performance page lives under it and is reached
 * from it, so Home stays lit there.
 */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}
