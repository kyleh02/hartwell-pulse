"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users, X, Copy, Check, Plus, Pencil } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/Button";
import { useSupabaseClient } from "@/lib/supabase/client";
import { addClientUser, updateClientUserEmail } from "@/app/admin/clients/actions";

const fieldCls =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none";

interface UserRow {
  clerk_user_id: string;
  full_name: string | null;
  email: string | null;
}

/**
 * View a client's portal users and add another (e.g. a business partner).
 * Each user gets their own login and their own private thread with Kyle;
 * assets, invoices and reports are shared across the client.
 */
export function ClientUsersDialog({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const supabase = useSupabaseClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ contactName: "", email: "" });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    const { data } = await supabase
      .from("client_users")
      .select("clerk_user_id, full_name, email")
      .eq("client_id", clientId)
      .eq("role", "client")
      .order("created_at");
    setUsers((data as UserRow[] | null) ?? []);
  }, [supabase, clientId]);

  useEffect(() => {
    if (open) void loadUsers();
  }, [open, loadUsers]);

  function close() {
    setOpen(false);
    setAdding(false);
    setForm({ contactName: "", email: "" });
    setError(null);
    setResult(null);
    setCopied(false);
    setEditing(null);
    setEditError(null);
    router.refresh();
  }

  function startEdit(u: UserRow) {
    setEditing(u.clerk_user_id);
    setEditEmail(u.email ?? "");
    setEditError(null);
  }

  function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditError(null);
    const target = editing;
    startTransition(async () => {
      try {
        await updateClientUserEmail(target, editEmail);
        setEditing(null);
        void loadUsers();
      } catch (err) {
        setEditError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await addClientUser(clientId, form);
        setResult(res);
        void loadUsers();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(
        `Hartwell Pulse — your login\n` +
          `Portal: https://portal.hartwelldigital.com\n` +
          `Email: ${result.email}\n` +
          `Temporary password: ${result.password}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available; ignore
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClasses("secondary", "sm")}
      >
        <Users size={14} /> Users
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={close}
          role="presentation"
        >
          <div
            className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-medium text-pulse-text">
                {clientName} users
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="text-pulse-text-mute transition-colors hover:text-pulse-text"
              >
                <X size={18} />
              </button>
            </div>

            {result ? (
              <div className="space-y-4">
                <p className="text-sm text-pulse-text-dim">
                  Their account is ready. Share these one-time login details with{" "}
                  <span className="text-pulse-text">{result.email}</span> — they can
                  change the password after signing in.
                </p>
                <div className="space-y-2 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 p-3">
                  <Row label="Portal" value="portal.hartwelldigital.com" />
                  <Row label="Email" value={result.email} />
                  <Row label="Temp password" value={result.password} mono />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Button variant="secondary" size="sm" onClick={copy}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? "Copied" : "Copy details"}
                  </Button>
                  <Button size="sm" onClick={close}>
                    Done
                  </Button>
                </div>
                <p className="text-xs text-pulse-text-mute">
                  This password is shown once. If it&apos;s lost, they can reset it from
                  the sign-in page.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  {users === null ? (
                    <p className="text-xs text-pulse-text-mute">Loading…</p>
                  ) : users.length === 0 ? (
                    <p className="text-xs text-pulse-text-mute">No users yet.</p>
                  ) : (
                    users.map((u) =>
                      editing === u.clerk_user_id ? (
                        <form
                          key={u.clerk_user_id}
                          onSubmit={saveEmail}
                          className="space-y-2 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2"
                        >
                          <p className="text-sm text-pulse-text">
                            {u.full_name ?? "Unnamed user"}
                          </p>
                          <input
                            required
                            autoFocus
                            type="email"
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                            className={fieldCls}
                            placeholder="new@email.com.au"
                          />
                          <p className="text-xs text-pulse-text-mute">
                            Their login email changes straight away; the password
                            stays the same.
                          </p>
                          {editError && (
                            <p className="rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
                              {editError}
                            </p>
                          )}
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditing(null)}
                              disabled={pending}
                            >
                              Cancel
                            </Button>
                            <Button type="submit" size="sm" disabled={pending}>
                              {pending ? "Saving…" : "Save"}
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <div
                          key={u.clerk_user_id}
                          className="flex items-center justify-between gap-3 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm"
                        >
                          <span className="truncate text-pulse-text">
                            {u.full_name ?? "Unnamed user"}
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="data-mono truncate text-xs text-pulse-text-mute">
                              {u.email}
                            </span>
                            <button
                              type="button"
                              onClick={() => startEdit(u)}
                              aria-label={`Change email for ${u.full_name ?? u.email}`}
                              title="Change email"
                              className="shrink-0 text-pulse-text-mute transition-colors hover:text-pulse-text"
                            >
                              <Pencil size={13} />
                            </button>
                          </span>
                        </div>
                      ),
                    )
                  )}
                </div>

                {adding ? (
                  <form onSubmit={submit} className="space-y-3">
                    <Field label="Name">
                      <input
                        value={form.contactName}
                        onChange={(e) =>
                          setForm({ ...form, contactName: e.target.value })
                        }
                        className={fieldCls}
                        placeholder="Deepayan Chanda"
                      />
                    </Field>
                    <Field label="Email (their login)">
                      <input
                        required
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        className={fieldCls}
                        placeholder="partner@business.com.au"
                      />
                    </Field>
                    <p className="text-xs text-pulse-text-mute">
                      They get their own login and their own private chat with you.
                      Assets, invoices and reports are shared. You can add them to a
                      group chat from Messages.
                    </p>
                    {error && (
                      <p className="rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
                        {error}
                      </p>
                    )}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setAdding(false)}
                        disabled={pending}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" size="sm" disabled={pending}>
                        {pending ? "Adding…" : "Add user"}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setAdding(true)}
                  >
                    <Plus size={14} /> Add user
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono-label">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-pulse-text-mute">{label}</span>
      <span className={mono ? "data-mono text-pulse-text" : "text-pulse-text"}>{value}</span>
    </div>
  );
}
