"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createList, addProspect } from "@/app/admin/crm/actions";
import type { CrmList } from "@/lib/types/database";
import { cn } from "@/lib/utils/cn";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none";

/**
 * Which source list is being worked. Where a prospect came from is what makes a
 * first email specific, so lists stay separate rather than being poured into
 * one pool: a grant recipient gets approached about the thing they were funded
 * to build, and someone met at a trade show does not.
 */
export function ListSwitcher({
  lists,
  selected,
  onSelect,
}: {
  lists: (CrmList & { count: number })[];
  selected: string | "all";
  onSelect: (id: string | "all") => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "list" | "prospect">("none");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [listForm, setListForm] = useState({
    name: "",
    description: "",
    sourceNote: "",
    capturedOn: "",
  });
  const [prospectForm, setProspectForm] = useState({
    legalName: "",
    state: "",
    websiteUrl: "",
    headlinePurpose: "",
  });

  const current = lists.find((l) => l.id === selected) ?? null;
  const targetListId = current?.id ?? lists[0]?.id ?? "";

  function submitList() {
    setError(null);
    startTransition(async () => {
      try {
        const id = await createList(listForm);
        setListForm({ name: "", description: "", sourceNote: "", capturedOn: "" });
        setMode("none");
        onSelect(id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create the list.");
      }
    });
  }

  function submitProspect() {
    setError(null);
    if (!targetListId) {
      setError("Make a list first, so the company has somewhere to live.");
      return;
    }
    startTransition(async () => {
      try {
        await addProspect({ listId: targetListId, ...prospectForm });
        setProspectForm({ legalName: "", state: "", websiteUrl: "", headlinePurpose: "" });
        setMode("none");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add the company.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Tab
          active={selected === "all"}
          onClick={() => onSelect("all")}
          label="All lists"
        />
        {lists.map((l) => (
          <Tab
            key={l.id}
            active={selected === l.id}
            onClick={() => onSelect(l.id)}
            label={l.name}
            count={l.count}
          />
        ))}
        <button
          type="button"
          onClick={() => setMode(mode === "list" ? "none" : "list")}
          className="ml-1 flex items-center gap-1.5 rounded-full border border-dashed border-pulse-border px-2.5 py-1 text-[11px] text-pulse-text-mute transition-colors hover:border-pulse-border-strong hover:text-pulse-text"
        >
          <FolderPlus size={12} /> New list
        </button>
        {lists.length > 0 && (
          <button
            type="button"
            onClick={() => setMode(mode === "prospect" ? "none" : "prospect")}
            className="flex items-center gap-1.5 rounded-full border border-dashed border-pulse-border px-2.5 py-1 text-[11px] text-pulse-text-mute transition-colors hover:border-pulse-border-strong hover:text-pulse-text"
          >
            <Plus size={12} /> Add company
          </button>
        )}
      </div>

      {/* Provenance, shown for the list being worked. */}
      {current && mode === "none" && (current.source_note || current.description) && (
        <div className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-3">
          {current.description && (
            <p className="text-xs text-pulse-text-dim">{current.description}</p>
          )}
          {current.source_note && (
            <p className="data-mono mt-1 text-[11px] text-pulse-text-mute">
              Source: {current.source_note}
              {current.captured_on ? ` · captured ${current.captured_on}` : ""}
            </p>
          )}
        </div>
      )}

      {mode !== "none" && (
        <div className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="mono-label">
              {mode === "list" ? "// New source list" : `// Add a company to ${current?.name ?? lists[0]?.name}`}
            </p>
            <button
              type="button"
              onClick={() => setMode("none")}
              aria-label="Close"
              className="text-pulse-text-mute hover:text-pulse-text"
            >
              <X size={15} />
            </button>
          </div>

          {mode === "list" ? (
            <div className="space-y-3">
              <Field label="Name">
                <input
                  value={listForm.name}
                  onChange={(e) => setListForm({ ...listForm, name: e.target.value })}
                  className={field}
                  placeholder="Land Forces 2026 exhibitors"
                />
              </Field>
              <Field label="What this list is">
                <textarea
                  rows={2}
                  value={listForm.description}
                  onChange={(e) =>
                    setListForm({ ...listForm, description: e.target.value })
                  }
                  className={field}
                  placeholder="Who is on it and why they are worth approaching."
                />
              </Field>
              <Field label="Where the names came from">
                <textarea
                  rows={2}
                  value={listForm.sourceNote}
                  onChange={(e) =>
                    setListForm({ ...listForm, sourceNote: e.target.value })
                  }
                  className={field}
                  placeholder="The public source, so an approach can cite it precisely."
                />
              </Field>
              <Field label="Captured on">
                <input
                  type="date"
                  value={listForm.capturedOn}
                  onChange={(e) =>
                    setListForm({ ...listForm, capturedOn: e.target.value })
                  }
                  className={cn(field, "max-w-[12rem]")}
                />
              </Field>
              {error && <ErrorLine>{error}</ErrorLine>}
              <div className="flex justify-end">
                <Button size="sm" onClick={submitList} disabled={pending}>
                  {pending ? "Creating…" : "Create list"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Company name">
                  <input
                    value={prospectForm.legalName}
                    onChange={(e) =>
                      setProspectForm({ ...prospectForm, legalName: e.target.value })
                    }
                    className={field}
                    placeholder="Acme Engineering Pty Ltd"
                  />
                </Field>
                <Field label="State">
                  <input
                    value={prospectForm.state}
                    onChange={(e) =>
                      setProspectForm({ ...prospectForm, state: e.target.value })
                    }
                    className={field}
                    placeholder="Vic"
                  />
                </Field>
              </div>
              <Field label="Website">
                <input
                  value={prospectForm.websiteUrl}
                  onChange={(e) =>
                    setProspectForm({ ...prospectForm, websiteUrl: e.target.value })
                  }
                  className={field}
                  placeholder="https://"
                />
              </Field>
              <Field label="Why they are worth approaching">
                <textarea
                  rows={2}
                  value={prospectForm.headlinePurpose}
                  onChange={(e) =>
                    setProspectForm({
                      ...prospectForm,
                      headlinePurpose: e.target.value,
                    })
                  }
                  className={field}
                  placeholder="The public fact an approach would be built on."
                />
              </Field>
              {error && <ErrorLine>{error}</ErrorLine>}
              <div className="flex justify-end">
                <Button size="sm" onClick={submitProspect} disabled={pending}>
                  {pending ? "Adding…" : "Add company"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Tab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors",
        active
          ? "bg-pulse-steel/15 text-pulse-steel-bright"
          : "text-pulse-text-dim hover:text-pulse-text",
      )}
    >
      {label}
      {count !== undefined && (
        <span className="data-mono text-[10px] text-pulse-text-mute">{count}</span>
      )}
    </button>
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

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
      {children}
    </p>
  );
}
