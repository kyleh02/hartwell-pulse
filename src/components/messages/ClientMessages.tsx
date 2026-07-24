"use client";

import { useState } from "react";
import { MessageSquare, Users } from "lucide-react";
import { ChatThread } from "@/components/messages/ChatThread";
import type { ConversationKind } from "@/lib/types/database";
import { cn } from "@/lib/utils/cn";

export interface ClientConversationRow {
  id: string;
  kind: ConversationKind;
  label: string; // "Kyle" for the direct thread, the title for group chats
}

/**
 * The client's Messages view. Most clients have a single thread with Kyle and
 * see exactly what they always did — one full-width chat. Clients with a group
 * chat (or several threads) get a slim switcher above it.
 */
export function ClientMessages({
  conversations,
  clientId,
}: {
  conversations: ClientConversationRow[];
  clientId: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    conversations[0]?.id ?? null,
  );
  const current = conversations.find((c) => c.id === selectedId) ?? null;

  if (conversations.length === 0) {
    return (
      <p className="text-sm text-pulse-text-dim">
        No conversation yet — Kyle will open one for you shortly.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {conversations.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedId(c.id)}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                selectedId === c.id
                  ? "border-pulse-gold/50 bg-pulse-gold/10 text-pulse-text"
                  : "border-pulse-border text-pulse-text-dim hover:border-pulse-border-strong hover:text-pulse-text",
              )}
            >
              {c.kind === "group" ? (
                <Users size={14} strokeWidth={1.75} />
              ) : (
                <MessageSquare size={14} strokeWidth={1.75} />
              )}
              {c.label}
            </button>
          ))}
        </div>
      )}

      {current && (
        <ChatThread
          key={current.id}
          conversationId={current.id}
          clientId={clientId}
          kind={current.kind}
          role="client"
          peerName={current.label}
        />
      )}
    </div>
  );
}
