"use client";

import { MessageCircle } from "lucide-react";
import { openChat } from "@/components/messages/ChatLauncher";
import { cn } from "@/lib/utils/cn";

/**
 * Opens the chat panel in place, so "Message Kyle" on Home is the bubble's
 * conversation rather than a trip to another page. Inert in the admin preview,
 * where there is no client chat to open.
 */
export function OpenChatButton({
  label,
  preview = false,
  className,
}: {
  label: string;
  preview?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={preview ? undefined : openChat}
      aria-disabled={preview || undefined}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-pulse-gold px-4 text-sm font-medium text-pulse-bg transition-colors hover:bg-pulse-gold-light",
        preview && "cursor-default hover:bg-pulse-gold",
        className,
      )}
    >
      <MessageCircle size={18} strokeWidth={1.9} />
      {label}
    </button>
  );
}
