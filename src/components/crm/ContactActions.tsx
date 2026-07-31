"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  Linkedin,
  Mail,
  Pencil,
  Phone,
  Globe,
  UserPlus,
} from "lucide-react";
import type { CrmContact } from "@/lib/types/database";

/**
 * Tap targets for actually reaching someone from a phone: the mail app, the
 * dialler, LinkedIn, their site. Copy is here because Kyle writes the real
 * email in Outlook, so getting the exact published address onto the clipboard
 * without retyping it is the whole job.
 *
 * The published address is shown verbatim, never tidied. It is the evidence
 * that inferred consent attaches to it, and a helpfully lowercased copy is no
 * longer the string that was published.
 */
export function ContactActions({
  contact,
  websiteUrl,
  subject,
  onEdit,
}: {
  contact: CrmContact | null;
  websiteUrl: string | null;
  subject?: string;
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  // No contact yet is a state worth showing, not hiding: naming the person is
  // the next thing to do, so offer the way in rather than an empty space.
  if (!contact) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-pulse-border bg-pulse-surface/40 p-3">
        <p className="mono-label">// Reach them</p>
        <p className="mt-1.5 text-xs text-pulse-text-dim">
          No one named yet. Add the person and their details before anything can
          be sent.
        </p>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="mt-2 flex min-h-[36px] items-center gap-1.5 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 text-sm text-pulse-text-dim transition-colors hover:border-pulse-border-strong hover:text-pulse-text"
          >
            <UserPlus size={14} /> Add contact
          </button>
        )}
      </div>
    );
  }

  const published = contact.email_as_published?.trim() || null;
  const direct = contact.direct_email?.trim() || null;
  const phone = contact.phone?.trim() || null;
  const optedOut = !!contact.opt_out_at;

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // clipboard unavailable; the address is on screen to read
    }
  }

  if (!published && !direct && !phone && !contact.linkedin_url && !websiteUrl) {
    return null;
  }

  // Never hand out a one-tap mail link for a contact who has opted out.
  const mailTo = optedOut ? null : (direct ?? published);

  return (
    <div className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="mono-label">// Reach them</p>
          <p className="mt-1 truncate text-sm text-pulse-text">
            {[contact.first_name, contact.surname].filter(Boolean).join(" ") ||
              "Unnamed contact"}
          </p>
          {contact.role_title && (
            <p className="truncate text-xs text-pulse-text-mute">
              {contact.role_title}
              {!contact.role_confirmed && " · unconfirmed"}
            </p>
          )}
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit contact details"
            title="Edit name, phone and email"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute transition-colors hover:bg-pulse-surface-2 hover:text-pulse-text"
          >
            <Pencil size={14} />
          </button>
        )}
      </div>

      {optedOut && (
        <p className="mt-1.5 text-xs text-pulse-danger">
          This contact opted out. Email and dialler links are disabled.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {mailTo && (
          <Action
            href={`mailto:${mailTo}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`}
            icon={<Mail size={14} />}
            label="Email"
          />
        )}
        {phone && !optedOut && (
          <Action
            href={`tel:${phone.replace(/[^+\d]/g, "")}`}
            icon={<Phone size={14} />}
            label="Call"
          />
        )}
        {contact.linkedin_url && (
          <Action
            href={contact.linkedin_url}
            external
            icon={<Linkedin size={14} />}
            label="LinkedIn"
          />
        )}
        {websiteUrl && (
          <Action href={websiteUrl} external icon={<Globe size={14} />} label="Site" />
        )}
      </div>

      <dl className="mt-3 space-y-1.5">
        {published && (
          <CopyRow
            label="Published"
            value={published}
            copied={copied === "published"}
            onCopy={() => copy(published, "published")}
          />
        )}
        {direct && (
          <CopyRow
            label="Direct"
            value={direct}
            copied={copied === "direct"}
            onCopy={() => copy(direct, "direct")}
          />
        )}
        {phone && (
          <CopyRow
            label="Phone"
            value={phone}
            copied={copied === "phone"}
            onCopy={() => copy(phone, "phone")}
          />
        )}
      </dl>
    </div>
  );
}

function Action({
  href,
  icon,
  label,
  external,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="flex min-h-[36px] items-center gap-1.5 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 text-sm text-pulse-text-dim transition-colors hover:border-pulse-border-strong hover:text-pulse-text"
    >
      {icon}
      {label}
    </a>
  );
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="mono-label shrink-0">{label}</span>
      <button
        type="button"
        onClick={onCopy}
        title="Copy"
        className="flex min-w-0 items-center gap-1.5 text-pulse-text-dim transition-colors hover:text-pulse-text"
      >
        <span className="data-mono truncate text-xs">{value}</span>
        {copied ? (
          <Check size={12} className="shrink-0 text-pulse-success" />
        ) : (
          <Copy size={12} className="shrink-0" />
        )}
      </button>
    </div>
  );
}
