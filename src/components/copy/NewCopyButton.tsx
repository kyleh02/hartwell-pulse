"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";

export function NewCopyButton({
  clientId,
  basePath,
  currentUserId,
}: {
  clientId: string;
  basePath: string;
  currentUserId: string;
}) {
  const supabase = useSupabaseClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("copy_documents")
      .insert({ client_id: clientId, title: "Untitled", created_by: currentUserId })
      .select("id")
      .single();
    if (e) {
      setBusy(false);
      setError(e.message);
      return;
    }
    router.push(`${basePath}/${(data as { id: string }).id}`);
  }

  return (
    <div>
      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-input)] bg-pulse-gold px-3 py-2 text-sm font-medium text-pulse-bg hover:bg-pulse-gold-light disabled:opacity-60"
      >
        <Plus size={15} /> {busy ? "Creating…" : "New document"}
      </button>
      {error && <p className="mt-2 text-xs text-pulse-danger">{error}</p>}
    </div>
  );
}
