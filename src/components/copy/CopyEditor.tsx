"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  ArrowLeft,
  History,
  Send,
  Check,
  RotateCcw,
  Bold,
  Italic,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
} from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";
import type {
  CopyDocument,
  CopyDocumentVersion,
  CopyDocStatus,
} from "@/lib/types/database";
import { cn } from "@/lib/utils/cn";

const STATUS: Record<CopyDocStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "text-pulse-text-mute" },
  submitted: { label: "Submitted for review", cls: "text-pulse-warn" },
  approved: { label: "Approved", cls: "text-pulse-success" },
  changes_requested: { label: "Changes requested", cls: "text-pulse-danger" },
};

const EDITOR_CSS = `
.copy-prose:focus{outline:none}
.copy-prose h1{font-size:1.5rem;font-weight:600;margin:.6em 0 .3em}
.copy-prose h2{font-size:1.25rem;font-weight:600;margin:.6em 0 .3em}
.copy-prose h3{font-size:1.1rem;font-weight:600;margin:.6em 0 .3em}
.copy-prose p{margin:.5em 0;line-height:1.65}
.copy-prose ul{list-style:disc;padding-left:1.5em;margin:.5em 0}
.copy-prose ol{list-style:decimal;padding-left:1.5em;margin:.5em 0}
.copy-prose li{margin:.2em 0}
.copy-prose blockquote{border-left:3px solid var(--pulse-border-strong);padding-left:1em;margin:.6em 0;color:var(--pulse-text-dim)}
.copy-prose strong{font-weight:700}
.copy-prose em{font-style:italic}
.copy-prose a{color:var(--pulse-gold);text-decoration:underline}
`;

function TBtn({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-[var(--radius-input)] hover:bg-pulse-surface-2",
        active ? "text-pulse-gold" : "text-pulse-text-mute",
      )}
    >
      {children}
    </button>
  );
}

export function CopyEditor({
  doc,
  versions,
  role,
  currentUserId,
  backHref,
}: {
  doc: CopyDocument;
  versions: CopyDocumentVersion[];
  role: "client" | "admin";
  currentUserId: string;
  backHref: string;
}) {
  const supabase = useSupabaseClient();
  const router = useRouter();
  const [title, setTitle] = useState(doc.title);
  const [status, setStatus] = useState<CopyDocStatus>(doc.status);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(doc.title);

  const initialContent =
    doc.body_json &&
    typeof doc.body_json === "object" &&
    (doc.body_json as { type?: string }).type
      ? (doc.body_json as object)
      : "";

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "copy-prose min-h-[55vh] text-pulse-text" },
    },
    onUpdate: () => scheduleSave(),
  });

  function scheduleSave() {
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1200);
  }

  async function save() {
    if (!editor) return;
    await supabase
      .from("copy_documents")
      .update({
        title: titleRef.current,
        body_json: editor.getJSON(),
        body_html: editor.getHTML(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", doc.id);
    setSaveState("saved");
  }

  useEffect(() => {
    titleRef.current = title;
    if (title !== doc.title) scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function snapshot(label: string) {
    if (!editor) return;
    await supabase.from("copy_document_versions").insert({
      document_id: doc.id,
      body_json: editor.getJSON(),
      label,
      created_by: currentUserId,
    });
  }

  async function setDocStatus(next: CopyDocStatus, reviewNote?: string | null) {
    setBusy(true);
    await save();
    const patch: Record<string, unknown> = { status: next };
    if (reviewNote !== undefined) patch.review_note = reviewNote;
    await supabase.from("copy_documents").update(patch).eq("id", doc.id);
    setStatus(next);
    setBusy(false);
    router.refresh();
  }

  async function submitForReview() {
    await snapshot("submitted");
    await setDocStatus("submitted");
  }

  async function requestChanges() {
    const note = window.prompt("What needs changing?");
    if (note === null) return;
    await setDocStatus("changes_requested", note.trim() || null);
  }

  function restore(v: CopyDocumentVersion) {
    if (!editor) return;
    if (
      !window.confirm(
        "Restore this version? Your current text is replaced (it stays in history).",
      )
    )
      return;
    editor.commands.setContent((v.body_json as object) ?? "");
    setShowHistory(false);
    scheduleSave();
  }

  const st = STATUS[status];

  return (
    <div>
      <style>{EDITOR_CSS}</style>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-pulse-text-mute hover:text-pulse-text"
        >
          <ArrowLeft size={15} /> Back
        </Link>
        <span className={cn("data-mono text-xs uppercase tracking-wider", st.cls)}>
          {st.label}
        </span>
        <span className="text-xs text-pulse-text-mute">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowHistory((s) => !s)}
            className="inline-flex items-center gap-1 text-xs text-pulse-text-dim hover:text-pulse-text"
          >
            <History size={14} /> History
          </button>
          {role === "client" && (
            <button
              type="button"
              disabled={busy}
              onClick={submitForReview}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-input)] bg-pulse-gold px-3 py-1.5 text-xs font-medium text-pulse-bg hover:bg-pulse-gold-light disabled:opacity-60"
            >
              <Send size={13} /> Submit for review
            </button>
          )}
          {role === "admin" && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={requestChanges}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-input)] border border-pulse-border px-3 py-1.5 text-xs text-pulse-text-dim hover:text-pulse-text disabled:opacity-60"
              >
                Request changes
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDocStatus("approved", null)}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-input)] bg-pulse-success px-3 py-1.5 text-xs font-medium text-pulse-bg hover:opacity-90 disabled:opacity-60"
              >
                <Check size={13} /> Approve
              </button>
            </>
          )}
        </div>
      </div>

      {status === "changes_requested" && doc.review_note && (
        <div className="mb-4 rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-sm text-pulse-text-dim">
          <span className="font-medium text-pulse-danger">Changes requested:</span>{" "}
          {doc.review_note}
        </div>
      )}

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Untitled"
        className="mb-3 w-full bg-transparent text-2xl font-semibold text-pulse-text placeholder:text-pulse-text-mute focus:outline-none"
      />

      {editor && (
        <div className="mb-3 flex flex-wrap items-center gap-0.5 border-y border-pulse-border py-1">
          <TBtn
            label="Heading 1"
            active={editor.isActive("heading", { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          >
            <Heading1 size={16} />
          </TBtn>
          <TBtn
            label="Heading 2"
            active={editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 size={16} />
          </TBtn>
          <TBtn
            label="Bold"
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold size={15} />
          </TBtn>
          <TBtn
            label="Italic"
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic size={15} />
          </TBtn>
          <TBtn
            label="Bullet list"
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List size={16} />
          </TBtn>
          <TBtn
            label="Numbered list"
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={16} />
          </TBtn>
          <TBtn
            label="Quote"
            active={editor.isActive("blockquote")}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote size={15} />
          </TBtn>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <EditorContent editor={editor} />
        {showHistory && (
          <aside>
            <p className="mono-label mb-2">Version history</p>
            {versions.length === 0 ? (
              <p className="text-xs text-pulse-text-mute">
                No versions yet. A snapshot is saved each time it&apos;s submitted.
              </p>
            ) : (
              <ul className="space-y-1">
                {versions.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between gap-2 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface px-2.5 py-1.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-pulse-text-dim">
                        {v.label ?? "version"}
                      </span>
                      <span className="data-mono block text-[10px] text-pulse-text-mute">
                        {new Date(v.created_at).toLocaleString("en-AU")}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => restore(v)}
                      aria-label="Restore this version"
                      className="shrink-0 text-pulse-text-mute hover:text-pulse-gold"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
