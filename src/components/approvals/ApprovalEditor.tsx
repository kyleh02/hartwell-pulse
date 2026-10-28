"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Film, Send, Trash2, Upload, X } from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";
import {
  ACCEPT,
  KINDS,
  MAX_FILES,
  approvalFilePath,
  checkFile,
  isImage,
  isVideo,
  type Approval,
  type ApprovalFile,
  type ApprovalKind,
} from "@/lib/approvals-shared";
import {
  addApprovalFile,
  createApproval,
  deleteApproval,
  removeApprovalFile,
  saveApproval,
  sendApproval,
  type ApprovalInput,
} from "@/app/admin/approvals/actions";
import { Button } from "@/components/ui/Button";
import { KIND_ICON } from "@/components/approvals/ApprovalBits";
import { cn } from "@/lib/utils/cn";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2.5 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Kyle's side of a piece of work: what it is, the words, the files, and the
 * button that puts it in front of the client.
 *
 * A new one is saved as a draft first, because files need somewhere to live.
 * Sending again after the client asked for changes is the next version.
 */
export function ApprovalEditor(
  props:
    | { mode: "new"; clients: { id: string; business_name: string }[]; clientId: string | null }
    | { mode: "edit"; approval: Approval; files: ApprovalFile[] },
) {
  const supabase = useSupabaseClient();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const existing = props.mode === "edit" ? props.approval : null;

  const [clientId, setClientId] = useState(props.mode === "new" ? (props.clientId ?? "") : existing!.client_id);
  const [form, setForm] = useState<ApprovalInput>({
    kind: existing?.kind ?? "copy",
    title: existing?.title ?? "",
    body: existing?.body ?? "",
    note: existing?.note ?? "",
    channel: existing?.channel ?? "",
    due_on: existing?.due_on ?? "",
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pending, start] = useTransition();

  const set = <K extends keyof ApprovalInput>(k: K, v: ApprovalInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const files = props.mode === "edit" ? props.files : [];
  const kind = KINDS[form.kind];

  function save(then?: "send") {
    setErrors([]);
    start(async () => {
      if (props.mode === "new") {
        if (!clientId) return setErrors(["Choose the client first."]);
        const res = await createApproval(clientId, form);
        if (!res.ok) return setErrors([res.message]);
        router.push(`/admin/approvals/${res.id}`);
        return;
      }
      if (dirty) {
        const res = await saveApproval(existing!.id, form);
        if (!res.ok) return setErrors([res.message]);
        setDirty(false);
      }
      if (then === "send") {
        const verb = existing!.status === "draft" ? "Send this to the client for approval?" : "Send this version to the client?";
        if (!window.confirm(verb)) return;
        const res = await sendApproval(existing!.id);
        if (!res.ok) return setErrors([res.message]);
      }
      router.refresh();
    });
  }

  async function upload(list: FileList | File[] | null) {
    if (props.mode !== "edit" || !list) return;
    const problems: string[] = [];
    let count = files.length;
    for (const file of Array.from(list)) {
      const problem = checkFile({ name: file.name, size: file.size }, count);
      if (problem) {
        problems.push(problem);
        continue;
      }
      setBusy(`Uploading ${file.name}…`);
      const path = approvalFilePath(existing!.client_id, existing!.id, newId(), file.name);
      const up = await supabase.storage.from("pulse-reports").upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (up.error) {
        problems.push(`"${file.name}" did not upload: ${up.error.message}`);
        continue;
      }
      const res = await addApprovalFile(existing!.id, { path, name: file.name });
      if (!res.ok) problems.push(res.message);
      else count += 1;
    }
    setBusy(null);
    setErrors(problems);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  function remove(f: ApprovalFile) {
    start(async () => {
      const res = await removeApprovalFile(f.id);
      if (!res.ok) setErrors([res.message]);
      router.refresh();
    });
  }

  function destroy() {
    if (!existing) return;
    if (!window.confirm(`Delete "${existing.title}" and its files for good? The client will no longer see it.`)) return;
    start(async () => {
      const res = await deleteApproval(existing.id);
      if (!res.ok) return setErrors([res.message]);
      router.push("/admin/approvals");
    });
  }

  return (
    <div className="space-y-5 rounded-[20px] border border-pulse-border bg-pulse-surface p-5 sm:p-6">
      {props.mode === "new" && (
        <label className="block">
          <span className="mono-label">Client</span>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={cn(field, "mt-1.5")}>
            <option value="">Choose a client…</option>
            {props.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.business_name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div>
        <span className="mono-label">What is it?</span>
        <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Kind of work">
          {(Object.keys(KINDS) as ApprovalKind[]).map((k) => {
            const Icon = KIND_ICON[k];
            const on = form.kind === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set("kind", k)}
                className={cn(
                  "flex items-center gap-2 rounded-[12px] border px-3 py-2.5 text-left text-sm transition-colors",
                  on
                    ? "border-pulse-gold/60 bg-pulse-gold/10 text-pulse-text"
                    : "border-pulse-border text-pulse-text-dim hover:border-pulse-border-strong hover:text-pulse-text",
                )}
              >
                <Icon size={16} className={on ? "text-pulse-gold" : ""} aria-hidden="true" />
                {KINDS[k].label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <label className="block">
          <span className="mono-label">Title</span>
          <input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Home page, draft 2" className={cn(field, "mt-1.5")} />
        </label>
        <label className="block">
          <span className="mono-label">Where</span>
          <input value={form.channel} onChange={(e) => set("channel", e.target.value)} placeholder={kind.channelHint} className={cn(field, "mt-1.5")} />
        </label>
        <label className="block">
          <span className="mono-label">Approve by</span>
          <input type="date" value={form.due_on} onChange={(e) => set("due_on", e.target.value)} className={cn(field, "mt-1.5")} />
        </label>
      </div>

      <label className="block">
        <span className="mono-label">A note for them</span>
        <textarea
          value={form.note}
          onChange={(e) => set("note", e.target.value)}
          rows={2}
          placeholder="What to look at, or what changed since last time"
          className={cn(field, "mt-1.5")}
        />
      </label>

      <label className="block">
        <span className="mono-label">{kind.bodyLabel}</span>
        <textarea
          value={form.body}
          onChange={(e) => set("body", e.target.value)}
          rows={form.kind === "copy" ? 12 : 5}
          className={cn(field, "mt-1.5 leading-relaxed")}
        />
      </label>

      {/* ---- files ---- */}
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="mono-label">Files</span>
          <span className="data-mono text-xs text-pulse-text-mute">
            {files.length} of {MAX_FILES}
          </span>
        </div>
        {props.mode === "new" ? (
          <p className="mt-1.5 text-xs text-pulse-text-dim">Save it first, then add images, PDFs or video.</p>
        ) : (
          <>
            {files.length > 0 && (
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 rounded-[12px] border border-pulse-border bg-pulse-surface-2 p-2">
                    {isImage(f.file_name, f.mime_type) && f.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.url} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
                    ) : (
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-pulse-surface text-pulse-gold">
                        {isVideo(f.file_name, f.mime_type) ? <Film size={18} /> : <FileText size={18} />}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-pulse-text">{f.file_name}</span>
                    <button
                      type="button"
                      onClick={() => remove(f)}
                      disabled={pending}
                      aria-label={`Remove ${f.file_name}`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-pulse-text-mute hover:bg-pulse-surface hover:text-pulse-danger"
                    >
                      <X size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void upload(e.dataTransfer.files);
              }}
              className={cn(
                "mt-2 flex flex-col items-center justify-center gap-2 rounded-[16px] border-2 border-dashed px-4 py-6 text-center transition-colors",
                dragging ? "border-pulse-gold bg-pulse-gold/10" : "border-pulse-border",
              )}
            >
              <Upload size={20} className="text-pulse-gold" aria-hidden="true" />
              <p className="text-sm text-pulse-text-dim">
                {busy ?? "Drop images, PDFs or video here, or"}
                {!busy && (
                  <>
                    {" "}
                    <button type="button" onClick={() => fileRef.current?.click()} className="text-pulse-gold underline-offset-2 hover:underline">
                      choose files
                    </button>
                  </>
                )}
              </p>
              <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => void upload(e.target.files)} />
            </div>
          </>
        )}
      </div>

      {errors.length > 0 && (
        <div className="rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-pulse-border pt-4">
        {props.mode === "new" ? (
          <Button onClick={() => save()} disabled={pending}>
            {pending ? "Saving…" : "Save draft"}
          </Button>
        ) : (
          <>
            <Button onClick={() => save("send")} disabled={pending || !!busy}>
              <Send size={15} aria-hidden="true" />
              {existing!.status === "draft" ? "Send for approval" : "Send this version"}
            </Button>
            <Button variant="secondary" onClick={() => save()} disabled={pending || !dirty}>
              {dirty ? "Save changes" : "Saved"}
            </Button>
            <Button variant="danger" onClick={destroy} disabled={pending} className="ml-auto">
              <Trash2 size={14} aria-hidden="true" /> Delete
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
