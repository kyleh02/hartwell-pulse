"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSupabaseClient } from "@/lib/supabase/client";
import type { AssetComment } from "@/lib/types/database";
import { Button } from "@/components/ui/Button";

export function AssetComments({
  assetId,
  clientId,
  role,
}: {
  assetId: string;
  clientId: string;
  role: "client" | "admin";
}) {
  const supabase = useSupabaseClient();
  const { userId } = useAuth();
  const [comments, setComments] = useState<AssetComment[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      const { data } = await supabase
        .from("asset_comments")
        .select("*")
        .eq("asset_id", assetId)
        .order("created_at", { ascending: true });
      if (active) {
        setComments((data as AssetComment[] | null) ?? []);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [assetId, supabase]);

  async function add() {
    const text = body.trim();
    if (!text || !userId) return;
    const optimistic: AssetComment = {
      id: `temp-${Date.now()}`,
      asset_id: assetId,
      client_id: clientId,
      author_user_id: userId,
      author_role: role,
      body: text,
      created_at: new Date().toISOString(),
    };
    setComments((p) => [...p, optimistic]);
    setBody("");
    const { data, error } = await supabase
      .from("asset_comments")
      .insert({
        asset_id: assetId,
        client_id: clientId,
        author_user_id: userId,
        author_role: role,
        body: text,
      })
      .select("*")
      .single();
    if (!error && data) {
      setComments((p) => p.map((c) => (c.id === optimistic.id ? (data as AssetComment) : c)));
    }
  }

  function authorLabel(c: AssetComment): string {
    if (c.author_role === "admin") return "Kyle";
    return c.author_user_id === userId ? "You" : "Client";
  }

  return (
    <div>
      <p className="mono-label mb-3">Comments</p>
      <div className="space-y-2.5">
        {loading ? (
          <p className="text-xs text-pulse-text-mute">Loading…</p>
        ) : comments.length === 0 ? (
          <p className="text-xs text-pulse-text-mute">
            No comments yet. Start the conversation below.
          </p>
        ) : (
          comments.map((c) => (
            <div
              key={c.id}
              className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="data-mono text-[11px] uppercase tracking-wider text-pulse-gold">
                  {authorLabel(c)}
                </span>
                <span className="data-mono text-[10px] text-pulse-text-mute">
                  {new Date(c.created_at).toLocaleDateString("en-AU")}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-pulse-text-dim">
                {c.body}
              </p>
            </div>
          ))
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="Add a comment"
          className="flex-1 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none"
        />
        <Button size="sm" onClick={add}>
          Send
        </Button>
      </div>
    </div>
  );
}
