"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe, X, Trash2, Eye, EyeOff, Plus } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/Button";
import { useSupabaseClient } from "@/lib/supabase/client";
import { savePreview, deletePreview } from "@/app/admin/clients/actions";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none";

interface Row {
  id: string;
  title: string;
  url: string;
  note: string | null;
  visible: boolean;
}

/**
 * The pages of a client's site-in-progress, and whether they can see each one.
 *
 * `visible` rather than delete-and-recreate: a page not ready to be shown is a
 * normal state during a build, and losing the URL every time that happens
 * would be tedious. Kyle sees everything here; the client sees only what is
 * ticked, and that is enforced in RLS rather than by this component.
 */
export function ClientPreviewsDialog({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const supabase = useSupabaseClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [form, setForm] = useState({ title: "", url: "", note: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("client_previews")
      .select("id, title, url, note, visible")
      .eq("client_id", clientId)
      .order("position");
    setRows((data as Row[] | null) ?? []);
  }, [supabase, clientId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await savePreview(clientId, { ...form, visible: true });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setForm({ title: "", url: "", note: "" });
      void load();
      router.refresh();
    });
  }

  function toggle(r: Row) {
    startTransition(async () => {
      await savePreview(
        clientId,
        { title: r.title, url: r.url, note: r.note ?? "", visible: !r.visible },
        r.id,
      );
      void load();
      router.refresh();
    });
  }

  function remove(r: Row) {
    if (
      !window.confirm(
        `Remove "${r.title}"? ${clientName} will no longer see it.`,
      )
    )
      return;
    startTransition(async () => {
      await deletePreview(r.id);
      void load();
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClasses("secondary", "sm")}
      >
        <Globe size={14} /> Website
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            aria-label="Close"
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div className="relative max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
            <div className="flex items-center justify-between border-b border-pulse-border px-4 py-3">
              <p className="text-sm font-medium text-pulse-text">
                {clientName} · website preview
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 p-4">
              {rows === null ? (
                <p className="text-xs text-pulse-text-mute">Loading…</p>
              ) : rows.length === 0 ? (
                <p className="text-xs text-pulse-text-mute">
                  No pages yet. Add one and a Website tab appears in their
                  portal.
                </p>
              ) : (
                rows.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-pulse-text">{r.title}</p>
                        <p className="data-mono break-all text-[11px] text-pulse-text-mute">
                          {r.url}
                        </p>
                        {r.note && (
                          <p className="mt-1 text-[11px] text-pulse-text-dim">
                            {r.note}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => toggle(r)}
                          disabled={pending}
                          title={
                            r.visible
                              ? "Visible to the client. Hide it."
                              : "Hidden. Show it to the client."
                          }
                          className={
                            r.visible
                              ? "text-pulse-success hover:opacity-80"
                              : "text-pulse-text-mute hover:text-pulse-text"
                          }
                        >
                          {r.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(r)}
                          disabled={pending}
                          aria-label="Remove"
                          className="text-pulse-text-mute hover:text-pulse-danger"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}

              <form
                onSubmit={add}
                className="space-y-2 border-t border-pulse-border pt-3"
              >
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Page name, e.g. Home"
                  className={field}
                />
                <input
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://staging.example.com"
                  className={`${field} data-mono text-xs`}
                />
                <input
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="What to look at, or what changed (optional)"
                  className={field}
                />
                {error && (
                  <p className="rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
                    {error}
                  </p>
                )}
                <Button type="submit" size="sm" disabled={pending}>
                  <Plus size={14} /> {pending ? "Saving…" : "Add page"}
                </Button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
